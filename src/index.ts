import { applyEvent, enrichPosition, initAccountState, resetAccountState, updateFromSnapshot } from "./accountState.ts";
import { adaptiveManager, signalQualityModel } from "./adaptiveState.ts";
import { startApiServer } from "./api.ts";
import { CONFIG } from "./config.ts";
import { startMultiBinanceTradeStream } from "./data/binanceWs.ts";
import { startChainlinkPriceStream } from "./data/chainlinkWs.ts";
import { startBalancePolling } from "./data/polygonBalance.ts";
import { startOnChainEventStream } from "./data/polygonEvents.ts";
import type { ClobWsHandle } from "./data/polymarketClobWs.ts";
import { startClobMarketWs } from "./data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "./data/polymarketLiveWs.ts";
import { onchainStatements } from "./db.ts";
import { env } from "./env.ts";
import { startHeartbeat, stopHeartbeat, unregisterOpenGtdOrder } from "./heartbeat.ts";
import { restorePendingLiveTrades } from "./liveSettlement.ts";
import { createLogger } from "./logger.ts";
import { getActiveMarkets } from "./markets.ts";
import { OrderManager, type TrackedOrder } from "./orderManager.ts";
import { canAffordTradeWithStopCheck, getPaperStats, getPendingPaperTrades } from "./paperStats.ts";
import type { MarketState, ProcessMarketResult } from "./pipeline/processMarket.ts";
import { processMarket as processMarketPipeline } from "./pipeline/processMarket.ts";
import { startReconciler } from "./reconciler.ts";
import {
	emitBalanceSnapshot,
	emitStateSnapshot,
	getUpdatedAt,
	isLiveRunning,
	isPaperRunning,
	setLiveRunning,
	setOnchainBalance,
	setPaperRunning,
	updateMarkets,
} from "./state.ts";
import { shouldTakeTrade } from "./strategyRefinement.ts";
import { renderDashboard } from "./terminal.ts";
import { connectWallet, executeTrade, getClientStatus, getLiveStats, getLiveTodayStats, getWallet } from "./trader.ts";
import type { MarketSnapshot, OrderTracker, StreamHandles, WsStreamHandle } from "./types.ts";
import { getCandleWindowTiming, sleep } from "./utils.ts";
import { handleWindowBoundary } from "./windowBoundary.ts";

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

async function main(): Promise<void> {
	startApiServer();

	// Auto-connect wallet if PRIVATE_KEY is configured in .env
	if (env.PRIVATE_KEY) {
		try {
			const result = await connectWallet(env.PRIVATE_KEY);
			log.info(`Wallet auto-connected from .env: ${result.address}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("Failed to auto-connect wallet from PRIVATE_KEY:", msg);
		}
	}

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

	let prevWindowStartMs: number = 0;

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
		setTimeout(() => process.exit(0), 2000);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	let consecutiveAllFails = 0;
	const SAFE_MODE_THRESHOLD = CONFIG.strategy.safeModeThreshold ?? 3;
	let liveInitialized = false;

	while (true) {
		const hasPendingPaperTrades = getPendingPaperTrades().length > 0;
		const shouldRunLoop = isPaperRunning() || isLiveRunning() || hasPendingPaperTrades;
		if (!shouldRunLoop) {
			await sleep(1000);
			continue;
		}

		// --- Live trading init/cleanup on state transitions ---
		if (isLiveRunning() && !liveInitialized) {
			const status = getClientStatus();
			if (status.walletLoaded && status.clientReady) {
				const wallet = getWallet();
				if (wallet) {
					const { ClobClient } = await import("@polymarket/clob-client");
					const client = new ClobClient(CONFIG.clobBaseUrl, 137, wallet);
					orderManager.setClient(client);
				}
				const heartbeatOk = startHeartbeat();
				if (heartbeatOk) {
					if (wallet) {
						orderManager.startPolling(5_000);
						log.info("OrderManager started polling");
					}
					log.info("Live trading started");

					if (wallet) {
						const walletAddr = wallet.address;
						initAccountState(walletAddr);

						try {
							const knownTokens = onchainStatements.getKnownCtfTokens().all({}) as unknown[];
							for (const raw of knownTokens) {
								if (raw && typeof raw === "object") {
									const t = raw as Record<string, unknown>;
									if (typeof t.token_id === "string" && typeof t.market_id === "string" && typeof t.side === "string") {
										enrichPosition(t.token_id, t.market_id, t.side);
									}
								}
							}
						} catch (err) {
							log.warn("Failed to load known CTF tokens:", err);
						}

						// Restore any pending live trades from previous session
						restorePendingLiveTrades();

						balancePollingHandle = startBalancePolling({
							wallet: walletAddr,
							knownTokenIds: () => {
								try {
									const rows = onchainStatements.getKnownCtfTokens().all({}) as unknown[];
									return rows
										.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
										.map((r) => String(r.token_id ?? ""))
										.filter(Boolean);
								} catch {
									return [];
								}
							},
							onUpdate: (snapshot) => {
								updateFromSnapshot(snapshot);
								setOnchainBalance(snapshot);
								emitBalanceSnapshot(snapshot);
							},
						});

						eventStreamHandle = startOnChainEventStream({
							wallet: walletAddr,
							onEvent: (event) => {
								applyEvent(event);
								try {
									onchainStatements.insertOnchainEvent().run({
										$txHash: event.txHash,
										$logIndex: event.logIndex,
										$blockNumber: event.blockNumber,
										$eventType: event.type,
										$fromAddr: event.from,
										$toAddr: event.to,
										$tokenId: event.tokenId,
										$value: event.value,
										$rawData: null,
									});
								} catch (err) {
									log.warn("Failed to persist on-chain event", {
										error: err instanceof Error ? err.message : String(err),
									});
								}
							},
						});

						reconcilerHandle = startReconciler({
							wallet: walletAddr,
							intervalMs: 60_000,
						});

						log.info("On-chain tracking started", { wallet: walletAddr });
					}
					liveInitialized = true;
				} else {
					log.error("Live start aborted: heartbeat failed to start");
					orderManager.stopPolling();
					setLiveRunning(false);
				}
			} else {
				log.warn("Live start aborted: wallet not ready");
				setLiveRunning(false);
			}
		}
		if (!isLiveRunning() && liveInitialized) {
			log.info("Live trading stopped, cleaning up");
			stopHeartbeat();
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
			resetAccountState();
			orderManager.stopPolling();
			liveInitialized = false;
		}

		// --- Cycle boundary: settlement + tracker reset ---
		const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
		if (prevWindowStartMs > 0 && timing.startMs !== prevWindowStartMs) {
			await handleWindowBoundary({
				prevWindowStartMs,
				currentStartMs: timing.startMs,
				markets,
				states,
				paperTracker,
				liveTracker,
			});
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
						adaptiveManager,
						signalQualityModel,
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

					// Wire order into OrderManager for status polling & lifecycle management
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
		// Fetch live stats from chain before emitting snapshot
		const liveStats = await getLiveStats();
		emitStateSnapshot({
			markets: snapshots,
			updatedAt: getUpdatedAt(),
			paperRunning: isPaperRunning(),
			liveRunning: isLiveRunning(),
			paperStats: getPaperStats(),
			liveStats,
			liveTodayStats: getLiveTodayStats(),
		});

		renderDashboard(results);
		await sleep(CONFIG.pollIntervalMs);
	}
}

main();
