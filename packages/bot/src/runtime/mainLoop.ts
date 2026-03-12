import type { WsPublisher } from "../app/ws.ts";
import { isLiveRunning, isPaperRunning, getStateSnapshot } from "../core/state.ts";
import { computePhase, computeSlug, computeTimeLeftSeconds, computeWindowBounds } from "../core/clock.ts";
import { getConfig } from "../core/config.ts";
import { createLogger } from "../core/logger.ts";
import type { ChainlinkAdapter } from "../data/chainlink.ts";
import { fetchMarketBySlug, type PolymarketOrderBookAdapter } from "../data/polymarket.ts";
import { makeTradeDecision, type DecisionInput } from "../engine/decision.ts";
import { computeEdge } from "../engine/edge.ts";
import { computeVolatility, modelProbability, type SignalParams } from "../engine/signal.ts";
import type { AccountManager } from "../trading/account.ts";
import { executeLiveTrade } from "../trading/liveTrader.ts";
import { executePaperTrade } from "../trading/paperTrader.ts";
import { persistSignal, persistTrade } from "../trading/persistence.ts";
import { renderDashboard } from "../terminal/dashboard.ts";
import { runRedemption } from "./redeemer.ts";
import { settleWindow } from "./settlement.ts";
import { advanceWindowState, createWindowState, type WindowTrackerState } from "./windowManager.ts";

const log = createLogger("main-loop");

const SIGNAL_PARAMS: SignalParams = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };

interface MainLoopDeps {
	chainlink: ChainlinkAdapter;
	polymarketWs: PolymarketOrderBookAdapter;
	paperAccount: AccountManager;
	liveAccount: AccountManager;
	ws: WsPublisher;
}

interface TradeEntry {
	index: number;
	side: "UP" | "DOWN";
	tradeId?: number;
}

export function createMainLoop(deps: MainLoopDeps) {
	const { chainlink, polymarketWs, paperAccount, liveAccount, ws } = deps;
	const config = getConfig();
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

	async function discoverWindow(): Promise<void> {
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
		currentWindow.marketInfo = market;
		log.info("Discovered new window", { slug, priceToBeat: market.priceToBeat });

		if (market.upTokenId && market.downTokenId) {
			polymarketWs.subscribe([market.upTokenId, market.downTokenId]);
		}
	}

	async function processTick(): Promise<void> {
		try {
			const nowMs = Date.now();
			const paperRunning = isPaperRunning();
			const liveRunning = isLiveRunning();

			if (!currentWindow) {
				await discoverWindow();
				return;
			}

			const priceTick = chainlink.getLatestPrice();
			if (!priceTick) {
				log.warn("No Chainlink price available");
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

			const upBook = polymarketWs.getOrderBook(marketInfo.upTokenId);
			const downBook = polymarketWs.getOrderBook(marketInfo.downTokenId);
			if (!upBook?.midpoint || !downBook?.midpoint) {
				log.debug("Orderbook not ready");
				return;
			}

			const marketProbUp = upBook.midpoint;
			const priceToBeat = marketInfo.priceToBeat || priceTick.price;
			const deviation = (priceTick.price - priceToBeat) / priceToBeat;
			const recentTicks = chainlink.getRecentTicks(60000);
			const volatility = computeVolatility(recentTicks);
			const modelProbUp = modelProbability(deviation, timeLeft, volatility, SIGNAL_PARAMS);
			const { edgeUp, edgeDown, bestSide, bestEdge } = computeEdge(modelProbUp, marketProbUp);

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
				chainlinkPrice: priceTick.price,
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
					getWindowTrades(currentWindow.slug).push({ index: tradeIndex, side });
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
						getWindowTrades(currentWindow.slug).push({ index: 0, side, tradeId });
					}
				}
			}

			currentWindow.state = advanceWindowState(currentWindow, nowMs, false).state;

			if (previousWindow && previousWindow.state !== "REDEEMED") {
				const settled = advanceWindowState(previousWindow, nowMs, true);
				if (settled.state === "SETTLED" && previousWindow.state !== "SETTLED") {
					const settlePrice = priceTick.price;
					const trades = getWindowTrades(previousWindow.slug);
					for (const entry of trades) {
						const won =
							(entry.side === "UP" && settlePrice >= priceToBeat) ||
							(entry.side === "DOWN" && settlePrice < priceToBeat);
						paperAccount.settleTrade(entry.index, won);
						if (liveRunning) await runRedemption();
					}
					previousWindow.state = "SETTLED";
				}
			}

			ws.broadcast("state:snapshot", {
				updatedAt: new Date().toISOString(),
				...getStateSnapshot(),
				currentWindow: {
					slug: currentWindow.slug,
					state: currentWindow.state,
					startMs: currentWindow.startMs,
					endMs: currentWindow.endMs,
					timeLeftSeconds: timeLeft,
					priceToBeat,
					chainlinkPrice: priceTick.price,
					deviation,
					modelProbUp,
					marketProbUp,
					edgeUp,
					edgeDown,
					phase,
					decision: decision.decision,
					volatility,
				},
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
			interval = setInterval(processTick, config.infra.pollIntervalMs);
			log.info("Main loop started", { intervalMs: config.infra.pollIntervalMs });
		},
		stop() {
			if (interval) clearInterval(interval);
			log.info("Main loop stopped");
		},
	};
}
