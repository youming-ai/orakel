import type { Phase, Regime } from "../types.ts";
import { clamp } from "../utils.ts";

interface TradeOutcome {
	marketId: string;
	won: boolean;
	edge: number;
	confidence: number;
	phase: Phase;
	regime: Regime | null;
	timestamp: number;
}

interface PerformanceSnapshot {
	totalTrades: number;
	wins: number;
	currentWinRate: number;
	recentWinRate: number;
	trend: "improving" | "stable" | "declining";
	avgEdge: number;
	avgConfidence: number;
}

interface AdjustedThresholds {
	edgeThreshold: number;
	minProb: number;
	minConfidence: number;
	reason: string;
}

const MIN_TRADES_FOR_SNAPSHOT = 5;
const RECENT_TREND_WINDOW = 10;
const TREND_DELTA = 0.05;

export class MarketPerformanceTracker {
	private readonly rollingWindow: number;
	private readonly marketTrades: Map<string, TradeOutcome[]>;

	constructor(rollingWindow: number = 50) {
		this.rollingWindow = rollingWindow;
		this.marketTrades = new Map();
	}

	recordTrade(outcome: TradeOutcome): void {
		const existing = this.marketTrades.get(outcome.marketId) ?? [];
		existing.push(outcome);

		if (existing.length > this.rollingWindow) {
			existing.splice(0, existing.length - this.rollingWindow);
		}

		this.marketTrades.set(outcome.marketId, existing);
	}

	getSnapshot(marketId: string): PerformanceSnapshot | null {
		const trades = this.marketTrades.get(marketId) ?? [];
		if (trades.length < MIN_TRADES_FOR_SNAPSHOT) {
			return null;
		}

		const totalTrades = trades.length;
		const wins = trades.reduce((acc, trade) => acc + (trade.won ? 1 : 0), 0);
		const currentWinRate = wins / totalTrades;

		const recentWindow = Math.min(RECENT_TREND_WINDOW, totalTrades);
		const recentTrades = trades.slice(-recentWindow);
		const recentWins = recentTrades.reduce((acc, trade) => acc + (trade.won ? 1 : 0), 0);
		const recentWinRate = recentWins / recentWindow;

		const avgEdge = trades.reduce((acc, trade) => acc + trade.edge, 0) / totalTrades;
		const avgConfidence = trades.reduce((acc, trade) => acc + trade.confidence, 0) / totalTrades;

		let trend: PerformanceSnapshot["trend"] = "stable";
		if (recentWinRate - currentWinRate >= TREND_DELTA) {
			trend = "improving";
		} else if (currentWinRate - recentWinRate >= TREND_DELTA) {
			trend = "declining";
		}

		return {
			totalTrades,
			wins,
			currentWinRate,
			recentWinRate,
			trend,
			avgEdge,
			avgConfidence,
		};
	}
}

export class AdaptiveThresholdManager {
	private readonly tracker: MarketPerformanceTracker;

	constructor(tracker: MarketPerformanceTracker) {
		this.tracker = tracker;
	}

	getAdjustedThresholds(params: {
		marketId: string;
		baseEdgeThreshold: number;
		baseMinProb: number;
		baseMinConfidence: number;
		phase: Phase;
		regime: Regime | null;
	}): AdjustedThresholds {
		const snapshot = this.tracker.getSnapshot(params.marketId);
		const winRate = snapshot?.recentWinRate ?? 0.5;
		const trend = snapshot?.trend ?? "stable";

		let edgeMultiplier = 1;
		let minProbDelta = 0;
		let minConfidenceDelta = 0;

		if (winRate < 0.45) {
			edgeMultiplier *= 1.5;
			minProbDelta += 0.05;
			minConfidenceDelta += 0.1;
		} else if (winRate < 0.5) {
			edgeMultiplier *= 1.2;
			minProbDelta += 0.02;
		} else if (winRate <= 0.55) {
			edgeMultiplier *= 1;
		} else if (winRate <= 0.6) {
			edgeMultiplier *= 0.9;
		} else {
			edgeMultiplier *= 0.8;
		}

		if (trend === "declining") {
			edgeMultiplier *= 1.1;
		} else if (trend === "improving") {
			edgeMultiplier *= 0.95;
		}

		if (params.regime === "CHOP") {
			edgeMultiplier *= 1.2;
		}

		if (params.phase === "LATE") {
			edgeMultiplier *= 1.1;
		}

		const edgeThreshold = clamp(params.baseEdgeThreshold * edgeMultiplier, 0.03, 0.25);
		const minProb = clamp(params.baseMinProb + minProbDelta, 0.5, 0.7);
		const minConfidence = clamp(params.baseMinConfidence + minConfidenceDelta, 0.4, 0.8);

		const reason = [
			`wr=${winRate.toFixed(2)}`,
			`trend=${trend}`,
			`regime=${params.regime ?? "NONE"}`,
			`phase=${params.phase}`,
		].join("_");

		return {
			edgeThreshold,
			minProb,
			minConfidence,
			reason,
		};
	}
}

export type { TradeOutcome, PerformanceSnapshot, AdjustedThresholds };
