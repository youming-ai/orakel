import type { RiskConfigDto, StrategyConfig } from "@orakel/shared/contracts";
import type { Decision, Phase, Side } from "../core/types.ts";
import { computeEdge } from "./edge.ts";

export interface DecisionInput {
	modelProbUp: number;
	marketProbUp: number;
	timeLeftSeconds: number;
	phase: Phase;
	strategy: StrategyConfig;
	risk: RiskConfigDto;
	hasPositionInWindow: boolean;
	todayLossUsdc: number;
	openPositions: number;
	tradesInWindow: number;
}

export interface DecisionResult {
	decision: Decision;
	side: Side | null;
	edge: number;
	reason: string | null;
}

function getEdgeThreshold(phase: Phase, strategy: StrategyConfig): number {
	switch (phase) {
		case "EARLY":
			return strategy.edgeThresholdEarly;
		case "MID":
			return strategy.edgeThresholdMid;
		case "LATE":
			return strategy.edgeThresholdLate;
	}
}

export function makeTradeDecision(input: DecisionInput): DecisionResult {
	const { modelProbUp, marketProbUp, timeLeftSeconds, phase, strategy, risk } = input;
	const { bestSide, bestEdge } = computeEdge(modelProbUp, marketProbUp);

	if (timeLeftSeconds < strategy.minTimeLeftSeconds) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "time: too close to window end" };
	}
	if (timeLeftSeconds > strategy.maxTimeLeftSeconds) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "time: too far from window end" };
	}

	if (input.hasPositionInWindow) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "already has position in window" };
	}

	if (input.todayLossUsdc >= risk.dailyMaxLossUsdc) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "daily loss limit reached" };
	}
	if (input.openPositions >= risk.maxOpenPositions) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "max open positions reached" };
	}
	if (input.tradesInWindow >= risk.maxTradesPerWindow) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "max trades per window reached" };
	}

	const entryPrice = bestSide === "UP" ? marketProbUp : 1 - marketProbUp;
	if (entryPrice > strategy.maxEntryPrice) {
		return {
			decision: "SKIP",
			side: null,
			edge: bestEdge,
			reason: `price too extreme: ${entryPrice.toFixed(4)} > ${strategy.maxEntryPrice}`,
		};
	}

	const threshold = getEdgeThreshold(phase, strategy);
	if (bestEdge < threshold) {
		return {
			decision: "SKIP",
			side: null,
			edge: bestEdge,
			reason: `edge ${bestEdge.toFixed(4)} < ${threshold} (${phase})`,
		};
	}

	const decision: Decision = bestSide === "UP" ? "ENTER_UP" : "ENTER_DOWN";
	return { decision, side: bestSide, edge: bestEdge, reason: null };
}
