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
	// Volatility insights
	maxVolatility15m: 0.004, // Skip if vol > 0.4% (losing trades showed high vol)
	minVolatility15m: 0.0005, // Skip if vol < 0.05% (not enough movement)
	// Regime insights
	skipChop: false, // Disabled globally — per-market skipChop in MARKET_ADJUSTMENTS takes precedence
};

// NOTE: calculateAdjustedThreshold was removed — market-specific threshold
// adjustments are now consolidated in edge.ts (MARKET_PERFORMANCE.edgeMultiplier).

// Filter function to check if trade should be taken
export function shouldTakeTrade(params: { market: string; regime: string | null; volatility: number }): {
	shouldTrade: boolean;
	reason?: string;
} {
	const { market, regime, volatility } = params;
	const marketAdj = MARKET_ADJUSTMENTS[market] || { skipChop: false };
	// Skip CHOP entirely for underperforming markets
	if (regime === "CHOP" && (marketAdj.skipChop || BACKTEST_INSIGHTS.skipChop)) {
		return { shouldTrade: false, reason: "skip_chop_regime" };
	}
	// Volatility filters
	if (volatility > BACKTEST_INSIGHTS.maxVolatility15m) {
		return { shouldTrade: false, reason: "volatility_too_high" };
	}
	if (volatility < BACKTEST_INSIGHTS.minVolatility15m) {
		return { shouldTrade: false, reason: "volatility_too_low" };
	}
	return { shouldTrade: true };
}
