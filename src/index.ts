import { bootstrapApp } from "./app/bootstrap.ts";
import { registerShutdownHandlers } from "./app/shutdown.ts";
import { redeemByConditionId } from "./blockchain/redeemer.ts";
import { CONFIG } from "./core/config.ts";
import { createLogger } from "./core/logger.ts";
import { getActiveMarkets, getMarketById } from "./core/markets.ts";
import { isLiveRunning, isPaperRunning } from "./core/state.ts";
import { createTradeTracker } from "./core/tradeTracker.ts";
import { getCandleWindowTiming, sleep } from "./core/utils.ts";
import { startMultiBinanceTradeStream } from "./data/binanceWs.ts";
import { startChainlinkPriceStream } from "./data/chainlinkWs.ts";
import type { ClobWsHandle } from "./data/polymarketClobWs.ts";
import { startClobMarketWs } from "./data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "./data/polymarketLiveWs.ts";
import { onchainQueries, pendingOrderQueries, pruneDatabase, tradeQueries } from "./db/queries.ts";
import type { ProcessMarketResult } from "./pipeline/processMarket.ts";
import { processMarket as processMarketPipeline } from "./pipeline/processMarket.ts";
import { collectLatestPrices, createMarketStateMap } from "./runtime/marketState.ts";
import { createOnchainRuntime } from "./runtime/onchainRuntime.ts";
import { runSettlementCycle } from "./runtime/settlementCycle.ts";
import { publishMarketSnapshots } from "./runtime/snapshotPublisher.ts";
import { dispatchTradeCandidates } from "./runtime/tradeDispatch.ts";
import { liveAccount, paperAccount } from "./trading/accountStats.ts";
import { LiveSettler } from "./trading/liveSettler.ts";
import { OrderManager, type TrackedOrder } from "./trading/orderManager.ts";

import { renderDashboard } from "./trading/terminal.ts";
import {
	getClient,
	getOpenGtdOrderCount,
	getWallet,
	registerOpenGtdOrder,
	startHeartbeat,
	unregisterOpenGtdOrder,
} from "./trading/trader.ts";
import type { StreamHandles, WsStreamHandle } from "./types.ts";

export type { ProcessMarketResult } from "./pipeline/processMarket.ts";

const log = createLogger("bot");
const processMarket = processMarketPipeline;

interface SimpleOrderTracker {
	orders: Map<string, number>;
	lastTradeMs: number;
	cooldownMs: number;
	keyFor(marketId: string, windowSlug: string): string;
	hasOrder(marketId: string, windowSlug: string): boolean;
	totalActive(): number;
	record(marketId: string, windowSlug: string, recordedAtMs?: number): void;
	clear(): void;
	prune(): void;
	onCooldown(): boolean;
}

const paperTracker = createTradeTracker();
const liveTracker = createTradeTracker();

let redeemTimerHandle: ReturnType<typeof setInterval> | null = null;
let liveSettlerInstance: LiveSettler | null = null;

async function readKnownTokenIds(): Promise<string[]> {
	try {
		const rows = await onchainQueries.getKnownCtfTokens();
		return rows.map((row) => String(row?.tokenId ?? "").trim()).filter((tokenId) => tokenId.length > 0);
	} catch {
		return [];
	}
}

