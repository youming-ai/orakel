import { computePhase, computeTimeLeftSeconds } from "../core/clock.ts";
import { getConfig } from "../core/config.ts";
import { type DecisionInput, makeTradeDecision } from "../engine/decision.ts";
import { computeEdge } from "../engine/edge.ts";
import { modelProbability, type SignalParams } from "../engine/signal.ts";
import type { BacktestResult, BacktestTick } from "./replay.ts";

const SIGNAL_PARAMS: SignalParams = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };

export interface BacktestWindow {
	slug: string;
	startMs: number;
	endMs: number;
	priceToBeat: number;
	outcome: "UP" | "DOWN";
	ticks: BacktestTick[];
}

export interface BacktestTrade {
	side: "UP" | "DOWN";
	entryPrice: number;
	modelProb: number;
	marketProb: number;
	edge: number;
	won: boolean;
	pnl: number;
}

export function runBacktest(windows: BacktestWindow[], initialBalance = 10000): BacktestResult {
	const config = getConfig();
	let balance = initialBalance;
	const trades: BacktestTrade[] = [];

	for (const window of windows) {
		for (const tick of window.ticks) {
			const timeLeft = computeTimeLeftSeconds(tick.timestampMs, window.endMs);
			if (timeLeft <= 0) continue;

			const phase = computePhase(timeLeft, config.strategy.phaseEarlySeconds, config.strategy.phaseLateSeconds);
			const deviation = (tick.btcPrice - window.priceToBeat) / window.priceToBeat;
			const volatility = 0.001;
			const modelProbUp = modelProbability(deviation, timeLeft, volatility, SIGNAL_PARAMS);
			const { bestEdge, bestSide } = computeEdge(modelProbUp, tick.marketProbUp);

			const decisionInput: DecisionInput = {
				modelProbUp,
				marketProbUp: tick.marketProbUp,
				timeLeftSeconds: timeLeft,
				phase,
				strategy: config.strategy,
				risk: config.risk.paper,
				hasPositionInWindow: trades.some((t) => t.side === bestSide),
				todayLossUsdc: 0,
				openPositions: 0,
				tradesInWindow: 0,
			};

			const decision = makeTradeDecision(decisionInput);

			if (decision.decision.startsWith("ENTER")) {
				const entryPrice = bestSide === "UP" ? tick.marketProbUp : 1 - tick.marketProbUp;
				const size = config.risk.paper.maxTradeSizeUsdc;
				const won = window.outcome === bestSide;
				const pnl = won ? size * ((1 - entryPrice) / entryPrice) : -size;
				balance += pnl;
				trades.push({
					side: bestSide,
					entryPrice,
					modelProb: modelProbUp,
					marketProb: tick.marketProbUp,
					edge: bestEdge,
					won,
					pnl,
				});
			}
		}
	}

	const wins = trades.filter((t) => t.won).length;
	const losses = trades.filter((t) => !t.won).length;
	const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

	return {
		totalTrades: trades.length,
		wins,
		losses,
		winRate: trades.length > 0 ? wins / trades.length : 0,
		totalPnl,
		finalBalance: balance,
		trades,
	};
}
