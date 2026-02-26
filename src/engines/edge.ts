import { CONFIG } from "../config.ts";
import type {
	ConfidenceResult,
	EdgeResult,
	Phase,
	Regime,
	Side,
	StrategyConfig,
	Strength,
	TradeDecision,
} from "../types.ts";
import { clamp, estimatePolymarketFee } from "../utils.ts";

const SOFT_CAP_EDGE = 0.22;
const HARD_CAP_EDGE = 0.3;
/** Sentinel multiplier: any regime multiplier >= this value means "skip trade entirely" */
const REGIME_DISABLED = 999;

// Market-specific performance from backtest (can be overridden in config.json)
// edgeMultiplier > 1.0 = RAISE threshold (harder to trade) for poor performers
// Use strategy.skipMarkets in config.json to skip markets entirely
const DEFAULT_MARKET_PERFORMANCE: Record<string, { winRate: number; edgeMultiplier: number }> = {
	BTC: { winRate: 0.421, edgeMultiplier: 1.5 }, // Worst performer → require 50% more edge
	ETH: { winRate: 0.469, edgeMultiplier: 1.2 }, // Below avg → require 20% more edge
	SOL: { winRate: 0.51, edgeMultiplier: 1.0 }, // Good performer → standard
	XRP: { winRate: 0.542, edgeMultiplier: 1.0 }, // Best performer → standard
};

/** Get market performance from config or use defaults */
function getMarketPerformance(marketId: string): { winRate: number; edgeMultiplier: number } {
	const configPerf = CONFIG.strategy.marketPerformance?.[marketId];
	if (configPerf) {
		return configPerf;
	}
	return DEFAULT_MARKET_PERFORMANCE[marketId] ?? { winRate: 0.5, edgeMultiplier: 1.0 };
}

// ============ Confidence Scoring ============

