import { describe, expect, it } from "vitest";
import { computeRealizedVolatility } from "../engines/probability.ts";
import { RollingVolatilityCalculator } from "./volatilityBuffer.ts";

describe("RollingVolatilityCalculator", () => {
	// Generate realistic price data
	const priceData70 = Array.from({ length: 70 }, (_, i) => 68000 + Math.sin(i * 0.15) * 200 + i * 2);
	const stableData70 = Array.from({ length: 70 }, (_, i) => 68000 + Math.sin(i * 0.05) * 10);
	const volatileData70 = Array.from({ length: 70 }, (_, i) => 68000 + Math.sin(i * 0.5) * 1000);

	describe("initFromCloses", () => {
		it("should return null for array with less than 2 elements", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			expect(vol.initFromCloses([])).toBeNull();
			expect(vol.initFromCloses([100])).toBeNull();
		});

		it("should return a positive number for valid data", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			const result = vol.initFromCloses(priceData70);
			expect(result).not.toBeNull();
			expect(result!).toBeGreaterThan(0);
		});

		it("should match computeRealizedVolatility for 60-lookback", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			const incremental = vol.initFromCloses(priceData70);
			const original = computeRealizedVolatility(priceData70, 60);
			expect(incremental).not.toBeNull();
			expect(original).not.toBeNull();
			expect(incremental!).toBeCloseTo(original!, 10);
		});

		it("should match computeRealizedVolatility for stable prices", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			const incremental = vol.initFromCloses(stableData70);
			const original = computeRealizedVolatility(stableData70, 60);
			expect(incremental).toBeCloseTo(original!, 10);
		});

		it("should match computeRealizedVolatility for volatile prices", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			const incremental = vol.initFromCloses(volatileData70);
			const original = computeRealizedVolatility(volatileData70, 60);
			expect(incremental).toBeCloseTo(original!, 10);
		});

		it("should match with 240 candles", () => {
			const closes = Array.from({ length: 240 }, (_, i) => 68000 + Math.sin(i * 0.1) * 300 + i);
			const vol = new RollingVolatilityCalculator(60, 15);
			const incremental = vol.initFromCloses(closes);
			const original = computeRealizedVolatility(closes, 60);
			expect(incremental).toBeCloseTo(original!, 10);
		});
	});

	describe("update (incremental)", () => {
		it("should produce same result as initFromCloses when fed one-by-one", () => {
			const vol1 = new RollingVolatilityCalculator(60, 15);
			const bulk = vol1.initFromCloses(priceData70);

			const vol2 = new RollingVolatilityCalculator(60, 15);
			let incremental: number | null = null;
			for (const close of priceData70) {
				incremental = vol2.update(close);
			}

			expect(incremental).toBeCloseTo(bulk!, 10);
		});

		it("should return null until 2+ returns accumulated", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			expect(vol.update(100)).toBeNull(); // 1st price: no return yet
			expect(vol.update(101)).toBeNull(); // 2nd price: 1 return, need 2+
			expect(vol.update(102)).not.toBeNull(); // 3rd price: 2 returns — enough
		});

		it("should track .ready correctly", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			expect(vol.ready).toBe(false);
			vol.update(100);
			expect(vol.ready).toBe(false); // 0 returns
			vol.update(101);
			expect(vol.ready).toBe(false); // 1 return, need 2
			vol.update(102);
			expect(vol.ready).toBe(true); // 2 returns — ready
		});

		it("should track .size correctly", () => {
			const vol = new RollingVolatilityCalculator(5, 15);
			expect(vol.size).toBe(0);
			vol.update(100);
			expect(vol.size).toBe(0); // no return yet
			vol.update(101);
			expect(vol.size).toBe(1);
			vol.update(102);
			expect(vol.size).toBe(2);
			vol.update(103);
			vol.update(104);
			vol.update(105);
			expect(vol.size).toBe(5); // capped at lookback
			vol.update(106);
			expect(vol.size).toBe(5); // still capped
		});
	});

	describe("volatility scaling", () => {
		it("should scale by sqrt(windowMinutes)", () => {
			const closes = priceData70;
			const vol15 = new RollingVolatilityCalculator(60, 15);
			const vol1 = new RollingVolatilityCalculator(60, 1);
			const result15 = vol15.initFromCloses(closes);
			const result1 = vol1.initFromCloses(closes);

			// vol15 / vol1 should be sqrt(15) / sqrt(1)
			const ratio = result15! / result1!;
			expect(ratio).toBeCloseTo(Math.sqrt(15), 5);
		});
	});

	describe("reset", () => {
		it("should clear all state", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			vol.initFromCloses(priceData70);
			expect(vol.value).not.toBeNull();
			expect(vol.ready).toBe(true);

			vol.reset();
			expect(vol.value).toBeNull();
			expect(vol.ready).toBe(false);
			expect(vol.size).toBe(0);
		});

		it("should allow re-initialization after reset", () => {
			const vol = new RollingVolatilityCalculator(60, 15);
			vol.initFromCloses(stableData70);
			const stable = vol.value;
			vol.reset();
			vol.initFromCloses(volatileData70);
			const volatile_ = vol.value;
			expect(volatile_!).toBeGreaterThan(stable!);
		});
	});
});
