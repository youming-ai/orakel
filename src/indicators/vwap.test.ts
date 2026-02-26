import { describe, expect, it } from "vitest";
import type { Candle } from "../types.ts";
import { computeSessionVwap, computeVwapSeries } from "./vwap.ts";

function makeCandle(o: number, h: number, l: number, c: number, v: number): Candle {
	return { openTime: 0, open: o, high: h, low: l, close: c, volume: v, closeTime: 0 };
}

function getFirst<T>(arr: T[]): T {
	if (arr.length === 0) {
		throw new Error("Array is empty");
	}
	return arr[0]!;
}

describe("computeSessionVwap", () => {
	// Empty array → null
	it("returns null for empty array", () => {
		const result = computeSessionVwap([]);
		expect(result).toBeNull();
	});

	// Non-array (null as any) → null
	it("returns null for non-array input", () => {
		const result = computeSessionVwap(null as any);
		expect(result).toBeNull();
	});

	// Single candle: returns (H+L+C)/3 (when volume > 0)
	it("returns typical price for single candle with volume", () => {
		const candle = makeCandle(100, 110, 90, 105, 1000);
		const result = computeSessionVwap([candle]);
		const expectedTp = (110 + 90 + 105) / 3;
		expect(result).toBeCloseTo(expectedTp, 5);
	});

	// Zero volume for all → null
	it("returns null when total volume is zero", () => {
		const candles = [makeCandle(100, 110, 90, 105, 0), makeCandle(105, 115, 95, 110, 0)];
		const result = computeSessionVwap(candles);
		expect(result).toBeNull();
	});

	// Multiple candles: volume-weighted average of typical prices
	it("returns volume-weighted average of typical prices", () => {
		const candles = [makeCandle(100, 110, 90, 105, 1000), makeCandle(105, 115, 95, 110, 2000)];
		const result = computeSessionVwap(candles);
		const tp1 = (110 + 90 + 105) / 3;
		const tp2 = (115 + 95 + 110) / 3;
		const expectedVwap = (tp1 * 1000 + tp2 * 2000) / 3000;
		expect(result).toBeCloseTo(expectedVwap, 5);
	});

	// High-volume candle dominates: VWAP pulled toward that candle's typical price
	it("vwap is pulled toward high-volume candle", () => {
		const candles = [makeCandle(100, 110, 90, 105, 100), makeCandle(200, 210, 190, 205, 10000)];
		const result = computeSessionVwap(candles);
		const tp2 = (210 + 190 + 205) / 3;
		// High volume candle dominates, but not completely due to first candle contribution
		expect(result).toBeCloseTo(tp2, -1);
	});

	// Typical price calculation validation
	it("correctly calculates typical price (H+L+C)/3", () => {
		const candle = makeCandle(100, 120, 80, 100, 500);
		const result = computeSessionVwap([candle]);
		const expectedTp = (120 + 80 + 100) / 3;
		expect(result).toBeCloseTo(expectedTp, 5);
	});

	// Multiple candles with varying volumes
	it("handles multiple candles with varying volumes", () => {
		const candles = [
			makeCandle(100, 105, 95, 102, 500),
			makeCandle(102, 108, 100, 105, 1500),
			makeCandle(105, 110, 103, 108, 1000),
		];
		const result = computeSessionVwap(candles);
		expect(result).toBeDefined();
		expect(result).toBeGreaterThan(100);
		expect(result).toBeLessThan(110);
	});

	// Single candle with zero volume
	it("returns null for single candle with zero volume", () => {
		const candle = makeCandle(100, 110, 90, 105, 0);
		const result = computeSessionVwap([candle]);
		expect(result).toBeNull();
	});

	// Null values in candle properties
	it("handles null values in candle properties", () => {
		const candle: Candle = {
			openTime: 0,
			open: null,
			high: 110,
			low: 90,
			close: 105,
			volume: 1000,
			closeTime: 0,
		};
		const result = computeSessionVwap([candle]);
		expect(result).toBeDefined();
	});
});

describe("computeVwapSeries", () => {
	// Empty → []
	it("returns empty array for empty input", () => {
		const result = computeVwapSeries([]);
		expect(result).toEqual([]);
	});

	// Length matches input length
	it("returns array with same length as input", () => {
		const candles = [
			makeCandle(100, 110, 90, 105, 1000),
			makeCandle(105, 115, 95, 110, 1000),
			makeCandle(110, 120, 100, 115, 1000),
		];
		const result = computeVwapSeries(candles);
		expect(result).toHaveLength(3);
	});

	// First element = computeSessionVwap([candles[0]])
	it("first element equals vwap of first candle only", () => {
		const candles = [makeCandle(100, 110, 90, 105, 1000), makeCandle(105, 115, 95, 110, 1000)];
		const result = computeVwapSeries(candles);
		const expectedFirst = computeSessionVwap([getFirst(candles)]);
		expect(getFirst(result)).toBeCloseTo(expectedFirst!, 5);
	});

	// Last element = computeSessionVwap(allCandles)
	it("last element equals vwap of all candles", () => {
		const candles = [
			makeCandle(100, 110, 90, 105, 1000),
			makeCandle(105, 115, 95, 110, 1000),
			makeCandle(110, 120, 100, 115, 1000),
		];
		const result = computeVwapSeries(candles);
		const expectedLast = computeSessionVwap(candles);
		expect(result[result.length - 1]).toBeCloseTo(expectedLast!, 5);
	});

	// Cumulative: each entry is VWAP of all candles up to that index
	it("each entry is cumulative vwap up to that index", () => {
		const candles = [
			makeCandle(100, 110, 90, 105, 1000),
			makeCandle(105, 115, 95, 110, 1000),
			makeCandle(110, 120, 100, 115, 1000),
		];
		const result = computeVwapSeries(candles);
		const vwap1 = computeSessionVwap(candles.slice(0, 1));
		const vwap2 = computeSessionVwap(candles.slice(0, 2));
		const vwap3 = computeSessionVwap(candles.slice(0, 3));
		expect(result[0]).toBeCloseTo(vwap1!, 5);
		expect(result[1]).toBeCloseTo(vwap2!, 5);
		expect(result[2]).toBeCloseTo(vwap3!, 5);
	});

	// Single candle
	it("returns single-element array for single candle", () => {
		const candles = [makeCandle(100, 110, 90, 105, 1000)];
		const result = computeVwapSeries(candles);
		expect(result).toHaveLength(1);
		const expectedTp = (110 + 90 + 105) / 3;
		expect(result[0]).toBeCloseTo(expectedTp, 5);
	});

	// Series is non-decreasing for uptrend
	it("series increases for uptrend candles", () => {
		const candles = [
			makeCandle(100, 105, 95, 102, 1000),
			makeCandle(102, 108, 100, 105, 1000),
			makeCandle(105, 110, 103, 108, 1000),
		];
		const result = computeVwapSeries(candles);
		expect(result[0]).toBeLessThanOrEqual(result[1]!);
		expect(result[1]).toBeLessThanOrEqual(result[2]!);
	});
});
