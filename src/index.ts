import { startApiServer } from "./api.ts";
import { applyEvent, initAccountState, resetAccountState, updateFromSnapshot } from "./blockchain/accountState.ts";
import { startReconciler } from "./blockchain/reconciler.ts";
import { fetchRedeemablePositions, redeemAll, redeemByConditionId } from "./blockchain/redeemer.ts";
import { CONFIG, startConfigWatcher } from "./core/config.ts";
import { env } from "./core/env.ts";
import { createLogger } from "./core/logger.ts";
import { getActiveMarkets } from "./core/markets.ts";
import {
	emitBalanceSnapshot,
	emitStateSnapshot,
	getUpdatedAt,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
	setLiveRunning,
	setOnchainBalance,
	setPaperRunning,
	updateMarkets,
} from "./core/state.ts";
import { getCandleWindowTiming, sleep } from "./core/utils.ts";
import { startMultiBinanceTradeStream } from "./data/binanceWs.ts";
import { startChainlinkPriceStream } from "./data/chainlinkWs.ts";
import { startBalancePolling } from "./data/polygonBalance.ts";
import { startOnChainEventStream } from "./data/polygonEvents.ts";
import type { ClobWsHandle } from "./data/polymarketClobWs.ts";
import { startClobMarketWs } from "./data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "./data/polymarketLiveWs.ts";
import { closeDb } from "./db/client.ts";
import { onchainQueries, pendingOrderQueries, pruneDatabase, tradeQueries } from "./db/queries.ts";
import type { MarketState, ProcessMarketResult } from "./pipeline/processMarket.ts";
import { processMarket as processMarketPipeline } from "./pipeline/processMarket.ts";
import { getAccount, initAccountStats, liveAccount, paperAccount } from "./trading/accountStats.ts";
import { LiveSettler } from "./trading/liveSettler.ts";
import { OrderManager, type TrackedOrder } from "./trading/orderManager.ts";

import { renderDashboard } from "./trading/terminal.ts";
import {
	connectWallet,
	executeTrade,
	getClient,
	getOpenGtdOrderCount,
	getWallet,
	registerOpenGtdOrder,
	startHeartbeat,
	stopHeartbeat,
	unregisterOpenGtdOrder,
} from "./trading/trader.ts";
import type { MarketSnapshot, StreamHandles, WsStreamHandle } from "./types.ts";

export type { ProcessMarketResult } from "./pipeline/processMarket.ts";

const log = createLogger("bot");
const processMarket = processMarketPipeline;

interface SimpleOrderTracker {
	orders: Map<string, number>;
	lastTradeMs: number;
	cooldownMs: number;
	windowStartMs: number;
	keyFor(marketId: string, windowSlug: string): string;
	hasOrder(marketId: string, windowSlug: string): boolean;
	totalActive(): number;
	record(marketId: string, windowSlug: string, recordedAtMs?: number): void;
	clear(): void;
	setWindow(startMs: number): void;
	prune(): void;
	onCooldown(): boolean;
}

function createTradeTracker() {
	return {
		markets: new Set<string>(),
		windowStartMs: 0,
		globalCount: 0,
		clear() {
			this.markets.clear();
			this.globalCount = 0;
			this.windowStartMs = 0;
		},
		setWindow(startMs: number) {
			if (this.windowStartMs !== startMs) {
				this.clear();
				this.windowStartMs = startMs;
			}
		},
		has(marketId: string, startMs: number): boolean {
			return this.markets.has(`${marketId}:${startMs}`);
		},
		record(marketId: string, startMs: number) {
			this.markets.add(`${marketId}:${startMs}`);
			this.globalCount++;
		},
		canTradeGlobally(maxGlobal: number): boolean {
			return this.globalCount < maxGlobal;
		},
	};
}

const paperTracker = createTradeTracker();
const liveTracker = createTradeTracker();

