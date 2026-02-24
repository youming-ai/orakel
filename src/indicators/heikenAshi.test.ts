import { describe, expect, it } from "vitest";
import type { Candle, HaCandle } from "../types.ts";
import { computeHeikenAshi, countConsecutive } from "./heikenAshi.ts";

function makeCandle(o: number, h: number, l: number, c: number, v: number): Candle {
	return { openTime: 0, open: o, high: h, low: l, close: c, volume: v, closeTime: 0 };
}

function makeHa(isGreen: boolean): HaCandle {
	return isGreen
		? { open: 100, close: 105, high: 106, low: 99, isGreen: true, body: 5 }
		: { open: 105, close: 100, high: 106, low: 99, isGreen: false, body: 5 };
}

describe("computeHeikenAshi", () => {
	// Empty → []
	it("returns empty array for empty input", () => {
		const result = computeHeikenAshi([]);
		expect(result).toEqual([]);
	});

	// Non-array → []
	it("returns empty array for non-array input", () => {
		const result = computeHeikenAshi(null as any);
		expect(result).toEqual([]);
	});

	// Single candle: haClose, haOpen, haHigh, haLow calculations
	it("correctly calculates single candle HA values", () => {
		const candle = makeCandle(100, 110, 90, 105, 1000);
		const result = computeHeikenAshi([candle]);
		expect(result).toHaveLength(1);
		const ha = result[0];
		expect(ha.close).toBeCloseTo((100 + 110 + 90 + 105) / 4, 5);
		expect(ha.open).toBeCloseTo((100 + 105) / 2, 5);
		expect(ha.high).toBe(Math.max(110, ha.open, ha.close));
		expect(ha.low).toBe(Math.min(90, ha.open, ha.close));
	});

	// isGreen: haClose >= haOpen
	it("sets isGreen correctly based on haClose >= haOpen", () => {
		const bullish = makeCandle(100, 110, 90, 105, 1000);
		const bearish = makeCandle(105, 110, 90, 100, 1000);
		const result = computeHeikenAshi([bullish, bearish]);
		// First candle: haClose = (100+110+90+105)/4 = 101.25, haOpen = (100+105)/2 = 102.5
		// So isGreen = false (haClose < haOpen)
		expect(result[0].isGreen).toBe(false);
		// Second candle: haOpen is chained from first
		expect(result[1].isGreen).toBeDefined();
	});

	// body: abs(haClose - haOpen)
	it("calculates body as absolute difference between haClose and haOpen", () => {
		const candle = makeCandle(100, 110, 90, 105, 1000);
		const result = computeHeikenAshi([candle]);
		const expectedBody = Math.abs(result[0].close - result[0].open);
		expect(result[0].body).toBeCloseTo(expectedBody, 5);
	});

	// Subsequent candles: haOpen = (prevHaOpen + prevHaClose) / 2
	it("chains haOpen from previous candle", () => {
		const candles = [makeCandle(100, 110, 90, 105, 1000), makeCandle(105, 115, 95, 110, 1000)];
		const result = computeHeikenAshi(candles);
		expect(result).toHaveLength(2);
		const expectedSecondOpen = (result[0].open + result[0].close) / 2;
		expect(result[1].open).toBeCloseTo(expectedSecondOpen, 5);
	});

	// Length preserved: N candles → N HaCandles
	it("preserves length: N candles → N HaCandles", () => {
		const candles = Array.from({ length: 10 }, (_, i) => makeCandle(100 + i, 110 + i, 90 + i, 105 + i, 1000));
		const result = computeHeikenAshi(candles);
		expect(result).toHaveLength(10);
	});

	// Multi-candle chain: verify chaining of haOpen
	it("verifies chaining of haOpen across multiple candles", () => {
		const candles = [
			makeCandle(100, 110, 90, 105, 1000),
			makeCandle(105, 115, 95, 110, 1000),
			makeCandle(110, 120, 100, 115, 1000),
		];
		const result = computeHeikenAshi(candles);
		expect(result[1].open).toBeCloseTo((result[0].open + result[0].close) / 2, 5);
		expect(result[2].open).toBeCloseTo((result[1].open + result[1].close) / 2, 5);
	});

	// Bullish candles (O<C consistently) → mostly isGreen=true
	it("returns mostly green candles for uptrend", () => {
		const candles = Array.from({ length: 10 }, (_, i) => makeCandle(100 + i, 110 + i, 90 + i, 105 + i, 1000));
		const result = computeHeikenAshi(candles);
		const greenCount = result.filter((ha) => ha.isGreen).length;
		expect(greenCount).toBeGreaterThan(5);
	});

	// haHigh = max(H, haOpen, haClose)
	it("haHigh is max of candle high, haOpen, and haClose", () => {
		const candle = makeCandle(100, 110, 90, 105, 1000);
		const result = computeHeikenAshi([candle]);
		const ha = result[0];
		const expectedHigh = Math.max(110, ha.open, ha.close);
		expect(ha.high).toBe(expectedHigh);
	});

	// haLow = min(L, haOpen, haClose)
	it("haLow is min of candle low, haOpen, and haClose", () => {
		const candle = makeCandle(100, 110, 90, 105, 1000);
		const result = computeHeikenAshi([candle]);
		const ha = result[0];
		const expectedLow = Math.min(90, ha.open, ha.close);
		expect(ha.low).toBe(expectedLow);
	});

	// Downtrend: mostly red candles
	it("returns mostly red candles for downtrend", () => {
		const candles = Array.from({ length: 10 }, (_, i) => makeCandle(110 - i, 120 - i, 100 - i, 105 - i, 1000));
		const result = computeHeikenAshi(candles);
		const redCount = result.filter((ha) => !ha.isGreen).length;
		expect(redCount).toBeGreaterThan(5);
	});

	// First candle special case: haOpen = (O+C)/2
	it("first candle uses (O+C)/2 for haOpen", () => {
		const candle = makeCandle(100, 110, 90, 105, 1000);
		const result = computeHeikenAshi([candle]);
		expect(result[0].open).toBeCloseTo((100 + 105) / 2, 5);
	});

	// Null values in candle properties
	it("handles null values in candle properties", () => {
		const candle: Candle = {
			openTime: 0,
			open: 100,
			high: 110,
			low: 90,
			close: 105,
			volume: null,
			closeTime: 0,
		};
		const result = computeHeikenAshi([candle]);
		expect(result).toHaveLength(1);
		expect(result[0].close).toBeDefined();
	});
});

