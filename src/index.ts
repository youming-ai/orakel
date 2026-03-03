import { startApiServer } from "./api.ts";
import { fetchRedeemablePositions, redeemAll } from "./blockchain/redeemer.ts";
import { CONFIG } from "./core/config.ts";
import { getDb } from "./core/db.ts";
import { env } from "./core/env.ts";
import { createLogger } from "./core/logger.ts";
import { getActiveMarkets } from "./core/markets.ts";
import {
	emitStateSnapshot,
	getUpdatedAt,
	isLiveRunning,
	isPaperRunning,
	setLiveRunning,
	setPaperRunning,
	updateMarkets,
} from "./core/state.ts";
import { getCandleWindowTiming, sleep } from "./core/utils.ts";
import { startMultiBinanceTradeStream } from "./data/binanceWs.ts";
import { startChainlinkPriceStream } from "./data/chainlinkWs.ts";
import type { ClobWsHandle } from "./data/polymarketClobWs.ts";
import { startClobMarketWs } from "./data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "./data/polymarketLiveWs.ts";
import type { MarketState, ProcessMarketResult } from "./pipeline/processMarket.ts";
import { processMarket as processMarketPipeline } from "./pipeline/processMarket.ts";
import { getAccount, initAccountStats, liveAccount, paperAccount } from "./trading/accountStats.ts";
import { OrderManager, type TrackedOrder } from "./trading/orderManager.ts";
import { shouldTakeTrade } from "./trading/strategyRefinement.ts";
import { renderDashboard } from "./trading/terminal.ts";
import { connectWallet, executeTrade, getWallet, stopHeartbeat, unregisterOpenGtdOrder } from "./trading/trader.ts";
import type { MarketSnapshot, StreamHandles, WsStreamHandle } from "./types.ts";

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
	record(marketId: string, windowSlug: string): void;
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

// Auto-redeem configuration
const AUTO_REDEEM_ENABLED = env.AUTO_REDEEM_ENABLED;
const AUTO_REDEEM_INTERVAL_MS = env.AUTO_REDEEM_INTERVAL_MS; // Default: 30 minutes (set in env.ts)

