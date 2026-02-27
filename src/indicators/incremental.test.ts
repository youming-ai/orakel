import { describe, expect, it } from "vitest";
import { IncrementalRSI } from "./incremental.ts";
import { computeRsi } from "./rsi.ts";

describe("IncrementalRSI", () => {
	const ascending15 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
	const descending15 = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
	const alternating15 = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10];
	const realistic20 = [
		100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107, 109, 108, 110, 109, 111,
	];

	describe("initFromCloses", () => {
		it("should return null for array shorter than period+1", () => {
			const rsi = new IncrementalRSI(14);
			expect(rsi.initFromCloses([1, 2, 3])).toBeNull();
		});

		it("should return null for empty array", () => {
			const rsi = new IncrementalRSI(14);
			expect(rsi.initFromCloses([])).toBeNull();
		});

		it("should return 100 for all ascending (all gains)", () => {
			const rsi = new IncrementalRSI(14);
			expect(rsi.initFromCloses(ascending15)).toBe(100);
		});

		it("should return near 0 for all descending (all losses)", () => {
			const rsi = new IncrementalRSI(14);
			const result = rsi.initFromCloses(descending15);
			expect(result).not.toBeNull();
			expect(result!).toBeLessThan(1);
		});

		it("should return ~50 for alternating gains/losses", () => {
			const rsi = new IncrementalRSI(14);
			const result = rsi.initFromCloses(alternating15);
			expect(result).not.toBeNull();
			expect(result!).toBeGreaterThan(40);
			expect(result!).toBeLessThan(60);
		});

		it("should return value in [0, 100]", () => {
			const rsi = new IncrementalRSI(14);
			const result = rsi.initFromCloses(realistic20);
			expect(result).not.toBeNull();
			expect(result!).toBeGreaterThanOrEqual(0);
			expect(result!).toBeLessThanOrEqual(100);
		});

		it("should match computeRsi exactly for period 14", () => {
			const rsi = new IncrementalRSI(14);
			const incremental = rsi.initFromCloses(realistic20);
			const original = computeRsi(realistic20, 14);
			expect(incremental).toBeCloseTo(original!, 10);
		});

		it("should match computeRsi for various data sets", () => {
			const datasets = [ascending15, descending15, alternating15, realistic20];
			for (const data of datasets) {
				const rsi = new IncrementalRSI(14);
				const incremental = rsi.initFromCloses(data);
				const original = computeRsi(data, 14);
				if (original === null) {
					expect(incremental).toBeNull();
				} else {
					expect(incremental).toBeCloseTo(original, 10);
				}
			}
		});

		it("should match computeRsi with period 7", () => {
			const rsi = new IncrementalRSI(7);
			const incremental = rsi.initFromCloses(realistic20);
			const original = computeRsi(realistic20, 7);
			expect(incremental).toBeCloseTo(original!, 10);
		});

		it("should match computeRsi for 240-candle array", () => {
			const closes = Array.from({ length: 240 }, (_, i) => 100 + Math.sin(i * 0.1) * 5 + i * 0.01);
			const rsi = new IncrementalRSI(14);
			const incremental = rsi.initFromCloses(closes);
			const original = computeRsi(closes, 14);
			expect(incremental).toBeCloseTo(original!, 10);
		});
	});

	describe("update (incremental)", () => {
		it("should produce same result as initFromCloses when fed one-by-one", () => {
			const rsi1 = new IncrementalRSI(14);
			const bulk = rsi1.initFromCloses(realistic20);

			const rsi2 = new IncrementalRSI(14);
			let incremental: number | null = null;
			for (const close of realistic20) {
				incremental = rsi2.update(close);
			}

			expect(incremental).toBeCloseTo(bulk!, 10);
		});

		it("should produce null until period+1 values fed", () => {
			const rsi = new IncrementalRSI(14);
			for (let i = 0; i < 14; i++) {
				expect(rsi.update(i + 1)).toBeNull();
			}
			// 15th value should produce a result (14 changes from 15 prices)
			const result = rsi.update(15);
			expect(result).not.toBeNull();
		});

		it("should track .ready correctly", () => {
			const rsi = new IncrementalRSI(3);
			expect(rsi.ready).toBe(false);
			rsi.update(1);
			expect(rsi.ready).toBe(false);
			rsi.update(2);
			expect(rsi.ready).toBe(false);
			rsi.update(3);
			expect(rsi.ready).toBe(false); // only 2 changes from 3 prices
			rsi.update(4); // 3 changes now = period
			expect(rsi.ready).toBe(true);
		});

		it("should update .value after each update", () => {
			const rsi = new IncrementalRSI(3);
			rsi.initFromCloses([1, 2, 3, 4]);
			expect(rsi.value).not.toBeNull();

			rsi.update(5);
			const v1 = rsi.value;
			rsi.update(4);
			const v2 = rsi.value;
			expect(v1).not.toBe(v2);
		});
	});

	describe("initFromClosesWithTrailing", () => {
		it("should return trailing RSI values", () => {
			const rsi = new IncrementalRSI(14);
			const trailing = rsi.initFromClosesWithTrailing(realistic20, 3);
			expect(trailing.length).toBeLessThanOrEqual(3);
			expect(trailing.length).toBeGreaterThan(0);

			// Last value should match initFromCloses
			const rsi2 = new IncrementalRSI(14);
			const fullResult = rsi2.initFromCloses(realistic20);
			expect(trailing[trailing.length - 1]).toBeCloseTo(fullResult!, 10);
		});

		it("should return correct number of trailing values", () => {
			const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.2) * 3);
			const rsi = new IncrementalRSI(14);
			const trailing = rsi.initFromClosesWithTrailing(closes, 5);
			expect(trailing.length).toBe(5);
		});
	});

	describe("reset", () => {
		it("should clear all state", () => {
			const rsi = new IncrementalRSI(14);
			rsi.initFromCloses(realistic20);
			expect(rsi.value).not.toBeNull();
			expect(rsi.ready).toBe(true);

			rsi.reset();
			expect(rsi.value).toBeNull();
			expect(rsi.ready).toBe(false);
		});

		it("should allow re-initialization after reset", () => {
			const rsi = new IncrementalRSI(14);
			const v1 = rsi.initFromCloses(ascending15);
			rsi.reset();
			const v2 = rsi.initFromCloses(descending15);
			expect(v1).not.toBe(v2);
		});
	});
});