describe("countConsecutive", () => {
	// Empty → {color: null, count: 0}
	it("returns {color: null, count: 0} for empty array", () => {
		const result = countConsecutive([]);
		expect(result).toEqual({ color: null, count: 0 });
	});

	// All green (5 candles) → {color: "green", count: 5}
	it("returns {color: 'green', count: 5} for all green candles", () => {
		const haCandles = Array.from({ length: 5 }, () => makeHa(true));
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "green", count: 5 });
	});

	// All red (3 candles) → {color: "red", count: 3}
	it("returns {color: 'red', count: 3} for all red candles", () => {
		const haCandles = Array.from({ length: 3 }, () => makeHa(false));
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "red", count: 3 });
	});

	// Mixed ending green [R,R,G,G,G] → {color: "green", count: 3}
	it("counts consecutive from end: [R,R,G,G,G] → {color: 'green', count: 3}", () => {
		const haCandles = [makeHa(false), makeHa(false), makeHa(true), makeHa(true), makeHa(true)];
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "green", count: 3 });
	});

	// Mixed ending red [G,G,R] → {color: "red", count: 1}
	it("counts consecutive from end: [G,G,R] → {color: 'red', count: 1}", () => {
		const haCandles = [makeHa(true), makeHa(true), makeHa(false)];
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "red", count: 1 });
	});

	// Single candle green → {color: "green", count: 1}
	it("returns {color: 'green', count: 1} for single green candle", () => {
		const haCandles = [makeHa(true)];
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "green", count: 1 });
	});

	// Single candle red → {color: "red", count: 1}
	it("returns {color: 'red', count: 1} for single red candle", () => {
		const haCandles = [makeHa(false)];
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "red", count: 1 });
	});

	// Non-array input
	it("returns {color: null, count: 0} for non-array input", () => {
		const result = countConsecutive(null as any);
		expect(result).toEqual({ color: null, count: 0 });
	});

	// Alternating pattern [G,R,G,R,G] → {color: "green", count: 1}
	it("counts only last consecutive: [G,R,G,R,G] → {color: 'green', count: 1}", () => {
		const haCandles = [makeHa(true), makeHa(false), makeHa(true), makeHa(false), makeHa(true)];
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "green", count: 1 });
	});

	// Long green streak
	it("counts long green streak correctly", () => {
		const haCandles = Array.from({ length: 10 }, () => makeHa(true));
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "green", count: 10 });
	});

	// Long red streak
	it("counts long red streak correctly", () => {
		const haCandles = Array.from({ length: 8 }, () => makeHa(false));
		const result = countConsecutive(haCandles);
		expect(result).toEqual({ color: "red", count: 8 });
	});
});
