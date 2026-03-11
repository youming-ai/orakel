import { EDGE_DEFAULTS } from "../core/config.ts";
import type { EdgeConfig, StrategyConfig } from "../core/configTypes.ts";
import { clamp } from "../core/utils.ts";
import type { EdgeResult, Phase, Regime, Side, Strength, TradeDecision } from "../trading/tradeTypes.ts";

export function computeEdge(params: {
	modelUp: number;
	modelDown: number;
	marketYes: number | null;
	marketNo: number | null;
	/** Additive bias applied to edgeDown (default 0) */
	edgeDownBias?: number;
	edgeConfig?: Partial<EdgeConfig>;
}): EdgeResult {
	const { modelUp, modelDown, marketYes, marketNo, edgeDownBias = 0, edgeConfig } = params;
	const cfg = { ...EDGE_DEFAULTS, ...edgeConfig };

	if (marketYes === null || marketNo === null) {
		return {
			marketUp: null,
			marketDown: null,
			edgeUp: null,
			edgeDown: null,
			rawSum: null,
			arbitrage: false,
			overpriced: false,
			vigTooHigh: false,
		};
	}

	const rawSum = marketYes + marketNo;
	const arbitrage = rawSum < cfg.arbitrageThreshold;
	const overpriced = rawSum > cfg.vigThreshold;

	const marketUp = rawSum > 0 ? clamp(marketYes / rawSum, 0, 1) : null;
	const marketDown = rawSum > 0 ? clamp(marketNo / rawSum, 0, 1) : null;

	if (marketUp === null || marketDown === null) {
		return {
			marketUp: null,
			marketDown: null,
			edgeUp: null,
			edgeDown: null,
			rawSum,
			arbitrage,
			overpriced,
			vigTooHigh: overpriced,
		};
	}

	const edgeUp = modelUp - marketUp;
	const edgeDown = modelDown - marketDown;

	return {
		marketUp,
		marketDown,
		edgeUp,
		edgeDown: edgeDown + edgeDownBias,
		rawSum,
		arbitrage,
		overpriced,
		vigTooHigh: overpriced,
	};
}

