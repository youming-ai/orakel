import { describe, expect, it } from "vitest";
import type { Candle } from "../core/marketDataTypes.ts";
import {
	aggregateCandles,
	applyTimeAwareness,
	blendProbabilities,
	computeAdaptiveTaWeight,
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

	it("adds continuous bullish score when price is above VWAP", () => {
		const result = scoreDirection({
			price: 100.3,
			vwap: 100,
			vwapSlope: null,
			rsi: null,
			rsiSlope: null,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		// 0.3% distance / 0.2% saturation → clamped to 1.0, so up += 2*1 = 2
		expect(result.upScore).toBe(3);
		expect(result.downScore).toBe(1);
		expect(result.rawUp).toBeCloseTo(0.75, 8);
	});

	it("adds partial score for small VWAP distance", () => {
		const result = scoreDirection({
			price: 100.1,
			vwap: 100,
			vwapSlope: null,
			rsi: null,
			rsiSlope: null,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		// 0.1% distance / 0.2% saturation → 0.5, so up += 2*0.5 = 1
		expect(result.upScore).toBeCloseTo(2, 1);
		expect(result.rawUp).toBeGreaterThan(0.5);
		expect(result.rawUp).toBeLessThan(0.75);
	});

	it("adds continuous bearish score when price is below VWAP", () => {
		const result = scoreDirection({
			price: 99.7,
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

	it("adds continuous slope and RSI momentum for bullish conditions", () => {
		const result = scoreDirection({
			price: null,
			vwap: null,
			vwapSlope: 0.5,
			rsi: 62,
			rsiSlope: 0.5,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		// slope saturated at 0.5 → +2, RSI (62-50)/25=0.48 * agreement(1.0) * 2 ≈ 0.96
		expect(result.upScore).toBeGreaterThan(3.5);
		expect(result.downScore).toBe(1);
	});

	it("adds continuous slope and RSI momentum for bearish conditions", () => {
		const result = scoreDirection({
			price: null,
			vwap: null,
			vwapSlope: -0.5,
			rsi: 38,
			rsiSlope: -0.5,
			macd: null,
			heikenColor: null,
			heikenCount: 0,
			failedVwapReclaim: false,
		});

		expect(result.upScore).toBe(1);
		expect(result.downScore).toBeGreaterThan(3.5);
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

	it("adds heiken scaled by count and failed VWAP reclaim penalties", () => {
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

		// HA: count=2, strength=2/4=0.5, up += 1*0.5 = 0.5
		expect(result.upScore).toBeCloseTo(1.5, 8);
		expect(result.downScore).toBe(4);
		expect(result.rawUp).toBeLessThan(0.5);
	});

	it("produces strong bullish alignment with saturated signals", () => {
		const result = scoreDirection({
			price: 100.3,
			vwap: 100,
			vwapSlope: 0.5,
			rsi: 75,
			rsiSlope: 0.5,
			macd: buildMacd({ hist: 0.3, histDelta: 0.1, macd: 0.2 }),
			heikenColor: "green",
			heikenCount: 4,
			failedVwapReclaim: false,
		});

		expect(result.rawUp).toBeGreaterThan(0.85);
		expect(result.upScore).toBeGreaterThan(8);
		expect(result.downScore).toBe(1);
	});

	it("produces strong bearish alignment with saturated signals", () => {
		const result = scoreDirection({
			price: 99.7,
			vwap: 100,
			vwapSlope: -0.5,
			rsi: 25,
			rsiSlope: -0.5,
			macd: buildMacd({ hist: -0.3, histDelta: -0.1, macd: -0.2 }),
			heikenColor: "red",
			heikenCount: 4,
			failedVwapReclaim: true,
		});

		expect(result.rawUp).toBeLessThan(0.15);
		expect(result.upScore).toBe(1);
		expect(result.downScore).toBeGreaterThan(10);
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

	it("uses sqrt decay — half time preserves more signal than linear", () => {
		const result = applyTimeAwareness(0.7, 7.5, 15);
		// sqrt(0.5) ≈ 0.707, so adjustedUp = 0.5 + 0.2 * 0.707 ≈ 0.641
		expect(result.timeDecay).toBeCloseTo(Math.sqrt(0.5), 8);
		expect(result.adjustedUp).toBeCloseTo(0.5 + 0.2 * Math.sqrt(0.5), 8);
	});

	it("sqrt decay preserves signal better in LATE phase", () => {
		const result = applyTimeAwareness(0.7, 3, 15);
		// sqrt(0.2) ≈ 0.447, adjustedUp = 0.5 + 0.2 * 0.447 ≈ 0.589
		expect(result.timeDecay).toBeCloseTo(Math.sqrt(3 / 15), 8);
		expect(result.adjustedUp).toBeGreaterThan(0.58);
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

	it("blends ptb and ta probabilities with explicit weight", () => {
		const result = blendProbabilities(0.4, 0.7, 0.25);
		expect(result.blendSource).toBe("ptb_ta");
		expect(result.finalUp).toBeCloseTo(0.625, 8);
		expect(result.finalDown).toBeCloseTo(0.375, 8);
	});

	it("uses default 50/50 weight when no weight is specified", () => {
		const result = blendProbabilities(0.6, 0.4);
		// default taWeight = 0.5: finalUp = 0.4 * 0.5 + 0.6 * 0.5 = 0.5
		expect(result.blendSource).toBe("ptb_ta");
		expect(result.finalUp).toBeCloseTo(0.5, 8);
	});

	it("equal weight means TA and PtB contribute equally", () => {
		const result = blendProbabilities(0.7, 0.5);
		// default taWeight = 0.5: finalUp = 0.5 * 0.5 + 0.7 * 0.5 = 0.6
		expect(result.finalUp).toBeCloseTo(0.6, 8);
	});
});

describe("computeAdaptiveTaWeight", () => {
	it("returns taWeightEarly at full time remaining", () => {
		expect(computeAdaptiveTaWeight(15, 15, 0.7, 0.3)).toBeCloseTo(0.7, 8);
	});

	it("returns taWeightLate at zero time remaining", () => {
		expect(computeAdaptiveTaWeight(0, 15, 0.7, 0.3)).toBeCloseTo(0.3, 8);
	});

	it("returns midpoint at half time remaining", () => {
		expect(computeAdaptiveTaWeight(7.5, 15, 0.7, 0.3)).toBeCloseTo(0.5, 8);
	});

	it("clamps negative remaining to taWeightLate", () => {
		expect(computeAdaptiveTaWeight(-5, 15, 0.7, 0.3)).toBeCloseTo(0.3, 8);
	});

	it("clamps excess remaining to taWeightEarly", () => {
		expect(computeAdaptiveTaWeight(20, 15, 0.7, 0.3)).toBeCloseTo(0.7, 8);
	});

	it("uses defaults (0.7/0.3) when no weights provided", () => {
		expect(computeAdaptiveTaWeight(15, 15)).toBeCloseTo(0.7, 8);
		expect(computeAdaptiveTaWeight(0, 15)).toBeCloseTo(0.3, 8);
	});
});
