import { describe, expect, it } from "vitest";
import { computeVolatility, modelProbability, sigmoid } from "../engine/signal.ts";

describe("sigmoid", () => {
	it("returns 0.5 at z=0", () => {
		expect(sigmoid(0)).toBe(0.5);
	});

	it("returns ~1.0 for large positive z", () => {
		expect(sigmoid(10)).toBeCloseTo(1.0, 4);
	});

	it("returns ~0.0 for large negative z", () => {
		expect(sigmoid(-10)).toBeCloseTo(0.0, 4);
	});

	it("is symmetric around 0.5", () => {
		expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1.0, 10);
	});
});

describe("modelProbability", () => {
	it("returns 0.5 when deviation is 0", () => {
		const result = modelProbability(0, 150, 0.001, { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 });
		expect(result).toBeCloseTo(0.5, 2);
	});

	it("returns > 0.5 for positive deviation", () => {
		const result = modelProbability(0.002, 150, 0.001, { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 });
		expect(result).toBeGreaterThan(0.5);
	});

	it("returns < 0.5 for negative deviation", () => {
		const result = modelProbability(-0.002, 150, 0.001, { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 });
		expect(result).toBeLessThan(0.5);
	});

	it("confidence increases as time left decreases", () => {
		const params = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };
		const early = modelProbability(0.001, 280, 0.001, params);
		const late = modelProbability(0.001, 30, 0.001, params);
		// Late should be further from 0.5 (more confident)
		expect(Math.abs(late - 0.5)).toBeGreaterThan(Math.abs(early - 0.5));
	});

	it("confidence decreases with higher volatility", () => {
		const params = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };
		const lowVol = modelProbability(0.001, 150, 0.0005, params);
		const highVol = modelProbability(0.001, 150, 0.005, params);
		expect(Math.abs(lowVol - 0.5)).toBeGreaterThan(Math.abs(highVol - 0.5));
	});

	it("clamps to [0.01, 0.99]", () => {
		const params = { sigmoidScale: 50, minVolatility: 0.0001, epsilon: 0.001 };
		const extreme = modelProbability(0.1, 1, 0.0001, params);
		expect(extreme).toBeLessThanOrEqual(0.99);
		expect(extreme).toBeGreaterThanOrEqual(0.01);
	});
});

describe("computeVolatility", () => {
	it("returns 0 for single tick", () => {
		expect(computeVolatility([{ price: 80000, timestampMs: 0 }])).toBe(0);
	});

	it("returns 0 for identical prices", () => {
		const ticks = [
			{ price: 80000, timestampMs: 0 },
			{ price: 80000, timestampMs: 1000 },
			{ price: 80000, timestampMs: 2000 },
		];
		expect(computeVolatility(ticks)).toBe(0);
	});

	it("returns positive value for varying prices", () => {
		const ticks = [
			{ price: 80000, timestampMs: 0 },
			{ price: 80100, timestampMs: 1000 },
			{ price: 79900, timestampMs: 2000 },
			{ price: 80050, timestampMs: 3000 },
		];
		expect(computeVolatility(ticks)).toBeGreaterThan(0);
	});
});
