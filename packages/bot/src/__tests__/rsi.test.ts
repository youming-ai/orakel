import { describe, expect, it } from "vitest";
import { computeRsi, slopeLast, sma } from "../indicators/rsi.ts";

describe("computeRsi", () => {
	it("should return null for empty array", () => {
		expect(computeRsi([], 14)).toBeNull();
	});

	it("should return null for array shorter than period+1", () => {
		expect(computeRsi([1, 2, 3], 14)).toBeNull();
	});

	it("should return null for non-array input", () => {
		expect(computeRsi(null as any, 14)).toBeNull();
	});

	it("should return 100 for all gains (ascending)", () => {
		const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
		const rsi = computeRsi(closes, 14);
		expect(rsi).toBe(100);
	});

	it("should return near 0 for all losses (descending)", () => {
		const closes = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
		const rsi = computeRsi(closes, 14);
		expect(rsi).toBeLessThan(1);
	});

	it("should return ~50 for alternating gains/losses", () => {
		const closes = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10];
		const rsi = computeRsi(closes, 14);
		expect(rsi).toBeGreaterThan(40);
		expect(rsi).toBeLessThan(60);
	});

	it("should return value in [0, 100]", () => {
		const closes = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107];
		const rsi = computeRsi(closes, 14);
		expect(rsi).toBeGreaterThanOrEqual(0);
		expect(rsi).toBeLessThanOrEqual(100);
	});

	it("should account for full history with Wilder smoothing", () => {
		const closes = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];
		const rsiFull = computeRsi(closes, 14);
		const rsiSubset = computeRsi(closes.slice(-15), 14);

		expect(rsiFull).not.toBeNull();
		expect(rsiSubset).not.toBeNull();
		expect(rsiFull).not.toBe(rsiSubset);
		expect(rsiFull).toBeGreaterThanOrEqual(0);
		expect(rsiFull).toBeLessThanOrEqual(100);
	});

	it("should handle exact period+1 length", () => {
		const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
		const rsi = computeRsi(closes, 14);
		expect(rsi).toBe(100);
	});

	it("should detect overbought (>70)", () => {
		const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
		const rsi = computeRsi(closes, 14);
		expect(rsi).toBeGreaterThan(70);
	});

	it("should detect oversold (<30)", () => {
		const closes = [24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
		const rsi = computeRsi(closes, 14);
		expect(rsi).toBeLessThan(30);
	});

	it("should handle null values in array", () => {
		const closes = [1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
		const rsi = computeRsi(closes, 14);
		expect(typeof rsi).toBe("number");
	});

	it("should handle period of 1", () => {
		const closes = [1, 2];
		const rsi = computeRsi(closes, 1);
		expect(rsi).toBe(100);
	});

	it("should handle period of 2", () => {
		const closes = [1, 2, 3];
		const rsi = computeRsi(closes, 2);
		expect(rsi).toBe(100);
	});
});

describe("sma", () => {
	it("should calculate simple moving average", () => {
		const values = [1, 2, 3, 4, 5];
		const result = sma(values, 3);
		expect(result).toBe(4); // (3+4+5)/3 = 4
	});

	it("should return null for empty array", () => {
		expect(sma([], 3)).toBeNull();
	});

	it("should return null for array shorter than period", () => {
		expect(sma([1, 2], 3)).toBeNull();
	});

	it("should return null for non-array input", () => {
		expect(sma(null as any, 3)).toBeNull();
	});

	it("should handle exact period length", () => {
		const values = [2, 4, 6];
		const result = sma(values, 3);
		expect(result).toBe(4);
	});

	it("should use last N values", () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const result = sma(values, 3);
		expect(result).toBe(9); // (8+9+10)/3 = 9
	});

	it("should handle period of 1", () => {
		const values = [5, 10, 15];
		const result = sma(values, 1);
		expect(result).toBe(15);
	});

	it("should handle all same values", () => {
		const values = [5, 5, 5, 5, 5];
		const result = sma(values, 3);
		expect(result).toBe(5);
	});

	it("should handle negative values", () => {
		const values = [-1, -2, -3, -4, -5];
		const result = sma(values, 3);
		expect(result).toBe(-4); // (-3-4-5)/3 = -4
	});

	it("should handle decimal values", () => {
		const values = [1.5, 2.5, 3.5];
		const result = sma(values, 3);
		expect(result).toBeCloseTo(2.5, 5);
	});
});

describe("slopeLast", () => {
	it("should calculate positive slope", () => {
		const values = [1, 2, 3];
		const result = slopeLast(values, 3);
		expect(result).toBe(1); // (3-1)/(3-1) = 1
	});

	it("should calculate negative slope", () => {
		const values = [3, 2, 1];
		const result = slopeLast(values, 3);
		expect(result).toBe(-1); // (1-3)/(3-1) = -1
	});

	it("should return 0 for flat slope", () => {
		const values = [5, 5, 5];
		const result = slopeLast(values, 3);
		expect(result).toBe(0);
	});

	it("should return null for empty array", () => {
		expect(slopeLast([], 3)).toBeNull();
	});

	it("should return null for array shorter than points", () => {
		expect(slopeLast([1, 2], 3)).toBeNull();
	});

	it("should return null for non-array input", () => {
		expect(slopeLast(null as any, 3)).toBeNull();
	});

	it("should use last N values", () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const result = slopeLast(values, 3);
		expect(result).toBe(1); // (10-8)/(3-1) = 1
	});

	it("should handle points=1 (returns null)", () => {
		const values = [5, 10];
		const result = slopeLast(values, 1);
		expect(result).toBeNull();
	});

	it("should handle points=2", () => {
		const values = [5, 10];
		const result = slopeLast(values, 2);
		expect(result).toBe(5); // (10-5)/(2-1) = 5
	});

	it("should handle negative values", () => {
		const values = [-3, -2, -1];
		const result = slopeLast(values, 3);
		expect(result).toBe(1); // (-1-(-3))/(3-1) = 1
	});

	it("should handle decimal values", () => {
		const values = [1.5, 2.5, 3.5];
		const result = slopeLast(values, 3);
		expect(result).toBeCloseTo(1, 5);
	});

	it("should handle longer arrays", () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
		const result = slopeLast(values, 4);
		expect(result).toBe(1); // (12-9)/(4-1) = 1
	});
});
