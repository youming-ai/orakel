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

import { CONFIG } from "./config.ts";
import { getMarketPerformance } from "./engines/edge.ts";

// Additional filtering rules learned from backtest
export const BACKTEST_INSIGHTS = {
	// Volatility insights
	maxVolatility15m: CONFIG.strategy.maxVolatility15m ?? 0.004,
	minVolatility15m: CONFIG.strategy.minVolatility15m ?? 0.0005,
	// Regime insights
	skipChop: false, // Disabled globally -- per-market skipChop in getMarketPerformance takes precedence
};

// NOTE: calculateAdjustedThreshold was removed -- market-specific threshold
// adjustments are now consolidated in edge.ts (MARKET_PERFORMANCE.edgeMultiplier).

// Filter function to check if trade should be taken
export function shouldTakeTrade(params: { market: string; regime: string | null; volatility: number }): {
	shouldTrade: boolean;
	reason?: string;
} {
	const { market, regime, volatility } = params;
	const marketPerf = getMarketPerformance(market);
	// Skip CHOP entirely for markets with skipChop enabled
	if (regime === "CHOP" && (marketPerf.skipChop ?? false)) {
		return { shouldTrade: false, reason: "skip_chop_regime" };
	}
	// Volatility filters
	const maxVol = CONFIG.strategy.maxVolatility15m ?? 0.004;
	const minVol = CONFIG.strategy.minVolatility15m ?? 0.0005;
	if (volatility > maxVol) {
		return { shouldTrade: false, reason: "volatility_too_high" };
	}
	if (volatility < minVol) {
		return { shouldTrade: false, reason: "volatility_too_low" };
	}
	return { shouldTrade: true };
}
