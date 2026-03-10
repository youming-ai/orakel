import type { Candle } from "../core/marketDataTypes.ts";
import { clamp } from "../core/utils.ts";
import type { MacdResult, ScoreResult } from "../trading/tradeTypes.ts";

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

	// Price vs VWAP: continuous distance-based scoring (max ±2)
	if (price !== null && vwap !== null && vwap > 0) {
		const vwapPct = (price - vwap) / vwap;
		const vwapSignal = clamp(vwapPct / 0.002, -1, 1); // saturates at ±0.2% distance
		if (vwapSignal > 0) up += 2 * vwapSignal;
		else down += 2 * -vwapSignal;
	}

	// VWAP slope: continuous (max ±2)
	if (vwapSlope !== null) {
		const slopeSignal = clamp(vwapSlope / 0.5, -1, 1); // saturates at slope ±0.5
		if (slopeSignal > 0) up += 2 * slopeSignal;
		else down += 2 * -slopeSignal;
	}

	// RSI: continuous mapping centered on 50 (max ±2)
	if (rsi !== null && rsiSlope !== null) {
		const rsiDeviation = clamp((rsi - 50) / 25, -1, 1); // RSI 75 → +1, RSI 25 → -1
		const slopeAgreement = (rsiDeviation > 0 && rsiSlope > 0) || (rsiDeviation < 0 && rsiSlope < 0) ? 1 : 0.5;
		if (rsiDeviation > 0) up += 2 * rsiDeviation * slopeAgreement;
		else down += 2 * -rsiDeviation * slopeAgreement;
	}

	// MACD: histogram direction + expansion (max ±2 + ±1 line)
	if (macd?.hist !== null && macd?.histDelta !== null) {
		const expandingGreen = Number(macd?.hist) > 0 && Number(macd?.histDelta) > 0;
		const expandingRed = Number(macd?.hist) < 0 && Number(macd?.histDelta) < 0;
		if (expandingGreen) up += 2;
		if (expandingRed) down += 2;

		if (Number(macd?.macd) > 0) up += 1;
		if (Number(macd?.macd) < 0) down += 1;
	}

	// Heiken Ashi: scaled by consecutive count (max ±1)
	if (heikenColor) {
		const haStrength = clamp(heikenCount / 4, 0, 1); // 4+ bars → full strength
		if (heikenColor === "green" && heikenCount >= 2) up += 1 * haStrength;
		if (heikenColor === "red" && heikenCount >= 2) down += 1 * haStrength;
	}

	if (failedVwapReclaim === true) down += 2;

	const rawUp = up / (up + down);
	return { upScore: up, downScore: down, rawUp };
}

export function applyTimeAwareness(
	rawUp: number,
	remainingMinutes: number,
	windowMinutes: number,
): { timeDecay: number; adjustedUp: number; adjustedDown: number } {
	const ratio = clamp(remainingMinutes / windowMinutes, 0, 1);
	const timeDecay = Math.sqrt(ratio);
	const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
	return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
}

export function aggregateCandles(candles: Candle[], aggregationMinutes: number): Candle[] {
	if (!Array.isArray(candles) || candles.length === 0 || aggregationMinutes <= 1) {
		return candles;
	}

	const bucketMs = aggregationMinutes * 60_000;
	const aggregated: Candle[] = [];
	let currentBucket: Candle | null = null;
	let currentBucketStart: number | null = null;

	for (const candle of candles) {
		const bucketStart = Math.floor(candle.openTime / bucketMs) * bucketMs;
		if (currentBucket === null || currentBucketStart !== bucketStart) {
			if (currentBucket) {
				aggregated.push(currentBucket);
			}
			currentBucketStart = bucketStart;
			currentBucket = {
				openTime: bucketStart,
				open: candle.open,
				high: candle.high,
				low: candle.low,
				close: candle.close,
				volume: candle.volume ?? 0,
				closeTime: candle.closeTime,
			};
			continue;
		}

		currentBucket.high =
			currentBucket.high === null
				? candle.high
				: candle.high === null
					? currentBucket.high
					: Math.max(currentBucket.high, candle.high);
		currentBucket.low =
			currentBucket.low === null
				? candle.low
				: candle.low === null
					? currentBucket.low
					: Math.min(currentBucket.low, candle.low);
		currentBucket.close = candle.close ?? currentBucket.close;
		currentBucket.closeTime = Math.max(currentBucket.closeTime, candle.closeTime);
		currentBucket.volume = Number(currentBucket.volume ?? 0) + Number(candle.volume ?? 0);
	}

	if (currentBucket) {
		aggregated.push(currentBucket);
	}

	return aggregated;
}

export function estimatePriceToBeatProbability(params: {
	currentPrice: number | null;
	priceToBeat: number | null;
	remainingMinutes: number;
	volatility15m: number | null;
}): number | null {
	const { currentPrice, priceToBeat, remainingMinutes, volatility15m } = params;
	if (currentPrice === null || priceToBeat === null || currentPrice <= 0 || remainingMinutes <= 0) {
		return null;
	}

	const distanceRatio = (currentPrice - priceToBeat) / currentPrice;
	const timeScale = Math.sqrt(Math.max(remainingMinutes, 1) / 15);
	const sigma = Math.max(volatility15m ?? 0, 0.003) * Math.max(timeScale, 0.5);
	const z = clamp(distanceRatio / sigma, -8, 8);
	return clamp(1 / (1 + Math.exp(-z * 1.6)), 0, 1);
}

export function blendProbabilities(
	taUp: number,
	ptbUp: number | null,
	taWeight: number = 0.5,
): {
	finalUp: number;
	finalDown: number;
	blendSource: string;
} {
	if (ptbUp === null) {
		return {
			finalUp: taUp,
			finalDown: 1 - taUp,
			blendSource: "ta_only",
		};
	}

	const normalizedWeight = clamp(taWeight, 0, 1);
	const finalUp = clamp(ptbUp * (1 - normalizedWeight) + taUp * normalizedWeight, 0, 1);
	return {
		finalUp,
		finalDown: 1 - finalUp,
		blendSource: "ptb_ta",
	};
}

/**
 * Compute time-adaptive TA weight: linearly interpolates between taWeightEarly (window start)
 * and taWeightLate (window end) based on remaining time ratio.
 *
 * Early in the window TA signals have more predictive time horizon, so TA weight is higher.
 * Late in the window the price-to-beat probability becomes more certain, so PtB weight increases.
 */
export function computeAdaptiveTaWeight(
	remainingMinutes: number,
	windowMinutes: number,
	taWeightEarly: number = 0.7,
	taWeightLate: number = 0.3,
): number {
	const ratio = clamp(remainingMinutes / windowMinutes, 0, 1);
	return taWeightLate + (taWeightEarly - taWeightLate) * ratio;
}

export function computeRealizedVolatility(closes: (number | null)[], lookback = 60): number | null {
	if (!Array.isArray(closes) || closes.length < lookback + 1) return null;
	const slice = closes.slice(-(lookback + 1));
	let sumSqRet = 0;
	let count = 0;
	for (let i = 1; i < slice.length; i += 1) {
		const cur = Number(slice[i]);
		const prev = Number(slice[i - 1]);
		if (prev <= 0 || cur <= 0) continue;
		const logRet = Math.log(cur / prev);
		sumSqRet += logRet * logRet;
		count += 1;
	}
	if (count === 0) return null;
	const variance1m = sumSqRet / count;
	return Math.sqrt(variance1m * 15);
}
