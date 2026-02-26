import { startApiServer } from "./api.ts";
import { CONFIG } from "./config.ts";
import { startMultiBinanceTradeStream } from "./data/binanceWs.ts";
import { startChainlinkPriceStream } from "./data/chainlinkWs.ts";
import type { ClobWsHandle } from "./data/polymarketClobWs.ts";
import { startClobMarketWs } from "./data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "./data/polymarketLiveWs.ts";
import { createLogger } from "./logger.ts";
import { getActiveMarkets } from "./markets.ts";
import { OrderManager, type TrackedOrder } from "./orderManager.ts";
import { canAffordTradeWithStopCheck, getPaperStats, getPendingPaperTrades, resolvePaperTrades } from "./paperStats.ts";
import type { MarketState, ProcessMarketResult } from "./pipeline/processMarket.ts";
import { processMarket as processMarketPipeline } from "./pipeline/processMarket.ts";
import { redeemAll } from "./redeemer.ts";
import {
	clearLivePending,
	clearPaperPending,
	emitStateSnapshot,
	getUpdatedAt,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
	setLiveRunning,
	setPaperRunning,
	updateMarkets,
} from "./state.ts";
import { shouldTakeTrade } from "./strategyRefinement.ts";
import { renderDashboard } from "./terminal.ts";
import {
	executeTrade,
	getClientStatus,
	getWallet,
	startHeartbeat,
	stopHeartbeat,
	unregisterOpenGtdOrder,
	updatePnl,
} from "./trader.ts";
import type { MarketSnapshot, OrderTracker, StreamHandles, WsStreamHandle } from "./types.ts";
import { getCandleWindowTiming, sleep } from "./utils.ts";

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

async function main(): Promise<void> {
	startApiServer();

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
			return false;
		},
	};

	const typedOrderTracker: OrderTracker = orderTracker;
	void typedOrderTracker;

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
		setTimeout(() => process.exit(0), 2000);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	let consecutiveAllFails = 0;
	const SAFE_MODE_THRESHOLD = 3;

	while (true) {
		const shouldRunLoop = isPaperRunning() || isLiveRunning() || isPaperPendingStart() || isLivePendingStart();
		if (!shouldRunLoop) {
			await sleep(1000);
			continue;
		}

		const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
		if (prevWindowStartMs !== null && timing.startMs !== prevWindowStartMs) {
			if (isPaperPendingStart()) {
				log.info("Pending start detected, starting at new cycle boundary");
				setPaperRunning(true);
				clearPaperPending();
			}
			if (isLivePendingStart()) {
				const status = getClientStatus();
				if (status.walletLoaded && status.clientReady) {
					const wallet = getWallet();
					if (wallet) {
						const { ClobClient } = await import("@polymarket/clob-client");
						const client = new ClobClient(CONFIG.clobBaseUrl, 137, wallet);
						orderManager.setClient(client);
						orderManager.startPolling(5_000);
						log.info("OrderManager started polling");
					}
					const heartbeatOk = startHeartbeat();
					if (heartbeatOk) {
						log.info("Pending start detected, starting at new cycle boundary");
						setLiveRunning(true);
					} else {
						log.error("Live start aborted: heartbeat failed to start");
					}
				} else {
					log.info("Pending start cancelled - wallet not ready");
				}
				clearLivePending();
			}

			paperTracker.setWindow(timing.startMs);
			liveTracker.setWindow(timing.startMs);

			if (isPaperRunning()) {
				const finalPrices = new Map<string, number>();
				for (const market of markets) {
					const st = states.get(market.id);
					if (st?.prevCurrentPrice !== null && st?.prevCurrentPrice !== undefined) {
						finalPrices.set(market.id, st.prevCurrentPrice);
					}
				}
				const prevPnl = getPaperStats().totalPnl;
				const resolved = resolvePaperTrades(prevWindowStartMs, finalPrices);
				if (resolved > 0) {
					const stats = getPaperStats();
					const pnlDelta = stats.totalPnl - prevPnl;
					updatePnl(pnlDelta, "paper");
					log.info(
						`Resolved ${resolved} trade(s) | W:${stats.wins} L:${stats.losses} | WR:${(stats.winRate * 100).toFixed(0)}% | PnL:${stats.totalPnl.toFixed(2)}`,
					);
				}
			}
			if (isLiveRunning()) {
				const wallet = getWallet();
				if (wallet) {
					log.info("Window changed, checking for redeemable positions...");
					redeemAll(wallet)
						.then((results) => {
							if (results.length) {
								log.info(`Redeemed ${results.length} position(s)`);
							}
						})
						.catch((err: unknown) => {
							const message = err instanceof Error ? err.message : String(err);
							log.error("Redemption error:", message);
						});
				}
			}

			if (isPaperPendingStop()) {
				log.info("Pending stop detected, stopping after cycle settlement");
				setPaperRunning(false);
				clearPaperPending();
			}
			if (isLivePendingStop()) {
				log.info("Pending stop detected, stopping after cycle settlement");
				setLiveRunning(false);
				stopHeartbeat();
				orderManager.stopPolling();
				clearLivePending();
			}
		}
		prevWindowStartMs = timing.startMs;

		orderTracker.prune();
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
				const tradeSize = Number(CONFIG.paperRisk.maxTradeSizeUsdc || 0);
				const affordCheck = canAffordTradeWithStopCheck(tradeSize);
				const minPaperLiquidity = Number(CONFIG.paperRisk.minLiquidity || 0);
				const hasPaperLiquidity = sideLiquidity !== null && sideLiquidity >= minPaperLiquidity;
				if (
					!paperTracker.has(mkt.id, timing.startMs) &&
					affordCheck.canTrade &&
					hasPaperLiquidity &&
					paperTracker.canTradeGlobally(Math.min(maxGlobalTrades, CONFIG.paperRisk.maxTradesPerWindow)) &&
					getPendingPaperTrades().length < CONFIG.paperRisk.maxOpenPositions
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
				const minLiveLiquidity = Number(CONFIG.liveRisk.minLiquidity || 0);
				const hasLiveLiquidity = sideLiquidity !== null && sideLiquidity >= minLiveLiquidity;
				if (!hasLiveLiquidity) {
					log.info(
						`Skip ${mkt.id} live: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minLiveLiquidity.toFixed(0)}`,
					);
					continue;
				}

				const liveWindowLimit = Math.min(maxGlobalTrades, CONFIG.liveRisk.maxTradesPerWindow);
				const canPlace =
					orderTracker &&
					!orderTracker.hasOrder(mkt.id, slug) &&
					!orderTracker.onCooldown() &&
					orderTracker.totalActive() < CONFIG.liveRisk.maxOpenPositions &&
					successfulTradesThisTick < liveWindowLimit &&
					!liveTracker.has(mkt.id, timing.startMs) &&
					liveTracker.canTradeGlobally(liveWindowLimit);

				if (!canPlace) continue;

				const result = await executeTrade(sig, { marketConfig: mkt, riskConfig: CONFIG.liveRisk }, "live");
				if (result?.success) {
					orderTracker.record(mkt.id, slug);
					liveTracker.record(mkt.id, timing.startMs);
					successfulTradesThisTick += 1;
				} else {
					log.warn(`Live trade failed for ${mkt.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
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
			paperPendingStart: isPaperPendingStart(),
			paperPendingStop: isPaperPendingStop(),
			livePendingStart: isLivePendingStart(),
			livePendingStop: isLivePendingStop(),
			paperStats: getPaperStats(),
		});

		renderDashboard(results);
		await sleep(CONFIG.pollIntervalMs);
	}
}

main();
