import type { WsPublisher } from "../app/ws.ts";
import { computePhase, computeSlug, computeTimeLeftSeconds, computeWindowBounds } from "../core/clock.ts";
import { getConfig } from "../core/config.ts";
import { createLogger } from "../core/logger.ts";
import { getStateSnapshot, isLiveRunning, isPaperRunning, setLatestTickData } from "../core/state.ts";
import type { PriceAdapter } from "../core/types.ts";
import { fetchMarketBySlug, type PolymarketOrderBookAdapter } from "../data/polymarket.ts";
import { type DecisionInput, makeTradeDecision } from "../engine/decision.ts";
import { computeEdge } from "../engine/edge.ts";
import { computeVolatility, modelProbability, type SignalParams } from "../engine/signal.ts";
import { renderDashboard } from "../terminal/dashboard.ts";
import type { AccountManager } from "../trading/account.ts";
import { executeLiveTrade } from "../trading/liveTrader.ts";
import { executePaperTrade } from "../trading/paperTrader.ts";
import { persistSignal, persistTrade, settleDbTrade } from "../trading/persistence.ts";
import { runRedemption } from "./redeemer.ts";
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
}

export function createMainLoop(deps: MainLoopDeps) {
	const { priceAdapter, polymarketWs, paperAccount, liveAccount, ws } = deps;
	let currentWindow: WindowTrackerState | null = null;
	let previousWindow: WindowTrackerState | null = null;
	const windowTrades = new Map<string, TradeEntry[]>();
	let consecutiveFailures = 0;
	let safeMode = false;
	let interval: ReturnType<typeof setInterval> | null = null;

	function getWindowTrades(slug: string): TradeEntry[] {
		if (!windowTrades.has(slug)) windowTrades.set(slug, []);
		return windowTrades.get(slug) ?? [];
	}

	async function discoverWindow(config: ReturnType<typeof getConfig>): Promise<void> {
		const nowSec = Math.floor(Date.now() / 1000);
		const { startSec, endSec } = computeWindowBounds(nowSec, config.infra.windowSeconds);
		const slug = computeSlug(endSec, config.infra.slugPrefix);

		if (currentWindow?.slug === slug) return;

		const market = await fetchMarketBySlug(slug, config.infra.polymarketGammaUrl);
		if (!market) {
			log.warn("Market not found, will retry", { slug });
			return;
		}

		previousWindow = currentWindow;
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

	async function processTick(): Promise<void> {
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

			const tradesInWindow = getWindowTrades(currentWindow.slug).length;
			const hasPosition = tradesInWindow > 0;

			const decisionInput: DecisionInput = {
				modelProbUp,
				marketProbUp,
				timeLeftSeconds: timeLeft,
				phase,
				strategy: config.strategy,
				risk: config.risk.paper,
				hasPositionInWindow: hasPosition,
				todayLossUsdc: paperAccount.getTodayLossUsdc(),
				openPositions: paperAccount.getPendingCount(),
				tradesInWindow,
			};

			const decision = makeTradeDecision(decisionInput);

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
				decision: decision.decision,
				reason: decision.reason,
			});

			if (decision.decision.startsWith("ENTER")) {
				const side = decision.side as "UP" | "DOWN";
				const entryPrice = side === "UP" ? upBook.midpoint : downBook.midpoint;
				const tokenId = side === "UP" ? marketInfo.upTokenId : marketInfo.downTokenId;

				if (paperRunning && !hasPosition) {
					const tradeIndex = executePaperTrade(
						{
							windowSlug: currentWindow.slug,
							side,
							price: entryPrice,
							size: config.risk.paper.maxTradeSizeUsdc,
							edge: decision.edge,
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
						edge: decision.edge,
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
					});
				}

				if (liveRunning && !hasPosition) {
					const result = await executeLiveTrade(
						{
							tokenId,
							side,
							price: entryPrice,
							size: config.risk.live.maxTradeSizeUsdc,
							windowSlug: currentWindow.slug,
							edge: decision.edge,
						},
						config,
					);
					if (result.success) {
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
							edge: decision.edge,
							modelProb: modelProbUp,
							marketProb: marketProbUp,
							phase,
							orderId: result.orderId,
						});
						getWindowTrades(currentWindow.slug).push({
							index: 0,
							side,
							price: entryPrice,
							size: config.risk.live.maxTradeSizeUsdc,
							tradeId,
						});
					}
				}
			}

			currentWindow.state = advanceWindowState(currentWindow, nowMs, false).state;

			if (previousWindow && previousWindow.state !== "REDEEMED") {
				const settled = advanceWindowState(previousWindow, nowMs, true);
				if (settled.state === "SETTLED" && previousWindow.state !== "SETTLED") {
					const settlePrice = priceTick.price;
					const prevPriceToBeat = previousWindow.marketInfo?.priceToBeat || 0;
					const windowTrades = getWindowTrades(previousWindow.slug);
					for (const entry of windowTrades) {
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
						if (liveRunning) await runRedemption();
					}
					previousWindow.state = "SETTLED";
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
				decision: decision.decision,
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
				edge: bestEdge,
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
