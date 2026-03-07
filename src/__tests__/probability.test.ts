import { describe, expect, it } from "vitest";
import type { Candle } from "../core/marketDataTypes.ts";
import {
	aggregateCandles,
	applyTimeAwareness,
	blendProbabilities,
	computeRealizedVolatility,
	estimatePriceToBeatProbability,
	scoreDirection,
} from "../engines/probability.ts";
import type { MacdResult } from "../trading/tradeTypes.ts";

function buildMacd(overrides: Partial<MacdResult> = {}): MacdResult {
	return {
		macd: 0,
		signal: 0,
		hist: 0,
		histDelta: 0,
		...overrides,
	};
}

describe("scoreDirection", () => {
	it("returns neutral baseline when all optional signals are null", () => {
		const result = scoreDirection({
			price: null,
			vwap: null,
			vwapSlope: null,
			rsi: null,
			rsiSlope: null,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		expect(result).toEqual({ upScore: 1, downScore: 1, rawUp: 0.5 });
	});

	it("adds bullish score when price is above VWAP", () => {
		const result = scoreDirection({
			price: 101,
			vwap: 100,
			vwapSlope: null,
			rsi: null,
			rsiSlope: null,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		expect(result.upScore).toBe(3);
		expect(result.downScore).toBe(1);
		expect(result.rawUp).toBeCloseTo(0.75, 8);
	});

	it("adds bearish score when price is below VWAP", () => {
		const result = scoreDirection({
			price: 99,
			vwap: 100,
			vwapSlope: null,
			rsi: null,
			rsiSlope: null,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		expect(result.upScore).toBe(1);
		expect(result.downScore).toBe(3);
		expect(result.rawUp).toBeCloseTo(0.25, 8);
	});

	it("adds slope and RSI momentum points for bullish conditions", () => {
		const result = scoreDirection({
			price: null,
			vwap: null,
			vwapSlope: 0.2,
			rsi: 62,
			rsiSlope: 0.5,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		expect(result.upScore).toBe(5);
		expect(result.downScore).toBe(1);
	});

	it("adds slope and RSI momentum points for bearish conditions", () => {
		const result = scoreDirection({
			price: null,
			vwap: null,
			vwapSlope: -0.2,
			rsi: 38,
			rsiSlope: -0.5,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		expect(result.upScore).toBe(1);
		expect(result.downScore).toBe(5);
	});

	it("adds MACD expanding green histogram and positive macd line points", () => {
		const result = scoreDirection({
			price: null,
			vwap: null,
			vwapSlope: null,
			rsi: null,
			rsiSlope: null,
			macd: buildMacd({ hist: 0.6, histDelta: 0.1, macd: 0.3 }),
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		expect(result.upScore).toBe(4);
		expect(result.downScore).toBe(1);
	});

	it("adds heiken and failed VWAP reclaim penalties", () => {
		const result = scoreDirection({
			price: null,
			vwap: null,
			vwapSlope: null,
			rsi: null,
			rsiSlope: null,
			macd: null,
			heikenColor: "green",
			heikenCount: 2,
			failedVwapReclaim: true,
		});

		expect(result.upScore).toBe(2);
		expect(result.downScore).toBe(4);
		expect(result.rawUp).toBeCloseTo(1 / 3, 8);
	});

	it("produces full bullish alignment outcome", () => {
		const result = scoreDirection({
			price: 101,
			vwap: 100,
			vwapSlope: 0.4,
			rsi: 60,
			rsiSlope: 0.2,
			macd: buildMacd({ hist: 0.3, histDelta: 0.1, macd: 0.2 }),
			heikenColor: "green",
			heikenCount: 3,
			failedVwapReclaim: false,
		});

		expect(result).toEqual({ upScore: 11, downScore: 1, rawUp: 11 / 12 });
	});

	it("produces full bearish alignment outcome", () => {
		const result = scoreDirection({
			price: 99,
			vwap: 100,
			vwapSlope: -0.4,
			rsi: 40,
			rsiSlope: -0.2,
			macd: buildMacd({ hist: -0.3, histDelta: -0.1, macd: -0.2 }),
			heikenColor: "red",
			heikenCount: 3,
			failedVwapReclaim: true,
		});

		expect(result).toEqual({ upScore: 1, downScore: 14, rawUp: 1 / 15 });
	});
});

describe("applyTimeAwareness", () => {
	it("keeps signal almost unchanged with full time remaining", () => {
		const result = applyTimeAwareness(0.8, 15, 15);

		expect(result.timeDecay).toBeCloseTo(1, 8);
		expect(result.adjustedUp).toBeCloseTo(0.8, 8);
		expect(result.adjustedDown).toBeCloseTo(0.2, 8);
	});

	it("decays to neutral when no time remains", () => {
		const result = applyTimeAwareness(0.9, 0, 15);

		expect(result.timeDecay).toBe(0);
		expect(result.adjustedUp).toBe(0.5);
		expect(result.adjustedDown).toBe(0.5);
	});

	it("keeps neutral probability at 0.5 regardless of time", () => {
		const early = applyTimeAwareness(0.5, 14, 15);
		const late = applyTimeAwareness(0.5, 1, 15);

		expect(early.adjustedUp).toBe(0.5);
		expect(late.adjustedUp).toBe(0.5);
	});

	it("clamps negative remaining time to zero", () => {
		const result = applyTimeAwareness(0.7, -3, 15);
		expect(result.adjustedUp).toBe(0.5);
	});
});

describe("computeRealizedVolatility", () => {
	it("returns null when closes are too short for lookback", () => {
		expect(computeRealizedVolatility([100, 101], 10)).toBeNull();
	});

	it("returns zero for constant prices", () => {
		const closes = Array.from({ length: 61 }, () => 100);
		expect(computeRealizedVolatility(closes, 60)).toBe(0);
	});

	it("returns positive volatility for varying prices", () => {
		const closes = Array.from({ length: 61 }, (_, i) => 100 + i * 0.5);
		const value = computeRealizedVolatility(closes, 60);
		expect(value).not.toBeNull();
		expect(value as number).toBeGreaterThan(0);
	});

	it("matches sqrt(variance * 15) scaling", () => {
		const closes = [100, 101, 100, 101, 100];
		const lookback = 4;
		const logRet = Math.log(101 / 100);
		const expected = Math.sqrt(((logRet * logRet * 4) / lookback) * 15);

		expect(computeRealizedVolatility(closes, lookback)).toBeCloseTo(expected, 12);
	});
});

describe("aggregateCandles", () => {
	it("aggregates consecutive candles into larger buckets", () => {
		const candles: Candle[] = [
			{ openTime: 0, open: 100, high: 101, low: 99, close: 100, volume: 1, closeTime: 59_999 },
			{ openTime: 60_000, open: 100, high: 102, low: 98, close: 101, volume: 2, closeTime: 119_999 },
			{ openTime: 120_000, open: 101, high: 103, low: 100, close: 102, volume: 3, closeTime: 179_999 },
		];

		const aggregated = aggregateCandles(candles, 2);
		expect(aggregated).toHaveLength(2);
		expect(aggregated[0]).toMatchObject({ open: 100, high: 102, low: 98, close: 101, volume: 3 });
		expect(aggregated[1]).toMatchObject({ open: 101, high: 103, low: 100, close: 102, volume: 3 });
	});
});

describe("estimatePriceToBeatProbability", () => {
	it("returns above 0.5 when current price is above priceToBeat", () => {
		const probability = estimatePriceToBeatProbability({
			currentPrice: 101,
			priceToBeat: 100,
			remainingMinutes: 15,
			volatility15m: 0.01,
		});

		expect(probability).not.toBeNull();
		expect(probability as number).toBeGreaterThan(0.5);
	});

	it("returns below 0.5 when current price is below priceToBeat", () => {
		const probability = estimatePriceToBeatProbability({
			currentPrice: 99,
			priceToBeat: 100,
			remainingMinutes: 15,
			volatility15m: 0.01,
		});

		expect(probability).not.toBeNull();
		expect(probability as number).toBeLessThan(0.5);
	});
});

describe("blendProbabilities", () => {
	it("falls back to ta_only when ptb probability is missing", () => {
		expect(blendProbabilities(0.62, null)).toEqual({
			finalUp: 0.62,
			finalDown: 0.38,
			blendSource: "ta_only",
		});
	});

	it("blends ptb and ta probabilities", () => {
		const result = blendProbabilities(0.4, 0.7, 0.25);
		expect(result.blendSource).toBe("ptb_ta");
		expect(result.finalUp).toBeCloseTo(0.625, 8);
		expect(result.finalDown).toBeCloseTo(0.375, 8);
	});
});