export function computeConfidence(params: {
	modelUp: number;
	modelDown: number;
	regime: Regime | null;
	volatility15m: number | null;
	orderbookImbalance: number | null;
	vwapSlope: number | null;
	rsi: number | null;
	macdHist: number | null;
	haColor: string | null;
	side: Side;
}): ConfidenceResult {
	const { modelUp, modelDown, regime, volatility15m, orderbookImbalance, vwapSlope, rsi, macdHist, haColor, side } =
		params;

	const isUp = side === "UP";
	const modelProb = isUp ? modelUp : modelDown;

	// 1. Indicator alignment (0-1) — penalize missing data
	let alignedIndicators = 0;
	let availableIndicators = 0;

	if (vwapSlope !== null) {
		availableIndicators++;
		if (isUp ? vwapSlope > 0 : vwapSlope < 0) alignedIndicators++;
	}
	if (rsi !== null) {
		availableIndicators++;
		if (isUp ? rsi > 50 && rsi < 80 : rsi < 50 && rsi > 20) alignedIndicators++;
	}
	if (macdHist !== null) {
		availableIndicators++;
		if (isUp ? macdHist > 0 : macdHist < 0) alignedIndicators++;
	}
	if (haColor !== null) {
		availableIndicators++;
		if (isUp ? haColor === "green" : haColor === "red") alignedIndicators++;
	}
	const indicatorAlignment = availableIndicators > 0 ? alignedIndicators / availableIndicators : 0.5;

	// 2. Volatility score (0-1): optimal range 0.3% - 0.8%
	let volatilityScore = 0.5;
	if (volatility15m !== null) {
		const volPct = volatility15m * 100;
		if (volPct >= 0.3 && volPct <= 0.8) {
			volatilityScore = 1.0;
		} else if (volPct >= 0.2 && volPct <= 1.0) {
			volatilityScore = 0.7;
		} else if (volPct < 0.2) {
			volatilityScore = 0.3; // Too low
		} else {
			volatilityScore = 0.4; // Too high
		}
	}

	// 3. Orderbook score (0-1): imbalance supports direction
	let orderbookScore = 0.5;
	if (orderbookImbalance !== null) {
		const supportsUp = orderbookImbalance > 0.2;
		const supportsDown = orderbookImbalance < -0.2;
		if ((isUp && supportsUp) || (!isUp && supportsDown)) {
			orderbookScore = 0.8 + Math.min(0.2, Math.abs(orderbookImbalance) * 0.2);
		} else if ((isUp && supportsDown) || (!isUp && supportsUp)) {
			orderbookScore = 0.3;
		}
	}

	// 4. Timing score (0-1): model probability strength
	let timingScore = 0.5;
	if (modelProb >= 0.7) timingScore = 1.0;
	else if (modelProb >= 0.6) timingScore = 0.8;
	else if (modelProb >= 0.55) timingScore = 0.6;
	else timingScore = 0.4;

	// 5. Regime score (0-1)
	let regimeScore = 0.5;
	if (regime === "TREND_UP" && isUp) regimeScore = 1.0;
	else if (regime === "TREND_DOWN" && !isUp) regimeScore = 1.0;
	else if (regime === "RANGE") regimeScore = 0.7;
	else if (regime === "CHOP") regimeScore = 0.2;
	else if (regime === "TREND_UP" && !isUp) regimeScore = 0.3;
	else if (regime === "TREND_DOWN" && isUp) regimeScore = 0.3;

	// Weighted average
	const weights = {
		indicatorAlignment: 0.25,
		volatilityScore: 0.15,
		orderbookScore: 0.15,
		timingScore: 0.25,
		regimeScore: 0.2,
	};

	const score = clamp(
		indicatorAlignment * weights.indicatorAlignment +
			volatilityScore * weights.volatilityScore +
			orderbookScore * weights.orderbookScore +
			timingScore * weights.timingScore +
			regimeScore * weights.regimeScore,
		0,
		1,
	);

	const level = score >= 0.7 ? "HIGH" : score >= 0.5 ? "MEDIUM" : "LOW";

	return {
		score,
		factors: {
			indicatorAlignment,
			volatilityScore,
			orderbookScore,
			timingScore,
			regimeScore,
		},
		level,
	};
}

function regimeMultiplier(
	regime: Regime | null | undefined,
	side: Side,
	multipliers: StrategyConfig["regimeMultipliers"] | null | undefined,
	marketId: string = "",
): number {
	// Skip CHOP completely for underperforming markets
	if (regime === "CHOP") {
		const marketPerf = getMarketPerformance(marketId);
		if (marketPerf && marketPerf.winRate < 0.45) {
			return REGIME_DISABLED;
		}
		return Number(multipliers?.CHOP ?? 1.3);
	}

	if (regime === "RANGE") return Number(multipliers?.RANGE ?? 1.0);

	const trendUp = regime === "TREND_UP";
	const trendDown = regime === "TREND_DOWN";
	if (trendUp || trendDown) {
		const aligned = (trendUp && side === "UP") || (trendDown && side === "DOWN");
		return aligned ? Number(multipliers?.TREND_ALIGNED ?? 0.8) : Number(multipliers?.TREND_OPPOSED ?? 1.2);
	}

	return 1;
}

// ============ Enhanced Edge Computation with Orderbook ============

