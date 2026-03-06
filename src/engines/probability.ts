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

export function applyTimeAwareness(
	rawUp: number,
	remainingMinutes: number,
	windowMinutes: number,
): { timeDecay: number; adjustedUp: number; adjustedDown: number } {
	const timeDecay = clamp(remainingMinutes / windowMinutes, 0, 1);
	const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
	return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
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
