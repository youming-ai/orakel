import type { WsPublisher } from "../app/ws.ts";
import { computePhase, computeSlug, computeTimeLeftSeconds, computeWindowBounds } from "../core/clock.ts";
import { getConfig } from "../core/config.ts";
import { createLogger } from "../core/logger.ts";
import { getStateSnapshot, isLiveRunning, isPaperRunning, setLatestTickData } from "../core/state.ts";
import type { PriceAdapter } from "../core/types.ts";
import { fetchMarketBySlug, type PolymarketOrderBookAdapter } from "../data/polymarket.ts";
import { type DecisionInput, type DecisionResult, makeTradeDecision } from "../engine/decision.ts";
import { computeEdge } from "../engine/edge.ts";
import { computeVolatility, modelProbability, type SignalParams } from "../engine/signal.ts";
import { renderDashboard } from "../terminal/dashboard.ts";
import type { AccountManager } from "../trading/account.ts";
import {
	cancelAllOrders,
	checkOrderFilled,
	executeLiveTrade,
	getLiveBalance,
	hasLivePosition,
} from "../trading/liveTrader.ts";
import { executePaperTrade } from "../trading/paperTrader.ts";
import { persistSignal, persistTrade, settleDbTrade } from "../trading/persistence.ts";
import { SettlementError, settleLiveWindow } from "./liveSettlement.ts";
import { advanceWindowState, createWindowState, type WindowTrackerState } from "./windowManager.ts";

const log = createLogger("main-loop");

const EPSILON = 0.001;

interface MainLoopDeps {
	priceAdapter: PriceAdapter;
	polymarketWs: PolymarketOrderBookAdapter;
	paperAccount: AccountManager;
	liveAccount: AccountManager;
	ws: WsPublisher;
}

interface TradeEntry {
	index: number;
	side: "UP" | "DOWN";
	price: number;
	size: number;
	tradeId?: number;
	balanceBefore?: number; // For live trades: wallet balance before this trade
	mode: "paper" | "live";
}

