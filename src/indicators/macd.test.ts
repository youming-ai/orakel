import { describe, expect, it } from "vitest";
import { computeMacd } from "./macd.ts";

describe("computeMacd", () => {
	// Guard: empty array
	it("returns null for empty array", () => {
		const result = computeMacd([], 12, 26, 9);
		expect(result).toBeNull();
	});

	// Guard: too short (length < slow+signal)
	it("returns null when array length < slow + signal", () => {
		const closes = Array.from({ length: 33 }, (_, i) => 100 + i);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).toBeNull();
	});

	// Guard: non-array input
	it("returns null for non-array input", () => {
		const result = computeMacd(null as any, 12, 26, 9);
		expect(result).toBeNull();
	});

	// Standard uptrend with 50+ closes
	it("returns MacdResult with positive macd for uptrend", () => {
		const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(result?.macd).toBeGreaterThan(0);
		expect(result?.signal).toBeDefined();
		expect(result?.hist).toBeDefined();
		expect(result?.histDelta).toBeDefined();
	});

	// Bullish crossover: hist > 0
	it("returns positive hist for bullish crossover scenario", () => {
		const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.3);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(result?.hist).toBeGreaterThan(0);
	});

	// Bearish crossover: hist < 0
	it("returns negative hist for bearish crossover scenario", () => {
		const closes = Array.from({ length: 60 }, (_, i) => 100 - i * 0.3);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(result?.hist).toBeLessThan(0);
	});

	// Expanding green histogram: hist > 0
	it("returns expanding green histogram (hist > 0)", () => {
		const closes = Array.from({ length: 70 }, (_, i) => 100 + i * 0.5);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(result?.hist).toBeGreaterThan(0);
		expect(result?.histDelta).toBeDefined();
	});

	// Expanding red histogram: hist < 0
	it("returns expanding red histogram (hist < 0)", () => {
		const closes = Array.from({ length: 70 }, (_, i) => 100 - i * 0.5);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(result?.hist).toBeLessThan(0);
		expect(result?.histDelta).toBeDefined();
	});

	// Contracting histogram: histDelta opposite sign to hist
	it("returns contracting histogram (histDelta opposite sign to hist)", () => {
		const closes = Array.from({ length: 80 }, (_, i) => {
			if (i < 40) return 100 + i * 0.5;
			return 120 - (i - 40) * 0.3;
		});
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		if (result?.histDelta !== null && result?.hist !== 0) {
			expect(Math.sign(result?.histDelta)).not.toBe(Math.sign(result?.hist));
		}
	});

	// Return shape validation: all 4 fields present
	it("returns object with all 4 required fields", () => {
		const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(result).toHaveProperty("macd");
		expect(result).toHaveProperty("signal");
		expect(result).toHaveProperty("hist");
		expect(result).toHaveProperty("histDelta");
	});

	// Flat prices (constant value): macd ≈ 0, hist ≈ 0
	it("returns near-zero macd and hist for flat prices", () => {
		const closes = Array.from({ length: 60 }, () => 100);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(Math.abs(result?.macd)).toBeLessThan(0.01);
		expect(Math.abs(result?.hist)).toBeLessThan(0.01);
	});

	// Custom parameters: fast=5, slow=13, signal=5
	it("works with custom fast/slow/signal parameters", () => {
		const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
		const result = computeMacd(closes, 5, 13, 5);
		expect(result).not.toBeNull();
		expect(result?.macd).toBeDefined();
		expect(result?.signal).toBeDefined();
		expect(result?.hist).toBeDefined();
	});

	// Minimum valid length: exactly slow + signal
	it("returns result for minimum valid length (slow + signal)", () => {
		const closes = Array.from({ length: 35 }, (_, i) => 100 + i * 0.5);
		const result = computeMacd(closes, 12, 26, 9);
		expect(result).not.toBeNull();
		expect(result?.macd).toBeDefined();
	});
});
