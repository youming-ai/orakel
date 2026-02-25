import { describe, expect, it } from "vitest";
import type { MacdResult } from "../types.ts";
import {
	applyAdaptiveTimeDecay,
	applyTimeAwareness,
	blendProbabilities,
	computeRealizedVolatility,
	computeVolatilityImpliedProb,
	scoreDirection,
} from "./probability.ts";

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

describe("applyAdaptiveTimeDecay", () => {
	it("uses slower decay in high volatility environments", () => {
		const result = applyAdaptiveTimeDecay(0.7, 6, 15, 0.01);

		expect(result.decayType).toBe("medium");
		expect(result.timeDecay).toBeGreaterThan(0.5);
		expect(result.adjustedUp).toBeGreaterThan(0.6);
	});

	it("uses faster decay in low volatility environments", () => {
		const result = applyAdaptiveTimeDecay(0.7, 5, 15, 0.002);

		expect(result.decayType).toBe("fast");
		expect(result.timeDecay).toBeLessThan(0.5);
		expect(result.adjustedUp).toBeLessThan(0.6);
	});

	it("uses default 0.5% volatility when volatility is null", () => {
		const result = applyAdaptiveTimeDecay(0.7, 6, 15, null);

		expect(result.decayType).toBe("medium");
		expect(result.timeDecay).toBeGreaterThan(0.5);
	});

	it("returns symmetric probabilities", () => {
		const result = applyAdaptiveTimeDecay(0.61, 8, 15, 0.005);
		expect(result.adjustedUp + result.adjustedDown).toBeCloseTo(1, 10);
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

describe("computeVolatilityImpliedProb", () => {
	it.each([
		{ currentPrice: null, priceToBeat: 100, volatility15m: 0.01, timeLeftMin: 10 },
		{ currentPrice: 100, priceToBeat: null, volatility15m: 0.01, timeLeftMin: 10 },
		{ currentPrice: 100, priceToBeat: 0, volatility15m: 0.01, timeLeftMin: 10 },
		{ currentPrice: 100, priceToBeat: 100, volatility15m: null, timeLeftMin: 10 },
		{ currentPrice: 100, priceToBeat: 100, volatility15m: 0, timeLeftMin: 10 },
	])("returns null for invalid inputs %#", (input) => {
		expect(computeVolatilityImpliedProb(input)).toBeNull();
	});

	it("returns 0.99 when time elapsed and current price is above target", () => {
		expect(
			computeVolatilityImpliedProb({
				currentPrice: 101,
				priceToBeat: 100,
				volatility15m: 0.01,
				timeLeftMin: 0,
			}),
		).toBe(0.99);
	});

	it("returns 0.01 when time elapsed and current price is below target", () => {
		expect(
			computeVolatilityImpliedProb({
				currentPrice: 99,
				priceToBeat: 100,
				volatility15m: 0.01,
				timeLeftMin: -1,
			}),
		).toBe(0.01);
	});

	it("is dampened to max 0.85 when current price is far above target (crypto fat tail protection)", () => {
		const result = computeVolatilityImpliedProb({
			currentPrice: 120,
			priceToBeat: 100,
			volatility15m: 0.01,
			timeLeftMin: 15,
		});

		expect(result as number).toBeLessThanOrEqual(0.85);
		expect(result as number).toBeGreaterThan(0.5);
	});

	it("is dampened to min 0.15 when current price is far below target (crypto fat tail protection)", () => {
		const result = computeVolatilityImpliedProb({
			currentPrice: 80,
			priceToBeat: 100,
			volatility15m: 0.01,
			timeLeftMin: 15,
		});

		expect(result as number).toBeGreaterThanOrEqual(0.15);
		expect(result as number).toBeLessThan(0.5);
	});
});

describe("blendProbabilities", () => {
	it("returns TA-only result when vol implied probability is null", () => {
		const result = blendProbabilities({ volImpliedUp: null, taRawUp: 0.62 });

		expect(result).toEqual({ blendedUp: 0.62, blendedDown: 0.38, source: "ta_only" });
	});

	it("uses default 50/50 blending when weights are omitted", () => {
		const result = blendProbabilities({ volImpliedUp: 0.8, taRawUp: 0.4 });
		expect(result.blendedUp).toBeCloseTo(0.6, 8);
		expect(result.source).toBe("blended");
	});

	it("uses custom weights when provided", () => {
		const result = blendProbabilities({
			volImpliedUp: 0.8,
			taRawUp: 0.4,
			weights: { vol: 0.75, ta: 0.25 },
		});

		expect(result.blendedUp).toBeCloseTo(0.7, 8);
	});

	it("applies lead signal adjustment and clamps its impact", () => {
		const result = blendProbabilities({
			volImpliedUp: 0.5,
			taRawUp: 0.5,
			binanceLeadSignal: 0.2,
		});

		expect(result.blendedUp).toBeCloseTo(0.52, 8);
	});

	it("applies orderbook adjustment only when imbalance magnitude exceeds 0.2", () => {
		const base = blendProbabilities({ volImpliedUp: 0.6, taRawUp: 0.6, orderbookImbalance: 0.19 });
		const adjusted = blendProbabilities({ volImpliedUp: 0.6, taRawUp: 0.6, orderbookImbalance: 1 });

		expect(base.blendedUp).toBeCloseTo(0.6, 8);
		expect(adjusted.blendedUp).toBeCloseTo(0.62, 8);
	});

	it("clamps final blended probability to [0.01, 0.99]", () => {
		const high = blendProbabilities({
			volImpliedUp: 0.99,
			taRawUp: 0.99,
			binanceLeadSignal: 0.5,
			orderbookImbalance: 1,
		});
		const low = blendProbabilities({
			volImpliedUp: 0.01,
			taRawUp: 0.01,
			binanceLeadSignal: -0.5,
			orderbookImbalance: -1,
		});

		expect(high.blendedUp).toBe(0.99);
		expect(low.blendedUp).toBe(0.01);
	});
});