export function createMainLoop(deps: MainLoopDeps) {
	const { priceAdapter, polymarketWs, paperAccount, liveAccount, ws } = deps;
	let currentWindow: WindowTrackerState | null = null;
	let previousWindow: WindowTrackerState | null = null;
	const windowTrades = new Map<string, TradeEntry[]>();
	let consecutiveFailures = 0;
	let safeMode = false;
	let interval: ReturnType<typeof setInterval> | null = null;

	let liveCancelledThisWindow = false;

	function getWindowTrades(slug: string): TradeEntry[] {
		if (!windowTrades.has(slug)) windowTrades.set(slug, []);
		return windowTrades.get(slug) ?? [];
	}

	function getWindowTradesByMode(slug: string, mode: "paper" | "live"): TradeEntry[] {
		return getWindowTrades(slug).filter((t) => t.mode === mode);
	}

	async function discoverWindow(config: ReturnType<typeof getConfig>): Promise<void> {
		const nowSec = Math.floor(Date.now() / 1000);
		const { startSec, endSec } = computeWindowBounds(nowSec, config.infra.windowSeconds);
		const slug = computeSlug(startSec, config.infra.slugPrefix);

		if (currentWindow?.slug === slug) return;

		const market = await fetchMarketBySlug(slug, config.infra.polymarketGammaUrl);
		if (!market) {
			log.warn("Market not found, will retry", { slug });
			return;
		}

		previousWindow = currentWindow;
		liveCancelledThisWindow = false;
		currentWindow = createWindowState(slug, startSec * 1000, endSec * 1000);

		const priceTick = priceAdapter.getLatestPrice();
		if (priceTick) {
			market.priceToBeat = priceTick.price;
		}

		currentWindow.marketInfo = market;
		log.info("Discovered new window", { slug, priceToBeat: market.priceToBeat });

		if (market.upTokenId && market.downTokenId) {
			polymarketWs.subscribe([market.upTokenId, market.downTokenId]);
		}
	}

	let tickInProgress = false;

	async function processTick(): Promise<void> {
		if (tickInProgress) {
			log.warn("Tick still in progress, skipping");
			return;
		}
		tickInProgress = true;
		try {
			const config = getConfig();
			const nowMs = Date.now();
			const paperRunning = isPaperRunning();
			const liveRunning = isLiveRunning();

			await discoverWindow(config);
			if (!currentWindow) return;

			const priceTick = priceAdapter.getLatestPrice();
			if (!priceTick) {
				log.warn("No BTC price available");
				return;
			}
			if (nowMs - priceTick.timestampMs > 5000) {
				log.warn("Stale price, skipping tick", { ageMs: nowMs - priceTick.timestampMs });
				return;
			}

			const timeLeft = computeTimeLeftSeconds(nowMs, currentWindow.endMs);
			const phase = computePhase(timeLeft, config.strategy.phaseEarlySeconds, config.strategy.phaseLateSeconds);

			const marketInfo = currentWindow.marketInfo;
			if (!marketInfo) return;

			setLatestTickData({
				currentWindow: {
					slug: currentWindow.slug,
					state: currentWindow.state,
					startMs: currentWindow.startMs,
					endMs: currentWindow.endMs,
					timeLeftSeconds: timeLeft,
					priceToBeat: marketInfo.priceToBeat,
					btcPrice: priceTick.price,
					deviation: null,
					modelProbUp: null,
					marketProbUp: null,
					edgeUp: null,
					edgeDown: null,
					phase,
					decision: null,
					volatility: null,
				},
				btcPrice: priceTick.price,
				btcPriceAgeMs: nowMs - priceTick.timestampMs,
				paperStats: paperAccount.getStats(),
				liveStats: liveAccount.getStats(),
			});

			const upBook = polymarketWs.getOrderBook(marketInfo.upTokenId);
			const downBook = polymarketWs.getOrderBook(marketInfo.downTokenId);
			if (!upBook?.midpoint || !downBook?.midpoint) {
				log.debug("Orderbook not ready");
				return;
			}

			const marketProbUp = upBook.midpoint;
			const priceToBeat = marketInfo.priceToBeat || priceTick.price;
			const deviation = (priceTick.price - priceToBeat) / priceToBeat;
			const recentTicks = priceAdapter.getRecentTicks(60000);
			const volatility = computeVolatility(recentTicks);
			const signalParams: SignalParams = {
				sigmoidScale: config.strategy.sigmoidScale,
				minVolatility: config.strategy.minVolatility,
				epsilon: EPSILON,
			};
			const modelProbUp = modelProbability(deviation, timeLeft, volatility, signalParams);
			const { edgeUp, edgeDown, bestEdge } = computeEdge(modelProbUp, marketProbUp);

			let displayDecision: DecisionResult = { decision: "SKIP", side: null, edge: bestEdge, reason: null };

			// --- Paper pass ---
			if (paperRunning) {
				const paperTrades = getWindowTradesByMode(currentWindow.slug, "paper");
				const paperDecisionInput: DecisionInput = {
					modelProbUp,
					marketProbUp,
					timeLeftSeconds: timeLeft,
					phase,
					strategy: config.strategy,
					risk: config.risk.paper,
					hasPositionInWindow: paperTrades.length > 0,
					todayLossUsdc: paperAccount.getTodayLossUsdc(),
					openPositions: paperAccount.getPendingCount(),
					tradesInWindow: paperTrades.length,
				};
				const paperDecision = makeTradeDecision(paperDecisionInput);
				displayDecision = paperDecision;

				if (paperDecision.decision.startsWith("ENTER")) {
					const side = paperDecision.side as "UP" | "DOWN";
					const entryPrice = side === "UP" ? upBook.midpoint : downBook.midpoint;

					const tradeIndex = executePaperTrade(
						{
							windowSlug: currentWindow.slug,
							side,
							price: entryPrice,
							size: config.risk.paper.maxTradeSizeUsdc,
							edge: paperDecision.edge,
							modelProb: modelProbUp,
							marketProb: marketProbUp,
							priceToBeat,
							entryBtcPrice: priceTick.price,
							phase,
						},
						paperAccount,
					).tradeIndex;
					const tradeId = await persistTrade({
						mode: "paper",
						windowSlug: currentWindow.slug,
						windowStartMs: currentWindow.startMs,
						windowEndMs: currentWindow.endMs,
						side,
						price: entryPrice,
						size: config.risk.paper.maxTradeSizeUsdc,
						priceToBeat,
						entryBtcPrice: priceTick.price,
						edge: paperDecision.edge,
						modelProb: modelProbUp,
						marketProb: marketProbUp,
						phase,
						orderId: null,
					});
					getWindowTrades(currentWindow.slug).push({
						index: tradeIndex,
						side,
						price: entryPrice,
						size: config.risk.paper.maxTradeSizeUsdc,
						tradeId,
						mode: "paper",
					});
				}
			}

			// --- Live pass ---
			if (liveRunning) {
				const liveTrades = getWindowTradesByMode(currentWindow.slug, "live");
				const liveDecisionInput: DecisionInput = {
					modelProbUp,
					marketProbUp,
					timeLeftSeconds: timeLeft,
					phase,
					strategy: config.strategy,
					risk: config.risk.live,
					hasPositionInWindow: liveTrades.length > 0,
					todayLossUsdc: liveAccount.getTodayLossUsdc(),
					openPositions: liveAccount.getPendingCount(),
					tradesInWindow: liveTrades.length,
				};
				const liveDecision = makeTradeDecision(liveDecisionInput);
				displayDecision = liveDecision;

				if (liveDecision.decision.startsWith("ENTER")) {
					const side = liveDecision.side as "UP" | "DOWN";
					const entryPrice = side === "UP" ? upBook.midpoint : downBook.midpoint;
					const tokenId = side === "UP" ? marketInfo.upTokenId : marketInfo.downTokenId;

					const balanceResult = await getLiveBalance();
					const balance = balanceResult.balance;
					if (!balanceResult.ok) {
						log.warn("Failed to get live balance, skipping trade", { error: balanceResult.error });
					} else if (balance === null || balance === undefined) {
						log.warn("Live balance missing, skipping trade");
					} else if (balance < config.risk.live.maxTradeSizeUsdc) {
						log.warn("Insufficient live balance", {
							balance,
							required: config.risk.live.maxTradeSizeUsdc,
						});
					} else {
						const posResult = await hasLivePosition(currentWindow.slug);
						if (posResult.ok && posResult.hasPosition) {
							log.info("Already have live position in this window");
						} else {
							const balanceBefore = balance;
							const result = await executeLiveTrade(
								{
									tokenId,
									side,
									price: entryPrice,
									size: config.risk.live.maxTradeSizeUsdc,
									windowSlug: currentWindow.slug,
									edge: liveDecision.edge,
								},
								config,
							);
							if (result.success) {
								const liveTradeIndex = liveAccount.recordTrade({
									side,
									size: config.risk.live.maxTradeSizeUsdc,
									price: entryPrice,
								});

								await new Promise((resolve) => setTimeout(resolve, 1000));
								if (!result.orderId) {
									log.warn("Live orderId missing after successful execution");
								} else {
									const filled = await checkOrderFilled(result.orderId);
									if (!filled) {
										log.warn("Order not filled within 1s, will cancel at window end", { orderId: result.orderId });
									}
								}

								try {
									const tradeId = await persistTrade({
										mode: "live",
										windowSlug: currentWindow.slug,
										windowStartMs: currentWindow.startMs,
										windowEndMs: currentWindow.endMs,
										side,
										price: entryPrice,
										size: config.risk.live.maxTradeSizeUsdc,
										priceToBeat,
										entryBtcPrice: priceTick.price,
										edge: liveDecision.edge,
										modelProb: modelProbUp,
										marketProb: marketProbUp,
										phase,
										orderId: result.orderId,
									});
									getWindowTrades(currentWindow.slug).push({
										index: liveTradeIndex,
										side,
										price: entryPrice,
										size: config.risk.live.maxTradeSizeUsdc,
										tradeId,
										balanceBefore,
										mode: "live",
									});
									log.info("Live trade recorded", { tradeId, windowSlug: currentWindow.slug });
								} catch (err) {
									log.error("Live trade persistence failed, attempting cancel", {
										orderId: result.orderId,
										error: err instanceof Error ? err.message : String(err),
									});

									if (result.orderId) {
										try {
											await cancelAllOrders();
											log.info("Cancelled orders after persistence failure", { orderId: result.orderId });
										} catch (cancelErr) {
											log.error("Failed to cancel orders after persistence failure", {
												orderId: result.orderId,
												error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
											});
										}
									}

									liveAccount.settleTrade(liveTradeIndex, false);
									throw err;
								}
							}
						}
					}
				}
			}

			await persistSignal({
				windowSlug: currentWindow.slug,
				btcPrice: priceTick.price,
				priceToBeat,
				deviation,
				modelProbUp,
				marketProbUp,
				edgeUp,
				edgeDown,
				volatility,
				timeLeftSeconds: timeLeft,
				phase,
				decision: displayDecision.decision,
				reason: displayDecision.reason,
			});

			currentWindow.state = advanceWindowState(currentWindow, nowMs, false).state;

			if (liveRunning && timeLeft <= 30 && !liveCancelledThisWindow && getWindowTrades(currentWindow.slug).length > 0) {
				log.info("Window ending soon, cancelling unfilled orders");
				await cancelAllOrders();
				liveCancelledThisWindow = true;
			}

			if (previousWindow && previousWindow.state !== "REDEEMED") {
				const stateBeforeAdvance = previousWindow.state;
				// Advance through all intermediate states (ACTIVE → CLOSING → SETTLED) in one tick
				let advanced = advanceWindowState(previousWindow, nowMs, true);
				while (advanced.state !== previousWindow.state) {
					previousWindow.state = advanced.state;
					advanced = advanceWindowState(previousWindow, nowMs, true);
				}
				if (previousWindow.state === "SETTLED" && stateBeforeAdvance !== "SETTLED") {
					const settlePrice = priceTick.price;
					const prevPriceToBeat = previousWindow.marketInfo?.priceToBeat || 0;
					const prevWindowTrades = getWindowTrades(previousWindow.slug);

					for (const entry of prevWindowTrades) {
						if (paperRunning) {
							const won =
								(entry.side === "UP" && settlePrice >= prevPriceToBeat) ||
								(entry.side === "DOWN" && settlePrice < prevPriceToBeat);
							paperAccount.settleTrade(entry.index, won);
							if (entry.tradeId) {
								const pnl = won ? entry.size * ((1 - entry.price) / entry.price) : -entry.size;
								await settleDbTrade({
									tradeId: entry.tradeId,
									outcome: won ? "WIN" : "LOSS",
									settleBtcPrice: settlePrice,
									pnlUsdc: pnl,
								});
							}
						} else if (liveRunning && entry.tradeId && entry.balanceBefore !== undefined) {
							const won =
								(entry.side === "UP" && settlePrice >= prevPriceToBeat) ||
								(entry.side === "DOWN" && settlePrice < prevPriceToBeat);
							liveAccount.settleTrade(entry.index, won);
							try {
								const result = await settleLiveWindow(
									{
										tradeId: entry.tradeId,
										entryPrice: entry.price,
										size: entry.size,
										side: entry.side,
										balanceBefore: entry.balanceBefore,
									},
									settlePrice,
									prevPriceToBeat,
								);

								if (result.method === "price_fallback") {
									log.warn("Settlement used price fallback - manual review recommended", {
										tradeId: entry.tradeId,
										pnlUsdc: result.pnlUsdc,
									});
								}
							} catch (err) {
								if (err instanceof SettlementError) {
									log.error("Settlement failed critically", {
										tradeId: entry.tradeId,
										code: err.code,
										error: err.message,
									});

									// TODO: Add alerting mechanism here (email, webhook, etc.)
									// For now, continue but mark for manual review
								} else {
									log.error("Unexpected settlement error", {
										tradeId: entry.tradeId,
										error: err instanceof Error ? err.message : String(err),
									});
								}
							}
						}
					}
					// Clean up trades for this window to prevent memory leak
					windowTrades.delete(previousWindow.slug);
				}
			}

			const windowSnapshot = {
				slug: currentWindow.slug,
				state: currentWindow.state,
				startMs: currentWindow.startMs,
				endMs: currentWindow.endMs,
				timeLeftSeconds: timeLeft,
				priceToBeat,
				btcPrice: priceTick.price,
				deviation,
				modelProbUp,
				marketProbUp,
				edgeUp,
				edgeDown,
				phase,
				decision: displayDecision.decision,
				volatility,
			};

			setLatestTickData({
				currentWindow: windowSnapshot,
				btcPrice: priceTick.price,
				btcPriceAgeMs: nowMs - priceTick.timestampMs,
				paperStats: paperAccount.getStats(),
				liveStats: liveAccount.getStats(),
			});

			ws.broadcast("state:snapshot", {
				updatedAt: new Date().toISOString(),
				...getStateSnapshot(),
				currentWindow: windowSnapshot,
				paperStats: paperAccount.getStats(),
				liveStats: liveAccount.getStats(),
			});

			renderDashboard({
				slug: currentWindow.slug,
				state: currentWindow.state,
				timeLeft,
				price: priceTick.price,
				priceToBeat,
				deviation,
				modelProbUp,
				marketProbUp,
				edge: displayDecision.edge,
				phase,
				paperPnl: paperAccount.getStats().totalPnl,
			});

			consecutiveFailures = 0;
			if (safeMode) {
				safeMode = false;
				log.info("Recovered from safe mode");
			}
		} catch (err) {
			consecutiveFailures++;
			log.error("Tick processing error", {
				error: err instanceof Error ? err.message : String(err),
				consecutiveFailures,
			});
			if (consecutiveFailures >= 10 && !safeMode) {
				safeMode = true;
				log.warn("Entering safe mode - trading paused");
			}
		} finally {
			tickInProgress = false;
		}
	}

	return {
		start() {
			const startConfig = getConfig();
			interval = setInterval(processTick, startConfig.infra.pollIntervalMs);
			log.info("Main loop started", { intervalMs: startConfig.infra.pollIntervalMs });
		},
		stop() {
			if (interval) clearInterval(interval);
			log.info("Main loop stopped");
		},
	};
}