export function decide(params: {
	remainingMinutes: number;
	windowMinutes?: number;
	edgeUp: number | null;
	edgeDown: number | null;
	modelUp?: number | null;
	modelDown?: number | null;
	volatility15m?: number | null;
	priceToBeatMovePct?: number | null;
	regime?: Regime | null;
	strategy: StrategyConfig;
	edgeConfig?: Partial<EdgeConfig>;
	marketId?: string;
	marketYes?: number | null;
	isLive?: boolean;
}): TradeDecision {
	const {
		remainingMinutes,
		windowMinutes = 15,
		edgeUp,
		edgeDown,
		modelUp = null,
		modelDown = null,
		volatility15m = null,
		priceToBeatMovePct = null,
		regime = null,
		strategy,
		edgeConfig,
		marketId = "",
		marketYes = null,
		isLive = false,
	} = params;
	const cfg = { ...EDGE_DEFAULTS, ...edgeConfig };

	const ratio = windowMinutes > 0 ? remainingMinutes / windowMinutes : 0;
	const phase: Phase = ratio > cfg.phaseEarlyRatio ? "EARLY" : ratio > cfg.phaseLateCutoff ? "MID" : "LATE";

	if (edgeUp === null || edgeDown === null) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "missing_market_data" };
	}

	if ((modelUp !== null && !Number.isFinite(modelUp)) || (modelDown !== null && !Number.isFinite(modelDown))) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "model_prob_not_finite" };
	}
	if (!Number.isFinite(edgeUp) || !Number.isFinite(edgeDown)) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "edge_not_finite" };
	}

	const skipMin = strategy.liveSkipPriceMin;
	const skipMax = strategy.liveSkipPriceMax;
	if (isLive && marketYes !== null && skipMin !== undefined && skipMax !== undefined) {
		if (marketYes >= skipMin && marketYes <= skipMax) {
			return { action: "NO_TRADE", side: null, phase, regime, reason: `price_range_filtered_${skipMin}_${skipMax}` };
		}
	}

	const skipMarkets = strategy?.skipMarkets ?? [];
	if (skipMarkets.includes(marketId)) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "market_skipped_by_config" };
	}

	if (typeof strategy.minTimeLeftMin === "number" && remainingMinutes < strategy.minTimeLeftMin) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `time_left_below_${strategy.minTimeLeftMin}` };
	}

	if (typeof strategy.maxTimeLeftMin === "number" && remainingMinutes > strategy.maxTimeLeftMin) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `time_left_above_${strategy.maxTimeLeftMin}` };
	}

	if (
		volatility15m !== null &&
		typeof strategy.minVolatility15m === "number" &&
		volatility15m < strategy.minVolatility15m
	) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `vol_below_${strategy.minVolatility15m}` };
	}

	if (
		volatility15m !== null &&
		typeof strategy.maxVolatility15m === "number" &&
		volatility15m > strategy.maxVolatility15m
	) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `vol_above_${strategy.maxVolatility15m}` };
	}

	if (strategy.skipChop === true && regime === "CHOP") {
		return { action: "NO_TRADE", side: null, phase, regime, reason: "chop_regime" };
	}

	const chopMultiplier = regime === "CHOP" ? (strategy.chopEdgeMultiplier ?? 1.5) : 1;

	const threshold =
		(phase === "EARLY"
			? Number(strategy?.edgeThresholdEarly ?? 0.05)
			: phase === "MID"
				? Number(strategy?.edgeThresholdMid ?? 0.1)
				: Number(strategy?.edgeThresholdLate ?? 0.2)) * chopMultiplier;

	const minProb =
		phase === "EARLY"
			? Number(strategy?.minProbEarly ?? 0.55)
			: phase === "MID"
				? Number(strategy?.minProbMid ?? 0.6)
				: Number(strategy?.minProbLate ?? 0.65);

	const bestSide: Side = edgeUp > edgeDown ? "UP" : "DOWN";
	const bestEdge = bestSide === "UP" ? edgeUp : edgeDown;
	const bestModel = bestSide === "UP" ? modelUp : modelDown;
	const directionalMovePct =
		priceToBeatMovePct === null ? null : bestSide === "UP" ? priceToBeatMovePct : -priceToBeatMovePct;

	if (bestEdge < threshold) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `edge_below_${+threshold.toPrecision(10)}` };
	}

	if (bestModel !== null && bestModel < minProb) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `prob_below_${minProb}` };
	}

	if (typeof strategy.minExpectedEdge === "number" && bestEdge < strategy.minExpectedEdge) {
		return { action: "NO_TRADE", side: null, phase, regime, reason: `expected_edge_below_${strategy.minExpectedEdge}` };
	}

	if (typeof strategy.maxEntryPrice === "number" && bestModel !== null) {
		const bestMarketPrice = bestModel - bestEdge;
		if (bestMarketPrice > strategy.maxEntryPrice) {
			return {
				action: "NO_TRADE",
				side: null,
				phase,
				regime,
				reason: `entry_price_above_${strategy.maxEntryPrice}`,
			};
		}
	}

	if (
		directionalMovePct !== null &&
		typeof strategy.minPriceToBeatMovePct === "number" &&
		directionalMovePct < strategy.minPriceToBeatMovePct
	) {
		return {
			action: "NO_TRADE",
			side: null,
			phase,
			regime,
			reason: `ptb_move_below_${strategy.minPriceToBeatMovePct}`,
		};
	}

	const strength: Strength =
		bestEdge >= cfg.strengthStrongEdge ? "STRONG" : bestEdge >= cfg.strengthGoodEdge ? "GOOD" : "OPTIONAL";

	return { action: "ENTER", side: bestSide, phase, regime, strength, edge: bestEdge };
}