async function main(): Promise<void> {
	const bootstrapResult = await bootstrapApp({
		isLiveSettlerRunning: () => liveSettlerInstance?.isRunning() ?? false,
	});
	redeemTimerHandle = bootstrapResult.redeemTimerHandle;

	const orderManager = new OrderManager();

	orderManager.onOrderStatusChange(
		(order: TrackedOrder, status: TrackedOrder["status"], previousStatus: TrackedOrder["status"]) => {
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
		},
	);

	const markets = getActiveMarkets();
	const binanceSymbols = [...new Set(markets.map((m) => m.binanceSymbol))];
	const polymarketSymbols = [...new Set(markets.map((m) => m.chainlink.wsSymbol))];

	const streams: StreamHandles = {
		binance: startMultiBinanceTradeStream(binanceSymbols),
		polymarket: startMultiPolymarketPriceStream(polymarketSymbols),
		chainlink: new Map<string, WsStreamHandle>(),
	};

	const chainlinkStreamCache = new Map<string, WsStreamHandle>();
	for (const market of markets) {
		const key = market.chainlink.aggregator;
		let stream = chainlinkStreamCache.get(key);
		if (!stream) {
			stream = startChainlinkPriceStream({
				aggregator: market.chainlink.aggregator,
				decimals: market.chainlink.decimals,
			});
			chainlinkStreamCache.set(key, stream);
		}
		streams.chainlink.set(market.id, stream);
	}

	const clobWs: ClobWsHandle = startClobMarketWs();

	async function lookupTokenId(marketId: string, side: string): Promise<string | null> {
		try {
			const row = await onchainQueries.getCtfTokenByMarketSide(marketId, side);
			return row?.tokenId ?? null;
		} catch {
			return null;
		}
	}

	async function lookupConditionId(tokenId: string): Promise<string | null> {
		try {
			const row = await onchainQueries.getKnownCtfToken(tokenId);
			return row?.conditionId ?? null;
		} catch {
			return null;
		}
	}

	function ensureLiveSettler(): void {
		if (liveSettlerInstance?.isRunning()) return;
		const hasWonTrades = liveAccount.getWonTrades().length > 0;
		if (!isLiveRunning() && !hasWonTrades) return;

		liveSettlerInstance = new LiveSettler({
			clobWs,
			liveAccount,
			wallet: getWallet(),
			lookupTokenId,
			lookupConditionId,
			redeemFn: redeemByConditionId,
		});
		liveSettlerInstance.start();
	}

	const states = createMarketStateMap(markets);
	const onchainRuntime = createOnchainRuntime({ readKnownTokenIds });

	const orderTracker: SimpleOrderTracker = {
		orders: new Map<string, number>(),
		lastTradeMs: 0,
		cooldownMs: 0,
		keyFor(marketId: string, windowSlug: string): string {
			return `${marketId}:${windowSlug}`;
		},
		hasOrder(marketId: string, windowSlug: string): boolean {
			return this.orders.has(this.keyFor(marketId, windowSlug));
		},
		totalActive(): number {
			return this.orders.size;
		},
		record(marketId: string, windowSlug: string, recordedAtMs?: number): void {
			const normalizedTs =
				typeof recordedAtMs === "number" && Number.isFinite(recordedAtMs) ? Math.floor(recordedAtMs) : Date.now();
			const ts = Math.min(normalizedTs, Date.now());
			this.orders.set(this.keyFor(marketId, windowSlug), ts);
			this.lastTradeMs = Math.max(this.lastTradeMs, ts);
		},
		clear(): void {
			this.orders.clear();
			this.lastTradeMs = 0;
		},
		prune(): void {
			const cutoff = Date.now() - 16 * 60_000;
			for (const [key, ts] of this.orders) {
				if (ts < cutoff) this.orders.delete(key);
			}
		},
		onCooldown(): boolean {
			if (this.cooldownMs <= 0) return false;
			return Date.now() - this.lastTradeMs < this.cooldownMs;
		},
	};

	// Restore tracker state from DB to prevent duplicate orders after restart.
	// Without this, a restart mid-window could allow re-placing orders.
	const pendingLive = liveAccount.getPendingTrades();
	let restoredCount = 0;
	for (const trade of pendingLive) {
		// Restore orderTracker — use windowStartMs as slug proxy for position counting.
		// The exact Polymarket slug isn't stored, but this ensures totalActive() is correct
		// and hasOrder() blocks the same market in the same window.
		const slugProxy = String(trade.windowStartMs);
		const tradeTsMs = Date.parse(trade.timestamp);
		orderTracker.record(trade.marketId, slugProxy, Number.isFinite(tradeTsMs) ? tradeTsMs : trade.windowStartMs);

		// Restore liveTracker — only for trades in the current window
		const tradeMarket = getMarketById(trade.marketId);
		const tradeWindowTiming = getCandleWindowTiming(tradeMarket?.candleWindowMinutes ?? 15);
		if (trade.windowStartMs === tradeWindowTiming.startMs) {
			liveTracker.record(trade.marketId, trade.windowStartMs);
		}
		restoredCount++;
	}
	if (restoredCount > 0) {
		log.info(
			`Restored ${restoredCount} pending live trades into trackers (window active: ${liveTracker.canTradeGlobally(1) ? 0 : "≥1"})`,
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
		const rowMarket = getMarketById(marketId);
		const rowTiming = getCandleWindowTiming(rowMarket?.candleWindowMinutes ?? 15);
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
				if (windowStartMs === rowTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
					liveTracker.record(marketId, windowStartMs);
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
		if (windowStartMs === rowTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
			liveTracker.record(marketId, windowStartMs);
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

	const ensureOrderPolling = () => {
		const clobClient = getClient();
		if (clobClient) {
			orderManager.setClient(clobClient);
			orderManager.startPolling();
			if (getOpenGtdOrderCount() > 0) {
				startHeartbeat();
			}
			return;
		}
		orderManager.setClient(null);
		if (!isLiveRunning()) {
			orderManager.stopPolling();
		}
	};

	const prevWindowStartMs = new Map<string, number>();
	registerShutdownHandlers({
		getLiveSettler: () => liveSettlerInstance,
		clearLiveSettler: () => {
			liveSettlerInstance = null;
		},
		orderManager,
		streams,
		clobWs,
		onchainRuntime,
		getRedeemTimerHandle: () => redeemTimerHandle,
		clearRedeemTimerHandle: () => {
			redeemTimerHandle = null;
		},
	});

	let consecutiveAllFails = 0;
	const SAFE_MODE_THRESHOLD = 3;
	const PRUNE_INTERVAL_MS = 3_600_000;
	let lastPruneMs = 0;

	if (Date.now() - lastPruneMs >= PRUNE_INTERVAL_MS) {
		try {
			const result = await pruneDatabase();
			const total = Object.values(result.pruned).reduce((a: number, b: number) => a + b, 0);
			if (total > 0) {
				log.info("DB pruned", result.pruned);
			}
			paperAccount.pruneTrades(500);
			liveAccount.pruneTrades(500);
		} catch (err) {
			log.warn("DB prune failed", { error: err instanceof Error ? err.message : String(err) });
		}
		lastPruneMs = Date.now();
	}

	while (true) {
		ensureOrderPolling();
		onchainRuntime.ensurePipelines();

		const shouldRunLoop = isPaperRunning() || isLiveRunning();
		if (!shouldRunLoop) {
			await sleep(1000);
			continue;
		}

		await runSettlementCycle({
			markets,
			states,
			prevWindowStartMs,
			paperAccount,
			liveAccount,
		});

		ensureLiveSettler();

		const oldestActiveWindow = Math.min(...markets.map((m) => getCandleWindowTiming(m.candleWindowMinutes).startMs));
		paperTracker.prune(oldestActiveWindow);
		liveTracker.prune(oldestActiveWindow);
		orderTracker.prune();

		const results: ProcessMarketResult[] = await Promise.all(
			markets.map(async (market) => {
				try {
					const state = states.get(market.id);
					if (!state) {
						throw new Error(`missing_state_${market.id}`);
					}
					const timing = getCandleWindowTiming(market.candleWindowMinutes);
					return await processMarket({
						market,
						timing,
						streams,
						state,
					});
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					return { ok: false, market, error: message };
				}
			}),
		);

		const allFailed = results.every((r) => !r.ok);
		if (allFailed && results.length > 0) {
			consecutiveAllFails++;
			log.warn(`All markets failed (${consecutiveAllFails}/${SAFE_MODE_THRESHOLD})`);
			for (const r of results) {
				if (!r.ok) log.warn(`  ${r.market.id}: ${r.error}`);
			}
			if (consecutiveAllFails >= SAFE_MODE_THRESHOLD) {
				log.error("Safe mode: all markets failed consecutively, skipping trade execution this tick");
				await sleep(1000);
				continue;
			}
		} else {
			if (consecutiveAllFails >= SAFE_MODE_THRESHOLD) {
				log.info("Exiting safe mode: at least one market recovered");
			}
			consecutiveAllFails = 0;
		}

		const newTokenIds = results
			.filter((r) => r.ok && r.signalPayload?.tokens)
			.flatMap((r) => {
				const t = r.signalPayload?.tokens;
				return t ? [t.upTokenId, t.downTokenId] : [];
			});
		if (newTokenIds.length > 0) {
			clobWs.subscribe(newTokenIds);
		}

		await dispatchTradeCandidates({
			results,
			paperTracker,
			liveTracker,
			orderTracker,
			onLiveOrderPlaced: ({
				orderId,
				marketId,
				windowKey,
				side,
				tokenId,
				price,
				size,
				priceToBeat,
				currentPriceAtEntry,
			}) => {
				liveAccount.reserveBalance(size * price);
				orderManager.addOrderWithTracking(
					{
						orderId,
						marketId,
						windowSlug: windowKey,
						side,
						tokenId,
						price,
						size,
						priceToBeat,
						currentPriceAtEntry,
						placedAt: Date.now(),
					},
					true,
				);
			},
		});

		publishMarketSnapshots(results);

		renderDashboard(results);
		await sleep(CONFIG.pollIntervalMs);
	}
}

main();
