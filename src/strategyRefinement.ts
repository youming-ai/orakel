/**
 * Strategy Refinement based on Backtest Analysis
 *
 * Key findings from 383 resolved trades:
 * - Overall WR: 48.6%, PnL: $156.60, PF: 1.40
 * - Low edge (<10%): 57.9% WR (model underconfident - good!)
 * - High edge (>=20%): 43.6% WR (model overconfident - BAD!)
 * - CHOP regime: 38.9% WR (avoid or heavily filter)
 * - BTC: 42.1% WR (market-specific issues)
 * - XRP/SOL: 54%+ WR (best performers)
 */

import type { StrategyConfig } from "./types.ts";


// Market-specific adjustments based on backtest
// NOTE: edgeMultiplier is authoritative in edge.ts (MARKET_PERFORMANCE).
//       This table only drives skipChop for the shouldTakeTrade filter.
export const MARKET_ADJUSTMENTS: Record<
	string,
	{
		skipChop: boolean; // Skip CHOP regime trades entirely
	}
> = {
	BTC: { skipChop: true }, // 42.1% WR in CHOP — unprofitable after vig
	ETH: { skipChop: true }, // 46.9% WR in CHOP — marginal
	SOL: { skipChop: false }, // 51.0% WR — acceptable
	XRP: { skipChop: false }, // 54.2% WR — best performer
};

// Additional filtering rules learned from backtest
export const BACKTEST_INSIGHTS = {
	// Time-based insights
	earlyEntryMaxTime: 13, // >10 min had worse performance, limit early entries
	lateEntryMinTime: 3, // <3 min before close - avoid (not enough time)

	// Edge insights (critical finding: high edge = overconfidence)
	maxExpectedEdge: 0.25, // Cap maximum expected edge to avoid overconfidence
	optimalEdgeRange: { min: 0.05, max: 0.15 }, // Sweet spot based on backtest
	minPriceToBeatDelta: 0.001, // Skip trades where price is within 0.1% of PTB (noise)

	// Volatility insights
	maxVolatility15m: 0.004, // Skip if vol > 0.4% (losing trades showed high vol)
	minVolatility15m: 0.0005, // Skip if vol < 0.05% (not enough movement)

	// Regime insights
	skipChop: true, // Skip CHOP entirely (38.9% WR is unprofitable after vig)
	trendAlignedBonus: 0.02, // Extra edge requirement for trend-opposed trades
};

// NOTE: calculateAdjustedThreshold was removed — market-specific threshold
// adjustments are now consolidated in edge.ts (MARKET_PERFORMANCE.edgeMultiplier).

// Filter function to check if trade should be taken
export function shouldTakeTrade(params: {
	market: string;
	regime: string | null;
	edge: number;
	timeLeft: number;
	volatility: number;
	phase: "EARLY" | "MID" | "LATE";
	priceDelta?: number;
}): { shouldTrade: boolean; reason?: string } {
	const { market, regime, edge, timeLeft, volatility, phase, priceDelta } = params;
	const marketAdj = MARKET_ADJUSTMENTS[market] || { skipChop: false };
	// Skip CHOP entirely for underperforming markets
	if (regime === "CHOP" && (marketAdj.skipChop || BACKTEST_INSIGHTS.skipChop)) {
		return { shouldTrade: false, reason: "skip_chop_regime" };
	}
	// PTB delta filter: skip trades where price is within noise range of PTB
	if (priceDelta !== undefined && priceDelta < BACKTEST_INSIGHTS.minPriceToBeatDelta) {
		return { shouldTrade: false, reason: "ptb_delta_too_small" };
	}
	// Time filters
	if (phase === "EARLY" && timeLeft > BACKTEST_INSIGHTS.earlyEntryMaxTime) {
		return { shouldTrade: false, reason: "too_early_in_window" };
	}
	if (timeLeft < BACKTEST_INSIGHTS.lateEntryMinTime) {
		return { shouldTrade: false, reason: "too_late_in_window" };
	}
	// Volatility filters
	if (volatility > BACKTEST_INSIGHTS.maxVolatility15m) {
		return { shouldTrade: false, reason: "volatility_too_high" };
	}
	if (volatility < BACKTEST_INSIGHTS.minVolatility15m) {
		return { shouldTrade: false, reason: "volatility_too_low" };
	}
	// Edge overconfidence filter
	if (edge > BACKTEST_INSIGHTS.maxExpectedEdge) {
		return { shouldTrade: false, reason: "overconfident_edge_prediction" };
	}
	// Check optimal edge range
	if (edge > BACKTEST_INSIGHTS.optimalEdgeRange.max) {
		return { shouldTrade: false, reason: "edge_in_overconfidence_zone" };
	}
	return { shouldTrade: true };
}