async function main(): Promise<void> {
	startApiServer();
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

	// Periodic WAL checkpoint to prevent database corruption
	const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
	log.info(`WAL checkpoint enabled: running every ${WAL_CHECKPOINT_INTERVAL_MS / 60_000} minutes`);
	setInterval(() => {
		try {
			const db = getDb();
			db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
			log.debug("WAL checkpoint completed");
		} catch (err) {
			log.error("WAL checkpoint failed:", err instanceof Error ? err.message : String(err));
		}
	}, WAL_CHECKPOINT_INTERVAL_MS);

	const orderManager = new OrderManager();

	orderManager.onOrderStatusChange((orderId: string, status: TrackedOrder["status"]) => {
		if (status === "filled" || status === "cancelled" || status === "expired") {
			unregisterOpenGtdOrder(orderId);
		}
	});

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
		cooldownMs: 30_000,
		keyFor(marketId: string, windowSlug: string): string {
			return `${marketId}:${windowSlug}`;
		},
		hasOrder(marketId: string, windowSlug: string): boolean {
			return this.orders.has(this.keyFor(marketId, windowSlug));
		},
		totalActive(): number {
			return this.orders.size;
		},
		record(marketId: string, windowSlug: string): void {
			this.orders.set(this.keyFor(marketId, windowSlug), Date.now());
			this.lastTradeMs = Date.now();
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
		orderTracker.record(trade.marketId, slugProxy);

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

	let prevWindowStartMs: number | null = null;
	const shutdown = () => {
		log.info("Shutdown signal received, stopping bot...");
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
		if (redeemTimerHandle) {
			clearInterval(redeemTimerHandle);
			redeemTimerHandle = null;
			log.info("Auto-redeem timer stopped");
		}
		setTimeout(() => process.exit(0), 2000);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	let consecutiveAllFails = 0;
	const SAFE_MODE_THRESHOLD = 3;

	while (true) {
		const shouldRunLoop = isPaperRunning() || isLiveRunning();
		if (!shouldRunLoop) {
			await sleep(1000);
			continue;
		}

		const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);

		if (prevWindowStartMs !== null && prevWindowStartMs !== timing.startMs) {
			const finalPrices = new Map<string, number>();
			for (const market of markets) {
				const marketState = states.get(market.id);
				if (marketState?.prevCurrentPrice !== null && marketState?.prevCurrentPrice !== undefined) {
					finalPrices.set(market.id, marketState.prevCurrentPrice);
				}
			}
			if (finalPrices.size > 0) {
				const paperResolved = paperAccount.resolveTrades(prevWindowStartMs, finalPrices);
				const liveResolved = liveAccount.resolveTrades(prevWindowStartMs, finalPrices);
				if (paperResolved > 0 || liveResolved > 0) {
					log.info(`Window settled: paper=${paperResolved} live=${liveResolved}`);
				}
			}
		}
		prevWindowStartMs = timing.startMs;

		orderTracker.prune();
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

		const maxGlobalTrades = Number(
			(CONFIG.strategy as { maxGlobalTradesPerWindow?: number }).maxGlobalTradesPerWindow ?? 1,
		);
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
			.filter((r) => {
				const sig = r.signalPayload;
				if (!sig) return false;
				const result = shouldTakeTrade({
					market: r.market.id,
					regime: r.rec?.regime ?? null,
					volatility: r.volatility15m ?? 0,
				});
				if (!result.shouldTrade) {
					log.info(`Skip ${r.market.id}: ${result.reason}`);
				}
				return result.shouldTrade;
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
			const slug = candidate.marketSlug ?? "";
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
						!orderTracker.hasOrder(mkt.id, slug) &&
						!orderTracker.onCooldown() &&
						orderTracker.totalActive() < CONFIG.liveRisk.maxOpenPositions &&
						successfulTradesThisTick < liveWindowLimit &&
						!liveTracker.has(mkt.id, timing.startMs) &&
						liveTracker.canTradeGlobally(liveWindowLimit) &&
						liveAffordCheck.canTrade;

					if (canPlace) {
						const result = await executeTrade(sig, { marketConfig: mkt, riskConfig: CONFIG.liveRisk }, "live");
						if (result?.success) {
							orderTracker.record(mkt.id, slug);
							liveTracker.record(mkt.id, timing.startMs);
							successfulTradesThisTick += 1;

							if (result.orderId) {
								const tradeTokenId = sig.tokens
									? sig.side === "UP"
										? sig.tokens.upTokenId
										: sig.tokens.downTokenId
									: undefined;
								orderManager.addOrderWithTracking(
									{
										orderId: result.orderId,
										marketId: mkt.id,
										windowSlug: slug,
										side: sig.side ?? "UP",
										tokenId: tradeTokenId,
										price: result.tradePrice ?? 0,
										size: Number(CONFIG.liveRisk.maxTradeSizeUsdc || 0),
										placedAt: Date.now(),
									},
									result.isGtdOrder ?? true,
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
				confidence: r.rec?.confidence ?? undefined,
			}),
		);
		updateMarkets(snapshots);
		emitStateSnapshot({
			markets: snapshots,
			updatedAt: getUpdatedAt(),
			paperRunning: isPaperRunning(),
			liveRunning: isLiveRunning(),
			paperPendingStart: false,
			paperPendingStop: false,
			livePendingStart: false,
			livePendingStop: false,
			paperStats: paperAccount.getStats(),
			liveStats: liveAccount.getStats(),
			liveTodayStats: liveAccount.getTodayStats(),
		});

		renderDashboard(results);
		await sleep(CONFIG.pollIntervalMs);
	}
}

main();