let balancePollingHandle: { getLast(): unknown; close(): void } | null = null;
let eventStreamHandle: { close(): void } | null = null;
let reconcilerHandle: { runNow(): Promise<number>; close(): void } | null = null;
let redeemTimerHandle: ReturnType<typeof setInterval> | null = null;
let activeOnchainWallet: string | null = null;
let liveSettlerInstance: LiveSettler | null = null;

// Auto-redeem configuration
const AUTO_REDEEM_ENABLED = env.AUTO_REDEEM_ENABLED;
const AUTO_REDEEM_INTERVAL_MS = env.AUTO_REDEEM_INTERVAL_MS;

function collectLatestPrices(
	markets: ReadonlyArray<{ id: string }>,
	states: Map<string, MarketState>,
): Map<string, number> {
	const prices = new Map<string, number>();
	for (const market of markets) {
		const marketState = states.get(market.id);
		const p = marketState?.prevCurrentPrice;
		if (p !== null && p !== undefined) {
			prices.set(market.id, p);
		}
	}
	return prices;
}

async function readKnownTokenIds(): Promise<string[]> {
	try {
		const rows = await onchainQueries.getKnownCtfTokens();
		return rows.map((row) => String(row?.tokenId ?? "").trim()).filter((tokenId) => tokenId.length > 0);
	} catch {
		return [];
	}
}