export function computeEdge(params: {
	modelUp: number;
	modelDown: number;
	marketYes: number | null;
	marketNo: number | null;
	orderbookImbalance?: number | null;
	orderbookSpreadUp?: number | null;
	orderbookSpreadDown?: number | null;
}): EdgeResult {
	const { modelUp, modelDown, marketYes, marketNo, orderbookImbalance, orderbookSpreadUp, orderbookSpreadDown } =
		params;

	if (marketYes === null || marketNo === null) {
		return {
			marketUp: null,
			marketDown: null,
			edgeUp: null,
			edgeDown: null,
			effectiveEdgeUp: null,
			effectiveEdgeDown: null,
			rawSum: null,
			arbitrage: false,
			overpriced: false,
		};
	}

	const rawSum = marketYes + marketNo;
	const arbitrage = rawSum < 0.98;
	const overpriced = rawSum > 1.04;

	const marketUp = clamp(marketYes, 0, 1);
	const marketDown = clamp(marketNo, 0, 1);

	// Base edge
	const edgeUp = modelUp - marketUp;
	const edgeDown = modelDown - marketDown;

	// Adjust for orderbook slippage
	let effectiveEdgeUp = edgeUp;
	let effectiveEdgeDown = edgeDown;

	const imbalance = orderbookImbalance ?? null;
	const spreadUp = orderbookSpreadUp ?? null;
	const spreadDown = orderbookSpreadDown ?? null;

	if (imbalance !== null && Math.abs(imbalance) > 0.2) {
		// Strong buy pressure → buying UP costs more (less effective edge for UP)
		// Strong sell pressure → buying DOWN costs more (less effective edge for DOWN)
		const slippageFactor = Math.abs(imbalance) * 0.02; // Up to 2% adjustment

		if (imbalance > 0) {
			// More bids → UP is harder to fill
			effectiveEdgeUp = edgeUp - slippageFactor;
		} else {
			// More asks → DOWN is harder to fill
			effectiveEdgeDown = edgeDown - slippageFactor;
		}
	}

	// Penalize wide spreads (side-specific)
	if (spreadUp !== null && spreadUp > 0.02) {
		const spreadPenalty = (spreadUp - 0.02) * 0.5;
		effectiveEdgeUp -= spreadPenalty;
	}
	if (spreadDown !== null && spreadDown > 0.02) {
		const spreadPenalty = (spreadDown - 0.02) * 0.5;
		effectiveEdgeDown -= spreadPenalty;
	}
	// Deduct estimated Polymarket fees from effective edge
	// Use taker fee (no rebate) as conservative worst-case estimate.
	// If order executes as maker (postOnly GTD), actual fee is lower (bonus).
	const feeEstimateUp = estimatePolymarketFee(marketUp);
	const feeEstimateDown = estimatePolymarketFee(marketDown);
	effectiveEdgeUp -= feeEstimateUp;
	effectiveEdgeDown -= feeEstimateDown;

	const maxVig = 0.04;
	const vigTooHigh = rawSum > 1 + maxVig;

	return {
		marketUp,
		marketDown,
		edgeUp,
		edgeDown,
		effectiveEdgeUp,
		effectiveEdgeDown,
		rawSum,
		arbitrage,
		overpriced,
		vigTooHigh,
		feeEstimateUp,
		feeEstimateDown,
	};
}

