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
import { detectArbitrage } from "./arbitrage.ts";

// NOTE: DEFAULT_MARKET_PERFORMANCE and getMarketPerformance() removed in composite-score rewrite.
// Market-specific behavior is now handled via skipMarkets in config.json and the composite quality score.
// The MarketPerformance type and marketPerformance config field are retained for backward compatibility.

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
	const weights = CONFIG.strategy.confidenceWeights ?? {
		indicatorAlignment: 0.2,
		volatilityScore: 0.2,
		orderbookScore: 0.2,
		timingScore: 0.2,
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

// ============ Enhanced Edge Computation with Orderbook ============

export function computeEdge(params: {
	modelUp: number;
	modelDown: number;
	marketYes: number | null;
	marketNo: number | null;
	marketId?: string;
	binanceChainlinkDelta?: number | null;
	orderbookImbalance?: number | null;
	orderbookSpreadUp?: number | null;
	orderbookSpreadDown?: number | null;
}): EdgeResult {
	const {
		modelUp,
		modelDown,
		marketYes,
		marketNo,
		marketId = "",
		binanceChainlinkDelta = null,
		orderbookImbalance,
		orderbookSpreadUp,
		orderbookSpreadDown,
	} = params;

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
			arbitrageDetected: false,
			arbitrageSpread: null,
			arbitrageDirection: null,
			overpriced: false,
		};
	}

	const rawSum = marketYes + marketNo;
	const sumArbitrage = rawSum < 0.98;
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
	const makerRebate = 0;
	const feeEstimateUp = estimatePolymarketFee(marketUp, makerRebate);
	const feeEstimateDown = estimatePolymarketFee(marketDown, makerRebate);
	effectiveEdgeUp -= feeEstimateUp;
	effectiveEdgeDown -= feeEstimateDown;

	const binanceImpliedUp =
		binanceChainlinkDelta !== null && Number.isFinite(binanceChainlinkDelta)
			? clamp(0.5 + binanceChainlinkDelta * 2, 0, 1)
			: null;
	const arbitrageOpportunity =
		binanceImpliedUp === null
			? null
			: detectArbitrage(marketId, marketUp, marketDown, binanceImpliedUp, CONFIG.strategy.arbitrageMinSpread ?? 0.02);
	const arbitrageDetected = arbitrageOpportunity !== null;

	if (arbitrageOpportunity !== null) {
		const arbitrageMaxBoost = CONFIG.strategy.arbitrageMaxBoost ?? 0.05;
		const arbitrageBoost = Math.min(arbitrageOpportunity.confidence * arbitrageMaxBoost, arbitrageMaxBoost);
		if (arbitrageOpportunity.direction === "BUY_UP") {
			effectiveEdgeUp += arbitrageBoost;
		} else if (arbitrageOpportunity.direction === "BUY_DOWN") {
			effectiveEdgeDown += arbitrageBoost;
		}
	}

	const maxVig = CONFIG.strategy.maxVig ?? 0.04;
	const vigTooHigh = rawSum > 1 + maxVig;

	return {
		marketUp,
		marketDown,
		edgeUp,
		edgeDown,
		effectiveEdgeUp,
		effectiveEdgeDown,
		rawSum,
		arbitrage: sumArbitrage || arbitrageDetected,
		arbitrageDetected,
		arbitrageSpread: arbitrageOpportunity?.spread ?? null,
		arbitrageDirection: arbitrageOpportunity?.direction ?? null,
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
	strategy: StrategyConfig;
	marketId?: string;
	// Confidence params
	volatility15m?: number | null;
	orderbookImbalance?: number | null;
	vwapSlope?: number | null;
	rsi?: number | null;
	macdHist?: number | null;
	haColor?: string | null;
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
	} = params;

	const phase: Phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";

	const minTimeLeft = strategy.minTimeLeftMin ?? 3;
	if (remainingMinutes < minTimeLeft) {
		return {
			action: "NO_TRADE",
			side: null,
			phase,
			regime,
			reason: `time_left_${remainingMinutes.toFixed(1)}m_below_${minTimeLeft}m`,
		};
	}

	// P0-1: Guard against NaN/Infinity in model probabilities
	if ((modelUp !== null && !Number.isFinite(modelUp)) || (modelDown !== null && !Number.isFinite(modelDown))) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "model_prob_not_finite" };
	}
	if ((edgeUp !== null && !Number.isFinite(edgeUp)) || (edgeDown !== null && !Number.isFinite(edgeDown))) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "edge_not_finite" };
	}

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

	const hardCapEdge = CONFIG.strategy.hardCapEdge ?? 0.3;
	if (Math.abs(bestEdge) > hardCapEdge) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "overconfident_hard_cap" };
	}

	// P1: Positive edge gate — composite score must not bypass fundamental edge requirement
	if (bestEdge <= 0) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "non_positive_edge" };
	}

	// P1: Volatility hard limits — extreme volatility is too risky regardless of quality
	if (volatility15m !== null) {
		const maxVol = strategy.maxVolatility15m ?? 0.004;
		const minVol = strategy.minVolatility15m ?? 0.0005;
		if (volatility15m > maxVol) {
			return { action: "NO_TRADE", side: null, phase, regime, reason: "volatility_too_high" };
		}
		if (volatility15m < minVol) {
			return { action: "NO_TRADE", side: null, phase, regime, reason: "volatility_too_low" };
		}
	}

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

	let edgeScore = 1 / (1 + Math.exp(-25 * (bestEdge - 0.04)));
	const timeScore = 1 / (1 + Math.exp(-0.8 * (remainingMinutes - 7)));

	// Overconfidence dampening: backtest shows very high edges perform worse
	const softCap = CONFIG.strategy.softCapEdge ?? 0.22;
	if (bestEdge > softCap) {
		const overconfidencePenalty = (bestEdge - softCap) * 3;
		edgeScore = Math.max(0.4, edgeScore - overconfidencePenalty);
	}

	const { indicatorAlignment, regimeScore, volatilityScore } = confidence.factors;

	// Rebalanced weights: edge 0.35, regime 0.20 (stronger CHOP penalty)
	const tradeQuality =
		edgeScore * 0.35 + indicatorAlignment * 0.2 + regimeScore * 0.2 + timeScore * 0.15 + volatilityScore * 0.1;

	const minTradeQuality = strategy.minTradeQuality ?? 0.55;

	if (tradeQuality < minTradeQuality) {
		return {
			action: "NO_TRADE",
			side: null,
			phase,
			regime,
			reason: `quality_${tradeQuality.toFixed(3)}_below_${minTradeQuality}`,
			confidence,
			tradeQuality,
		};
	}

	let strength: Strength;
	if (tradeQuality >= 0.75) {
		strength = "STRONG";
	} else if (tradeQuality >= 0.6) {
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
		tradeQuality,
	};
}
