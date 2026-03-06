import type { MarketConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import { getMarketById } from "../core/markets.ts";
import { getCandleWindowTiming } from "../core/utils.ts";
import { pendingOrderQueries, tradeQueries } from "../db/queries.ts";
import type { MarketState } from "../pipeline/processMarket.ts";
import type { AccountStatsManager } from "../trading/accountStats.ts";
import type { TrackedOrder } from "../trading/orderManager.ts";
import { unregisterOpenGtdOrder } from "../trading/trader.ts";
import { collectLatestPrices } from "./marketState.ts";

const log = createLogger("order-status-sync");

export interface RuntimeOrderTracker {
	orders: Map<string, number>;
	keyFor(marketId: string, windowSlug: string): string;
}

interface CreateOrderStatusHandlerParams {
	markets: MarketConfig[];
	states: Map<string, MarketState>;
	liveAccount: AccountStatsManager;
	orderTracker: RuntimeOrderTracker;
}

export function createOrderStatusHandler({
	markets,
	states,
	liveAccount,
	orderTracker,
}: CreateOrderStatusHandlerParams) {
	return (order: TrackedOrder, status: TrackedOrder["status"], previousStatus: TrackedOrder["status"]) => {
		void tradeQueries.updateTradeStatus(order.orderId, "live", status).catch((err) => {
			log.warn(`Failed to update live trade status for ${order.orderId.slice(0, 12)}...`, err);
		});

		void pendingOrderQueries.updateStatus(order.orderId, status).catch(() => {
			// Best-effort: row may not exist (e.g. FOK orders or already cleaned up)
		});

		if (status === "filled" && previousStatus !== "filled") {
			const parsedWindowStartMs = Number(order.windowSlug);
			const orderMarket = getMarketById(order.marketId);
			const windowStartMs = Number.isFinite(parsedWindowStartMs)
				? parsedWindowStartMs
				: getCandleWindowTiming(orderMarket?.candleWindowMinutes ?? 15).startMs;
			const effectiveSize = order.sizeMatched > 0 ? order.sizeMatched : order.size;

			const recordFilledTrade = (): boolean => {
				try {
					liveAccount.addTrade(
						{
							marketId: order.marketId,
							windowStartMs,
							side: order.side === "DOWN" ? "DOWN" : "UP",
							price: order.price,
							size: effectiveSize,
							priceToBeat: order.priceToBeat ?? 0,
							currentPriceAtEntry: order.currentPriceAtEntry ?? null,
							timestamp: new Date(order.placedAt).toISOString(),
						},
						order.orderId,
						"filled",
					);
					log.info(`Recorded filled live trade ${order.orderId.slice(0, 12)}...`);
					return true;
				} catch (err) {
					log.error(
						`Failed to record filled live trade ${order.orderId.slice(0, 12)}...:`,
						err instanceof Error ? err.message : String(err),
					);
					return false;
				}
			};

			const recorded = recordFilledTrade();
			if (!recorded) {
				setTimeout(() => {
					if (recordFilledTrade()) {
						void pendingOrderQueries.delete(order.orderId).catch(() => {});
					} else {
						log.error(`Retry also failed for ${order.orderId.slice(0, 12)}... — will recover on restart`);
					}
				}, 5_000);
			}

			if (recorded) {
				const currentTiming = getCandleWindowTiming(orderMarket?.candleWindowMinutes ?? 15);
				if (windowStartMs < currentTiming.startMs) {
					const prices = collectLatestPrices(markets, states);
					if (prices.size > 0) {
						void liveAccount.resolveTrades(windowStartMs, prices).then((settled) => {
							if (settled > 0) {
								log.info(`Immediate settlement for late-filled trade: ${settled} trade(s)`);
							}
						});
					}
				}
				void pendingOrderQueries.delete(order.orderId).catch(() => {});
			}
		}

		if (status === "cancelled" || status === "expired") {
			void pendingOrderQueries.delete(order.orderId).catch(() => {});
			orderTracker.orders.delete(orderTracker.keyFor(order.marketId, order.windowSlug));
		}

		if (status === "filled" || status === "cancelled" || status === "expired") {
			liveAccount.unreserveBalance(order.price * order.size);
			unregisterOpenGtdOrder(order.orderId);
		}
	};
}