export function decide(params: {
	remainingMinutes: number;
	edgeUp: number | null;
	edgeDown: number | null;
	effectiveEdgeUp?: number | null;
	effectiveEdgeDown?: number | null;
	modelUp?: number | null;
	modelDown?: number | null;
	regime?: Regime | null;
	modelSource?: string;
	strategy: StrategyConfig;
	marketId?: string;
	// Confidence params
	volatility15m?: number | null;
	orderbookImbalance?: number | null;
	vwapSlope?: number | null;
	rsi?: number | null;
	macdHist?: number | null;
	haColor?: string | null;
	minConfidence?: number;
}): TradeDecision {
	const {
		remainingMinutes,
		edgeUp,
		edgeDown,
		effectiveEdgeUp,
		effectiveEdgeDown,
		modelUp = null,
		modelDown = null,
		regime = null,
		strategy,
		marketId = "",
		volatility15m = null,
		orderbookImbalance = null,
		vwapSlope = null,
		rsi = null,
		macdHist = null,
		haColor = null,
		minConfidence = 0.5,
	} = params;

	const phase: Phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";

	// Refined thresholds based on backtest (lowered for better performance)
	const baseThreshold =
		phase === "EARLY"
			? Number(strategy?.edgeThresholdEarly ?? 0.06)
			: phase === "MID"
				? Number(strategy?.edgeThresholdMid ?? 0.08)
				: Number(strategy?.edgeThresholdLate ?? 0.1);

	const minProb =
		phase === "EARLY"
			? Number(strategy?.minProbEarly ?? 0.52)
			: phase === "MID"
				? Number(strategy?.minProbMid ?? 0.55)
				: Number(strategy?.minProbLate ?? 0.6);

	if (edgeUp === null || edgeDown === null) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "missing_market_data" };
	}

	// Check if market should be skipped entirely (via config)
	const skipMarkets = strategy?.skipMarkets ?? [];
	if (skipMarkets.includes(marketId)) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "market_skipped_by_config" };
	}

	// Use effective edge if available
	const effUp = effectiveEdgeUp ?? edgeUp;
	const effDown = effectiveEdgeDown ?? edgeDown;

	const bestSide: Side = effUp > effDown ? "UP" : "DOWN";
	const bestEdge = bestSide === "UP" ? effUp : effDown;
	const bestModel = bestSide === "UP" ? modelUp : modelDown;

	// Apply market-specific edge multiplier
	const marketPerf = getMarketPerformance(marketId);
	const marketMult = marketPerf?.edgeMultiplier ?? 1.0;
	const adjustedThreshold = baseThreshold * marketMult;

	const multiplier = regimeMultiplier(regime, bestSide, strategy?.regimeMultipliers, marketId);
	const threshold = adjustedThreshold * multiplier;

	// Skip regime entirely when multiplier is the disabled sentinel
	if (multiplier >= REGIME_DISABLED) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "skip_chop_poor_market" };
	}

	if (bestEdge < threshold) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `edge_below_${threshold.toFixed(3)}` };
	}

	if (bestModel !== null && bestModel < minProb) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `prob_below_${minProb}` };
	}

	// Apply BTC-specific probability threshold (Issue #4 fix)
	const effectiveMinProb = marketId === "BTC" ? Math.max(minProb, 0.58) : minProb;
	if (bestModel !== null && bestModel < effectiveMinProb) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `prob_below_${effectiveMinProb}_btc_adjusted` };
	}

	// BTC-specific protection: require higher confidence for poor performer (Issue #4 fix)
	const effectiveMinConfidence = marketId === "BTC" ? Math.max(minConfidence, 0.6) : minConfidence;

	// Overconfidence checks
	if (Math.abs(bestEdge) > HARD_CAP_EDGE) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "overconfident_hard_cap" };
	}
	if (Math.abs(bestEdge) > SOFT_CAP_EDGE) {
		const penalizedThreshold = threshold * 1.4;
		if (bestEdge < penalizedThreshold) {
			return { action: "NO_TRADE", side: null, phase, regime, reason: "overconfident_soft_cap" };
		}
	}

	// Compute confidence
	const confidence = computeConfidence({
		modelUp: modelUp ?? 0.5,
		modelDown: modelDown ?? 0.5,
		regime,
		volatility15m,
		orderbookImbalance,
		vwapSlope,
		rsi,
		macdHist,
		haColor: haColor ?? null,
		side: bestSide,
	});

	// Reject low confidence trades (using BTC-adjusted threshold)
	if (confidence.score < effectiveMinConfidence) {
		return {
			action: "NO_TRADE",
			side: null,
			phase,
			regime,
			reason: `confidence_${confidence.score.toFixed(2)}_below_${effectiveMinConfidence}`,
			confidence,
		};
	}

	// Adjust strength based on confidence
	let strength: Strength;
	if (confidence.score >= 0.75 && bestEdge >= 0.15) {
		strength = "STRONG";
	} else if (confidence.score >= 0.5 && bestEdge >= 0.08) {
		strength = "GOOD";
	} else {
		strength = "OPTIONAL";
	}

	return {
		action: "ENTER",
		side: bestSide,
		phase,
		regime,
		strength,
		edge: bestEdge,
		confidence,
	};
}