async function main(): Promise<void> {
	startApiServer();
	startConfigWatcher();
	initAccountStats();

	// Auto-connect wallet if PRIVATE_KEY is configured
	if (env.PRIVATE_KEY) {
		try {
			const { address } = await connectWallet(env.PRIVATE_KEY);
			log.info(`Auto-connected wallet: ${address}`);

			// Start auto-redeem timer if enabled
			if (AUTO_REDEEM_ENABLED) {
				log.info(`Auto-redeem enabled: checking every ${AUTO_REDEEM_INTERVAL_MS / 60_000} minutes`);
				redeemTimerHandle = setInterval(async () => {
					try {
						if (liveSettlerInstance?.isRunning()) {
							log.debug("Auto-redeem skipped: LiveSettler is active");
							return;
						}
						const wallet = getWallet();
						if (!wallet) {
							log.warn("Auto-redeem skipped: wallet not connected");
							return;
						}

						const positions = await fetchRedeemablePositions(wallet.address);
						if (positions.length === 0) {
							log.debug("Auto-redeem: no redeemable positions found");
							return;
						}

						const totalValue = positions.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
						log.info(
							`Auto-redeem: found ${positions.length} position(s) worth $${totalValue.toFixed(2)}, redeeming...`,
						);

						const results = await redeemAll(wallet);
						const successCount = results.filter((r) => !r.error).length;
						const redeemedValue = results
							.filter((r) => r.value !== undefined)
							.reduce((sum, r) => sum + (r.value ?? 0), 0);

						if (successCount > 0) {
							log.info(
								`Auto-redeem success: ${successCount}/${results.length} redeemed, total value: $${redeemedValue.toFixed(2)}`,
							);
						} else {
							log.warn(`Auto-redeem failed: all ${results.length} redemption(s) failed`);
						}

						// Log individual failures
						for (const result of results) {
							if (result.error) {
								log.warn(`Redeem failed for ${result.conditionId.slice(0, 10)}...: ${result.error}`);
							}
						}
					} catch (err) {
						log.error("Auto-redeem error:", err instanceof Error ? err.message : String(err));
					}
				}, AUTO_REDEEM_INTERVAL_MS);

				// Run once on startup to check for any pending redemptions
				setTimeout(async () => {
					try {
						const wallet = getWallet();
						if (!wallet) return;

						const positions = await fetchRedeemablePositions(wallet.address);
						if (positions.length > 0) {
							const totalValue = positions.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
							log.info(`Startup auto-redeem check: ${positions.length} position(s) worth $${totalValue.toFixed(2)}`);
						}
					} catch (err) {
						log.error("Startup redeem check failed:", err instanceof Error ? err.message : String(err));
					}
				}, 5000); // Check after 5 seconds to ensure RPC is ready
			}
		} catch (err) {
			log.error("Failed to auto-connect wallet:", err instanceof Error ? err.message : String(err));
		}
	}

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
				const windowStartMs = Number.isFinite(parsedWindowStartMs)
					? parsedWindowStartMs
					: getCandleWindowTiming(CONFIG.candleWindowMinutes).startMs;
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
					const currentTiming = getCandleWindowTiming(CONFIG.candleWindowMinutes);
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
	const binanceSymbols = markets.map((m) => m.binanceSymbol);
	const polymarketSymbols = markets.map((m) => m.chainlink.wsSymbol);

	const streams: StreamHandles = {
		binance: startMultiBinanceTradeStream(binanceSymbols),
		polymarket: startMultiPolymarketPriceStream(polymarketSymbols),
		chainlink: new Map<string, WsStreamHandle>(),
	};

	for (const market of markets) {
		streams.chainlink.set(
			market.id,
			startChainlinkPriceStream({
				aggregator: market.chainlink.aggregator,
				decimals: market.chainlink.decimals,
			}),
		);
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
		if (!isLiveRunning()) return;

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

	const states = new Map<string, MarketState>(
		markets.map((m) => [
			m.id,
			{
				prevSpotPrice: null,
				prevCurrentPrice: null,
				priceToBeatState: { slug: null, value: null, setAtMs: null },
			},
		]),
	);

	const orderTracker: SimpleOrderTracker = {
		orders: new Map<string, number>(),
		lastTradeMs: 0,
		cooldownMs: 0,
		windowStartMs: 0,
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
		setWindow(startMs: number): void {
			if (this.windowStartMs !== startMs) {
				this.clear();
				this.windowStartMs = startMs;
			}
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
	const currentTiming = getCandleWindowTiming(CONFIG.candleWindowMinutes);
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
		if (trade.windowStartMs === currentTiming.startMs) {
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
				if (windowStartMs === currentTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
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
		if (windowStartMs === currentTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
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

	const closeOnchainPipelines = () => {
		if (balancePollingHandle) {
			balancePollingHandle.close();
			balancePollingHandle = null;
		}
		if (eventStreamHandle) {
			eventStreamHandle.close();
			eventStreamHandle = null;
		}
		if (reconcilerHandle) {
			reconcilerHandle.close();
			reconcilerHandle = null;
		}
		activeOnchainWallet = null;
		resetAccountState();
	};

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

	const ensureOnchainPipelines = () => {
		const wallet = getWallet();
		if (!wallet) {
			if (activeOnchainWallet !== null) {
				log.info("Wallet disconnected, stopping on-chain pipelines");
				closeOnchainPipelines();
			}
			return;
		}

		const walletAddress = wallet.address.toLowerCase();
		const walletChanged = activeOnchainWallet !== null && activeOnchainWallet !== walletAddress;
		if (walletChanged) {
			log.info(`Wallet changed (${activeOnchainWallet} -> ${walletAddress}), restarting on-chain pipelines`);
			closeOnchainPipelines();
		}

		if (activeOnchainWallet === walletAddress && balancePollingHandle && eventStreamHandle && reconcilerHandle) {
			return;
		}

		initAccountState(walletAddress);
		balancePollingHandle = startBalancePolling({
			wallet: walletAddress,
			knownTokenIds: readKnownTokenIds,
			onUpdate: (snapshot) => {
				updateFromSnapshot(snapshot);
				setOnchainBalance(snapshot);
				emitBalanceSnapshot(snapshot);
			},
		});
		eventStreamHandle = startOnChainEventStream({
			wallet: walletAddress,
			onEvent: (event) => {
				applyEvent(event);
				void onchainQueries
					.insertEvent({
						txHash: event.txHash,
						logIndex: event.logIndex,
						blockNumber: event.blockNumber,
						eventType: event.type,
						fromAddr: event.from,
						toAddr: event.to,
						tokenId: event.tokenId,
						value: event.value,
						rawData: JSON.stringify(event),
					})
					.catch((err) => {
						log.warn("Failed to persist on-chain event", err);
					});
			},
		});
		reconcilerHandle = startReconciler({ wallet: walletAddress });
		activeOnchainWallet = walletAddress;
		log.info("On-chain balance/events/reconciler pipelines started");
	};

	let prevWindowStartMs: number | null = null;
	const shutdown = () => {
		log.info("Shutdown signal received, stopping bot...");
		if (liveSettlerInstance) {
			liveSettlerInstance.stop();
			liveSettlerInstance = null;
		}
		orderManager.stopPolling();
		stopHeartbeat();
		setPaperRunning(false);
		setLiveRunning(false);
		streams.binance.close();
		streams.polymarket.close();
		clobWs.close();
		for (const [, handle] of streams.chainlink) {
			handle.close();
		}
		closeOnchainPipelines();
		if (redeemTimerHandle) {
			clearInterval(redeemTimerHandle);
			redeemTimerHandle = null;
			log.info("Auto-redeem timer stopped");
		}
		void closeDb().then(() => {
			setTimeout(() => process.exit(0), 2000);
		});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

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
		ensureOnchainPipelines();

		const shouldRunLoop = isPaperRunning() || isLiveRunning();
		if (!shouldRunLoop) {
			await sleep(1000);
			continue;
		}

		const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
		const latestPrices = collectLatestPrices(markets, states);

		if (latestPrices.size > 0) {
			const paperRecovered = await paperAccount.resolveExpiredTrades(latestPrices, CONFIG.candleWindowMinutes);
			if (paperRecovered > 0) {
				log.info(`Recovered expired paper trades: ${paperRecovered}`);
			}
			// Live settlement runs regardless of isLiveRunning() — pending trades must
			// settle even after live trading is stopped (fix: issue 2.1)
			const liveRecovered = await liveAccount.resolveExpiredTrades(latestPrices, CONFIG.candleWindowMinutes);
			if (liveRecovered > 0) {
				log.info(`Recovered expired live trades: ${liveRecovered}`);
			}
		}

		if (prevWindowStartMs !== null && prevWindowStartMs !== timing.startMs) {
			if (latestPrices.size > 0) {
				const paperResolved = await paperAccount.resolveTrades(prevWindowStartMs, latestPrices);
				if (paperResolved > 0) {
					log.info(`Paper window settled: ${paperResolved}`);
				}
				const liveResolved = await liveAccount.resolveTrades(prevWindowStartMs, latestPrices);
				if (liveResolved > 0) {
					log.info(`Live window settled: ${liveResolved}`);
				}
			}
		}

		// Force-resolve trades stuck beyond 1 hour — safety net for issue 7.2
		const FORCE_RESOLVE_MAX_AGE_MS = 60 * 60_000;
		const paperForced = await paperAccount.forceResolveStuckTrades(FORCE_RESOLVE_MAX_AGE_MS);
		if (paperForced > 0) log.warn(`Force-resolved ${paperForced} stuck paper trade(s)`);
		const liveForced = await liveAccount.forceResolveStuckTrades(FORCE_RESOLVE_MAX_AGE_MS);
		if (liveForced > 0) log.warn(`Force-resolved ${liveForced} stuck live trade(s)`);

		ensureLiveSettler();
		prevWindowStartMs = timing.startMs;

		orderTracker.setWindow(timing.startMs);
		paperTracker.setWindow(timing.startMs);
		liveTracker.setWindow(timing.startMs);
		const results: ProcessMarketResult[] = await Promise.all(
			markets.map(async (market) => {
				try {
					const state = states.get(market.id);
					if (!state) {
						throw new Error(`missing_state_${market.id}`);
					}
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

		const maxGlobalTrades = CONFIG.strategy.maxGlobalTradesPerWindow;
		const candidates = results
			.filter((r) => r.ok && r.rec?.action === "ENTER" && r.signalPayload)
			.filter((r) => {
				const sig = r.signalPayload;
				if (!sig) return false;
				if (sig.priceToBeat === null || sig.priceToBeat === undefined || sig.priceToBeat === 0) return false;
				if (sig.currentPrice === null || sig.currentPrice === undefined) return false;
				return true;
			})
			.filter((r) => {
				const tl = r.timeLeftMin ?? 0;
				const windowMin = CONFIG.candleWindowMinutes ?? 15;
				const elapsed = windowMin - tl;
				if (elapsed < 3) return false;
				if (tl < 3) return false;
				return true;
			})
			.sort((a, b) => {
				const edgeA = Number(a.rec?.edge ?? 0);
				const edgeB = Number(b.rec?.edge ?? 0);
				if (edgeB !== edgeA) return edgeB - edgeA;
				return Number(a.rawSum ?? 1) - Number(b.rawSum ?? 1);
			});

		let successfulTradesThisTick = 0;
		for (const candidate of candidates) {
			const sig = candidate.signalPayload;
			if (!sig) continue;
			const mkt = candidate.market;
			const windowKey = String(timing.startMs);
			const sideBook = sig.side === "UP" ? (candidate.orderbook?.up ?? null) : (candidate.orderbook?.down ?? null);
			const sideLiquidity = sideBook?.askLiquidity ?? sideBook?.bidLiquidity ?? null;

			if (isPaperRunning()) {
				const paperAcc = getAccount("paper");
				const tradeSize = Number(CONFIG.paperRisk.maxTradeSizeUsdc || 0);
				const affordCheck = paperAcc.canAffordTradeWithStopCheck(tradeSize);
				const minPaperLiquidity = Number(CONFIG.paperRisk.minLiquidity || 0);
				const hasPaperLiquidity = sideLiquidity !== null && sideLiquidity >= minPaperLiquidity;
				if (
					!paperTracker.has(mkt.id, timing.startMs) &&
					affordCheck.canTrade &&
					hasPaperLiquidity &&
					paperTracker.canTradeGlobally(Math.min(maxGlobalTrades, CONFIG.paperRisk.maxTradesPerWindow)) &&
					paperAcc.getPendingTrades().length < CONFIG.paperRisk.maxOpenPositions
				) {
					const result = await executeTrade(sig, { marketConfig: mkt, riskConfig: CONFIG.paperRisk }, "paper");
					if (result?.success) {
						paperTracker.record(mkt.id, timing.startMs);
					} else {
						log.warn(`Paper trade failed for ${mkt.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
					}
				} else if (!hasPaperLiquidity) {
					log.info(
						`Skip ${mkt.id} paper: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minPaperLiquidity.toFixed(0)}`,
					);
				} else if (!affordCheck.canTrade) {
					log.warn(`Trade rejected for ${mkt.id}: ${affordCheck.reason}`);
				}
			}

			if (isLiveRunning()) {
				const liveAcc = getAccount("live");
				const minLiveLiquidity = Number(CONFIG.liveRisk.minLiquidity || 0);
				const hasLiveLiquidity = sideLiquidity !== null && sideLiquidity >= minLiveLiquidity;
				if (!hasLiveLiquidity) {
					log.info(
						`Skip ${mkt.id} live: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minLiveLiquidity.toFixed(0)}`,
					);
				} else {
					const liveWindowLimit = Math.min(maxGlobalTrades, CONFIG.liveRisk.maxTradesPerWindow);
					const liveTradeSize = Number(CONFIG.liveRisk.maxTradeSizeUsdc || 0);
					const liveAffordCheck = liveAcc.canAffordTradeWithStopCheck(liveTradeSize);
					const canPlace =
						orderTracker &&
						!orderTracker.hasOrder(mkt.id, windowKey) &&
						!orderTracker.onCooldown() &&
						orderTracker.totalActive() < CONFIG.liveRisk.maxOpenPositions &&
						successfulTradesThisTick < liveWindowLimit &&
						!liveTracker.has(mkt.id, timing.startMs) &&
						liveTracker.canTradeGlobally(liveWindowLimit) &&
						liveAffordCheck.canTrade;

					if (canPlace) {
						const result = await executeTrade(sig, { marketConfig: mkt, riskConfig: CONFIG.liveRisk }, "live");
						if (result?.success) {
							orderTracker.record(mkt.id, windowKey);
							liveTracker.record(mkt.id, timing.startMs);
							successfulTradesThisTick += 1;

							if (result.orderId && (result.isGtdOrder ?? true)) {
								const tradeTokenId = sig.tokens
									? sig.side === "UP"
										? sig.tokens.upTokenId
										: sig.tokens.downTokenId
									: undefined;
								const gtdPrice = result.tradePrice ?? 0;
								const gtdSize = Number(CONFIG.liveRisk.maxTradeSizeUsdc || 0);
								liveAcc.reserveBalance(gtdSize * gtdPrice);
								orderManager.addOrderWithTracking(
									{
										orderId: result.orderId,
										marketId: mkt.id,
										windowSlug: windowKey,
										side: sig.side ?? "UP",
										tokenId: tradeTokenId,
										price: gtdPrice,
										size: gtdSize,
										priceToBeat: sig.priceToBeat ?? null,
										currentPriceAtEntry: sig.currentPrice ?? null,
										placedAt: Date.now(),
									},
									true,
								);
							}
						} else {
							log.warn(`Live trade failed for ${mkt.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
						}
					}
				}
			}
		}

		const snapshots = results.map(
			(r): MarketSnapshot => ({
				id: r.market.id,
				label: r.market.label,
				ok: r.ok,
				error: r.error,
				spotPrice: r.spotPrice ?? null,
				currentPrice: r.currentPrice ?? null,
				priceToBeat: r.priceToBeat ?? null,
				marketUp: r.marketUp ?? null,
				marketDown: r.marketDown ?? null,
				rawSum: r.rawSum ?? null,
				arbitrage: r.arbitrage ?? false,
				predictLong: r.pLong ? Number(r.pLong) : null,
				predictShort: r.pShort ? Number(r.pShort) : null,
				predictDirection: (r.predictNarrative as "LONG" | "SHORT" | "NEUTRAL") ?? "NEUTRAL",
				haColor: r.consec?.color ?? null,
				haConsecutive: r.consec?.count ?? 0,
				rsi: r.rsiNow ?? null,
				macd: r.macd
					? {
							macd: r.macd.macd,
							signal: r.macd.signal,
							hist: r.macd.hist,
							histDelta: r.macd.histDelta,
						}
					: null,
				vwapSlope: r.vwapSlope ?? null,
				timeLeftMin: r.timeLeftMin ?? null,
				phase: r.rec?.phase ?? null,
				action: r.rec?.action ?? "NO_TRADE",
				side: r.rec?.side ?? null,
				edge: r.rec?.edge ?? null,
				strength: r.rec?.strength ?? null,
				reason: r.rec?.reason ?? null,
				volatility15m: r.volatility15m ?? null,
				blendSource: r.blendSource ?? null,
				volImpliedUp: r.volImpliedUp ?? null,
				binanceChainlinkDelta: r.binanceChainlinkDelta ?? null,
				orderbookImbalance: r.orderbookImbalance ?? null,
			}),
		);
		updateMarkets(snapshots);
		emitStateSnapshot({
			markets: snapshots,
			updatedAt: getUpdatedAt(),
			paperRunning: isPaperRunning(),
			liveRunning: isLiveRunning(),
			paperPendingStart: isPaperPendingStart(),
			paperPendingStop: isPaperPendingStop(),
			livePendingStart: isLivePendingStart(),
			livePendingStop: isLivePendingStop(),
			paperStats: paperAccount.getStats(),
			liveStats: liveAccount.getStats(),
			liveTodayStats: liveAccount.getTodayStats(),
			paperBalance: paperAccount.getBalance(),
			liveBalance: liveAccount.getBalance(),
			todayStats: paperAccount.getTodayStats(),
			stopLoss: paperAccount.isStopped() ? paperAccount.getStopReason() : null,
			liveStopLoss: liveAccount.isStopped() ? liveAccount.getStopReason() : null,
		});

		renderDashboard(results);
		await sleep(CONFIG.pollIntervalMs);
	}
}

main();
