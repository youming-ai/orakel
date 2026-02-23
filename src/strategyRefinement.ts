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

// Refined strategy configuration based on backtest results
export const REFINED_STRATEGY: StrategyConfig = {
  // Edge thresholds - LOWERED based on finding that high edge = overconfidence
  // Original: Early 0.08, Mid 0.1, Late 0.12
  // Refined: Early 0.05, Mid 0.08, Late 0.12 (late stays same, high confidence needed)
  edgeThresholdEarly: 0.05,
  edgeThresholdMid: 0.08,
  edgeThresholdLate: 0.12,
  
  // Minimum probability thresholds - INCREASED for better confidence
  // Original: Early 0.58, Mid 0.6, Late 0.7
  // Refined: Early 0.6, Mid 0.65, Late 0.72
  minProbEarly: 0.6,
  minProbMid: 0.65,
  minProbLate: 0.72,
  
  // Blend weights - shift MORE toward TA for better accuracy
  // Original: vol 0.7, ta 0.3
  // Refined: vol 0.5, ta 0.5 - more balanced approach
  blendWeights: { vol: 0.5, ta: 0.5 },
  
  // Regime multipliers - adjusted based on performance
  // Original: CHOP 1.5, RANGE 1.0, TREND_ALIGNED 0.8, TREND_OPP 1.3
  // Refined: CHOP 2.0 (stricter filtering), RANGE 1.0, TREND_ALIGNED 0.9, TREND_OPP 1.4
  regimeMultipliers: {
    CHOP: 2.0,           // Higher = harder to trade in CHOP (avoid choppy markets)
    RANGE: 1.0,          // Keep same for range-bound markets
    TREND_ALIGNED: 0.9,    // Slightly relaxed for trend following
    TREND_OPPOSED: 1.4,  // Stricter for counter-trend trades
  }
};

// Market-specific adjustments based on backtest
// NOTE: edgeMultiplier is authoritative in edge.ts (MARKET_PERFORMANCE).
//       This table only drives skipChop for the shouldTakeTrade filter.
export const MARKET_ADJUSTMENTS: Record<string, {
  skipChop: boolean;          // Skip CHOP regime trades entirely
}> = {
  BTC: { skipChop: true },    // 42.1% WR in CHOP — unprofitable after vig
  ETH: { skipChop: true },    // 46.9% WR in CHOP — marginal
  SOL: { skipChop: false },   // 51.0% WR — acceptable
  XRP: { skipChop: false },   // 54.2% WR — best performer
};

// Additional filtering rules learned from backtest
export const BACKTEST_INSIGHTS = {
  // Time-based insights
  earlyEntryMaxTime: 13,      // >10 min had worse performance, limit early entries
  lateEntryMinTime: 3,        // <3 min before close - avoid (not enough time)
  
  // Edge insights (critical finding: high edge = overconfidence)
  maxExpectedEdge: 0.25,      // Cap maximum expected edge to avoid overconfidence
  optimalEdgeRange: { min: 0.05, max: 0.18 }, // Sweet spot based on backtest
  
  // Volatility insights
  maxVolatility15m: 0.004,    // Skip if vol > 0.4% (losing trades showed high vol)
  minVolatility15m: 0.0005,  // Skip if vol < 0.05% (not enough movement)
  
  // Regime insights
  skipChop: true,            // Skip CHOP entirely (38.9% WR is unprofitable after vig)
  trendAlignedBonus: 0.02,   // Extra edge requirement for trend-opposed trades
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
  phase: 'EARLY' | 'MID' | 'LATE';
}): { shouldTrade: boolean; reason?: string } {
  const { market, regime, edge, timeLeft, volatility, phase } = params;
  const marketAdj = MARKET_ADJUSTMENTS[market] || { skipChop: false };
  // Skip CHOP entirely for underperforming markets
  if (regime === 'CHOP' && (marketAdj.skipChop || BACKTEST_INSIGHTS.skipChop)) {
    return { shouldTrade: false, reason: 'skip_chop_regime' };
  }
  // Time filters
  if (phase === 'EARLY' && timeLeft > BACKTEST_INSIGHTS.earlyEntryMaxTime) {
    return { shouldTrade: false, reason: 'too_early_in_window' };
  }
  if (timeLeft < BACKTEST_INSIGHTS.lateEntryMinTime) {
    return { shouldTrade: false, reason: 'too_late_in_window' };
  }
  // Volatility filters
  if (volatility > BACKTEST_INSIGHTS.maxVolatility15m) {
    return { shouldTrade: false, reason: 'volatility_too_high' };
  }
  if (volatility < BACKTEST_INSIGHTS.minVolatility15m) {
    return { shouldTrade: false, reason: 'volatility_too_low' };
  }
  // Edge overconfidence filter
  if (edge > BACKTEST_INSIGHTS.maxExpectedEdge) {
    return { shouldTrade: false, reason: 'overconfident_edge_prediction' };
  }
  // Check optimal edge range
  if (edge > BACKTEST_INSIGHTS.optimalEdgeRange.max) {
    return { shouldTrade: false, reason: 'edge_in_overconfidence_zone' };
  }
  return { shouldTrade: true };
}

// Export refined parameters summary for display
export function getRefinementSummary(): string {
  return `
╔════════════════════════════════════════════════════════════╗
║          STRATEGY REFINEMENT SUMMARY                       ║
╚════════════════════════════════════════════════════════════╝

Based on 383 resolved paper trades:

KEY LEARNINGS:
• High edge (≥20%) predictions are OVERCONFIDENT (43.6% WR)
• Low edge (5-18%) is the SWEET SPOT (57.9% WR)
• CHOP regime is unprofitable (38.9% WR) - SKIP IT
• BTC needs special handling (42.1% WR) vs XRP/SOL good (54%+)

REFINED PARAMETERS:
┌──────────────────────────────────────────────────────────┐
│ Phase    │ Edge Threshold │ Min Probability │ Time Range │
├──────────────────────────────────────────────────────────┤
│ EARLY    │ 5% (was 8%)   │ 60% (was 58%)   │ 5-13 min   │
│ MID      │ 8% (was 10%)  │ 65% (was 60%)   │ 5-10 min   │
│ LATE     │ 12% (same)    │ 72% (was 70%)   │ 3-5 min    │
└──────────────────────────────────────────────────────────┘

MARKET-SPECIFIC:
• BTC: Lower edge threshold (-20%), skip CHOP completely
• ETH: Slightly relaxed, skip CHOP
• SOL/XRP: Standard parameters (perform well)

FILTERS ADDED:
• Skip trades with edge > 25% (overconfidence)
• Skip CHOP regime for BTC/ETH
• Skip if volatility > 0.4% or < 0.05%
• Skip if < 3 min remaining

Blend weights: 50/50 vol/TA (was 70/30) - more balanced
`;
}
