import { createLogger } from "../core/logger.ts";
import { pendingOrderQueries, tradeQueries } from "../db/queries.ts";
import type { AccountStatsManager } from "../trading/accountStats.ts";
import type { OrderManager } from "../trading/orderManager.ts";
import { registerOpenGtdOrder } from "../trading/trader.ts";

const log = createLogger("order-recovery");

export interface RecoverableOrderTracker {
	hasOrder(marketId: string, windowSlug: string): boolean;
	record(marketId: string, windowSlug: string, recordedAtMs?: number): void;
	canTradeGlobally(maxGlobal: number): boolean;
}

interface RestoreRuntimeStateParams {
	orderTracker: RecoverableOrderTracker;
	liveAccount: AccountStatsManager;
	orderManager: OrderManager;
}

export async function restoreRuntimeState({
	orderTracker,
	liveAccount,
	orderManager,
}: RestoreRuntimeStateParams): Promise<void> {
	const pendingLive = liveAccount.getPendingTrades();
	let restoredCount = 0;
	for (const trade of pendingLive) {
		const slugProxy = String(trade.windowStartMs);
		const tradeTsMs = Date.parse(trade.timestamp);
		orderTracker.record(trade.marketId, slugProxy, Number.isFinite(tradeTsMs) ? tradeTsMs : trade.windowStartMs);
		restoredCount++;
	}
	if (restoredCount > 0) {
		log.info(
			`Restored ${restoredCount} pending live trades into tracker (active: ${orderTracker.canTradeGlobally(1) ? 0 : ">=1"})`,
		);
	}

	const pendingOrderRows = await pendingOrderQueries.getAll();
	let restoredPendingOrderCount = 0;
	let recoveredFilledPendingCount = 0;

	for (const row of pendingOrderRows) {
		const orderId = String(row.orderId ?? "").trim();
		const marketId = String(row.marketId ?? "").trim();
		const windowStartMs = Number(row.windowStartMs ?? Number.NaN);
		if (!orderId || !marketId || !Number.isFinite(windowStartMs)) continue;

		const price = Number(row.price ?? Number.NaN);
		const size = Number(row.size ?? Number.NaN);
		if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
			log.warn(`Skipping invalid live_pending_orders row ${orderId.slice(0, 12)}...`);
			continue;
		}

		const rowStatus = String(row.status ?? "placed").toLowerCase();
		if (rowStatus === "cancelled" || rowStatus === "expired") {
			void pendingOrderQueries.delete(orderId).catch(() => {});
			continue;
		}
		const side = String(row.side ?? "UP").toUpperCase() === "DOWN" ? "DOWN" : "UP";

		if (rowStatus === "filled") {
			let recorded = false;
			try {
				liveAccount.addTrade(
					{
						marketId,
						windowStartMs,
						side,
						price,
						size,
						priceToBeat: Number(row.priceToBeat ?? 0),
						currentPriceAtEntry:
							row.currentPriceAtEntry === null || row.currentPriceAtEntry === undefined
								? null
								: Number(row.currentPriceAtEntry),
						timestamp: new Date(Number(row.placedAt ?? Date.now())).toISOString(),
					},
					orderId,
					"filled",
				);
				recorded = true;
			} catch (err) {
				log.warn(`Failed to recover filled pending order ${orderId.slice(0, 12)}...`, err);
			}

			if (recorded) {
				void tradeQueries.updateTradeStatus(orderId, "live", "filled").catch(() => {});
				const windowKey = String(windowStartMs);
				if (!orderTracker.hasOrder(marketId, windowKey)) {
					orderTracker.record(marketId, windowKey, Number(row.placedAt ?? windowStartMs));
				}
				void pendingOrderQueries.delete(orderId).catch(() => {});
				recoveredFilledPendingCount++;
			}
			continue;
		}

		const windowKey = String(windowStartMs);
		if (!orderTracker.hasOrder(marketId, windowKey)) {
			orderTracker.record(marketId, windowKey, Number(row.placedAt ?? windowStartMs));
		}

		orderManager.addOrderWithTracking(
			{
				orderId,
				marketId,
				windowSlug: windowKey,
				side,
				tokenId: row.tokenId ? String(row.tokenId) : undefined,
				price,
				size,
				priceToBeat: row.priceToBeat ?? null,
				currentPriceAtEntry: row.currentPriceAtEntry ?? null,
				placedAt: Number(row.placedAt ?? Date.now()),
			},
			true,
		);
		registerOpenGtdOrder(orderId);
		restoredPendingOrderCount++;
	}

	if (restoredPendingOrderCount > 0) {
		log.info(`Restored ${restoredPendingOrderCount} live pending GTD order(s) for status polling`);
	}
	if (recoveredFilledPendingCount > 0) {
		log.info(`Recovered ${recoveredFilledPendingCount} previously-filled pending live order(s)`);
	}
}
