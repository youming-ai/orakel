import type { BlendResult, MacdResult, ScoreResult } from "../types.ts";
import { clamp, normalCDF } from "../utils.ts";

interface ScoreDirectionInput {
	price: number | null;
	vwap: number | null;
	vwapSlope: number | null;
	rsi: number | null;
	rsiSlope: number | null;
	macd: MacdResult | null;
	heikenColor: string | null;
	heikenCount: number;
	failedVwapReclaim: boolean;
}

export function scoreDirection(inputs: ScoreDirectionInput): ScoreResult {
	const { price, vwap, vwapSlope, rsi, rsiSlope, macd, heikenColor, heikenCount, failedVwapReclaim } = inputs;

	let up = 1;
	let down = 1;

	if (price !== null && vwap !== null) {
		if (price > vwap) up += 2;
		if (price < vwap) down += 2;
	}

	if (vwapSlope !== null) {
		if (vwapSlope > 0) up += 2;
		if (vwapSlope < 0) down += 2;
	}

	if (rsi !== null && rsiSlope !== null) {
		if (rsi > 55 && rsiSlope > 0) up += 2;
		if (rsi < 45 && rsiSlope < 0) down += 2;
	}

	if (macd?.hist !== null && macd?.histDelta !== null) {
		const expandingGreen = Number(macd?.hist) > 0 && Number(macd?.histDelta) > 0;
		const expandingRed = Number(macd?.hist) < 0 && Number(macd?.histDelta) < 0;
		if (expandingGreen) up += 2;
		if (expandingRed) down += 2;

		if (Number(macd?.macd) > 0) up += 1;
		if (Number(macd?.macd) < 0) down += 1;
	}

	if (heikenColor) {
		if (heikenColor === "green" && heikenCount >= 2) up += 1;
		if (heikenColor === "red" && heikenCount >= 2) down += 1;
	}

	if (failedVwapReclaim === true) down += 3;

	const rawUp = up / (up + down);
	return { upScore: up, downScore: down, rawUp };
}

/**
 * S-curve decay (smoothstep):
 * - Preserves confidence in early phase (>60% time remaining)
 * - Smooth transition in mid phase (30-60%)
 * - Fast decay in late phase (<30%)
 */
function sCurveDecay(linearDecay: number): number {
	if (linearDecay > 0.6) {
		// Early phase: preserve 95%+ of signal
		return 0.95 + 0.05 * ((linearDecay - 0.6) / 0.4);
	}
	if (linearDecay > 0.3) {
		// Mid phase: smoothstep transition
		const t = (linearDecay - 0.3) / 0.3;
		return 0.5 + 0.45 * (3 * t * t - 2 * t * t * t);
	}
	// Late phase: aggressive decay to 50%
	const t = linearDecay / 0.3;
	return 0.5 * t * t;
}

export function applyTimeAwareness(
	rawUp: number,
	remainingMinutes: number,
	windowMinutes: number,
): { timeDecay: number; adjustedUp: number; adjustedDown: number } {
	const linearDecay = clamp(remainingMinutes / windowMinutes, 0, 1);
	const timeDecay = clamp(sCurveDecay(linearDecay), 0, 1);
	const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
	return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
}

// Adaptive time decay based on volatility
export function applyAdaptiveTimeDecay(
	rawUp: number,
	remainingMinutes: number,
	windowMinutes: number,
	volatility15m: number | null,
): { timeDecay: number; adjustedUp: number; adjustedDown: number; decayType: string } {
	// High volatility = slower decay (more time for price to move)
	// Low volatility = faster decay (less likely to reach target)

	const volPct = volatility15m !== null ? volatility15m * 100 : 0.5;

	// Adjust effective time remaining based on volatility
	let effectiveRemaining = remainingMinutes;
	if (volPct > 0.8) {
		// High vol: add 20% effective time
		effectiveRemaining = remainingMinutes * 1.2;
	} else if (volPct < 0.3) {
		// Low vol: subtract 20% effective time
		effectiveRemaining = remainingMinutes * 0.8;
	}

	const linearDecay = clamp(effectiveRemaining / windowMinutes, 0, 1);
	const timeDecay = clamp(sCurveDecay(linearDecay), 0, 1);

	let decayType: string;
	if (linearDecay > 0.6) decayType = "slow";
	else if (linearDecay > 0.3) decayType = "medium";
	else decayType = "fast";

	const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
	return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp, decayType };
}

export function computeRealizedVolatility(closes: (number | null)[], lookback = 60): number | null {
	if (!Array.isArray(closes) || closes.length < lookback + 1) return null;
	const slice = closes.slice(-(lookback + 1));
	let sumSqRet = 0;
	for (let i = 1; i < slice.length; i += 1) {
		const logRet = Math.log(Number(slice[i]) / Number(slice[i - 1]));
		sumSqRet += logRet * logRet;
	}
	const variance1m = sumSqRet / lookback;
	return Math.sqrt(variance1m * 15);
}

export function computeVolatilityImpliedProb({
	currentPrice,
	priceToBeat,
	volatility15m,
	timeLeftMin,
	windowMin = 15,
}: {
	currentPrice: number | null;
	priceToBeat: number | null;
	volatility15m: number | null;
	timeLeftMin: number | null;
	windowMin?: number;
}): number | null {
	if (currentPrice === null || priceToBeat === null || priceToBeat === 0) return null;
	if (volatility15m === null || volatility15m <= 0) return null;
	if (timeLeftMin === null || timeLeftMin <= 0) return currentPrice > priceToBeat ? 0.99 : 0.01;

	const timeRatio = Math.sqrt(timeLeftMin / windowMin);
	const d = Math.log(currentPrice / priceToBeat);
	const z = d / (volatility15m * timeRatio);
	return normalCDF(z);
}

export function blendProbabilities({
	volImpliedUp,
	taRawUp,
	binanceLeadSignal = null,
	orderbookImbalance = null,
	weights = { vol: 0.5, ta: 0.5 }, // Changed from 0.7/0.3 to 0.5/0.5 per backtest
}: {
	volImpliedUp: number | null;
	taRawUp: number;
	binanceLeadSignal?: number | null;
	orderbookImbalance?: number | null;
	weights?: { vol?: number; ta?: number };
}): BlendResult {
	if (volImpliedUp === null) {
		return { blendedUp: taRawUp, blendedDown: 1 - taRawUp, source: "ta_only" };
	}

	const w = weights;
	const totalWeight = (w.vol ?? 0.5) + (w.ta ?? 0.5);
	let blendedUp = ((w.vol ?? 0.5) * volImpliedUp + (w.ta ?? 0.5) * taRawUp) / totalWeight;

	if (binanceLeadSignal !== null && Math.abs(binanceLeadSignal) > 0.001) {
		const leadAdjustment = clamp(binanceLeadSignal * 2, -0.02, 0.02);
		blendedUp += leadAdjustment;
	}
	if (orderbookImbalance !== null && Math.abs(orderbookImbalance) > 0.2) {
		const obAdjustment = clamp(orderbookImbalance * 0.03, -0.02, 0.02);
		blendedUp += obAdjustment;
	}

	blendedUp = clamp(blendedUp, 0.01, 0.99);
	return {
		blendedUp,
		blendedDown: 1 - blendedUp,
		source: "blended",
	};
}
