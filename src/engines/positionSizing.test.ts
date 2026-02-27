import { describe, expect, it } from "vitest";
import { calculateKellyPositionSize } from "./positionSizing.ts";

describe("calculateKellyPositionSize", () => {
	it("computes raw Kelly with expected formula", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
		});

		expect(result.rawKelly).toBeCloseTo(0.25, 8);
		expect(result.adjustedKelly).toBeCloseTo(0.125, 8);
		expect(result.size).toBeCloseTo(12.5, 8);
	});

	it("defaults min size to 0.5", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.4,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 5,
		});

		expect(result.reason).toBe("negative_edge");
		expect(result.size).toBe(0);
	});

	it("defaults to half-Kelly", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
		});

		expect(result.adjustedKelly).toBeCloseTo(result.rawKelly * 0.5, 8);
	});

	it("returns negative_edge when raw Kelly <= 0", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.5,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 20,
		});

		expect(result.reason).toBe("negative_edge");
		expect(result.adjustedKelly).toBe(0);
		expect(result.size).toBe(0);
	});

	it("returns invalid_inputs when payouts are invalid", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 20,
		});

		expect(result.reason).toBe("invalid_inputs");
		expect(result.adjustedKelly).toBe(0);
	});

	it("returns invalid_inputs when win probability is NaN", () => {
		const result = calculateKellyPositionSize({
			winProbability: Number.NaN,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 20,
		});

		expect(result.reason).toBe("invalid_inputs");
	});

	it("boosts sizing for high confidence (>= 0.8)", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.8,
		});

		expect(result.adjustedKelly).toBeCloseTo(0.15, 8);
	});

	it("uses neutral multiplier for mid confidence", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.7,
		});

		expect(result.adjustedKelly).toBeCloseTo(0.125, 8);
	});

	it("reduces sizing for low confidence (< 0.5)", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.49,
		});

		expect(result.adjustedKelly).toBeCloseTo(0.075, 8);
	});

	it("applies CHOP regime penalty", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "CHOP",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.0625, 8);
	});

	it("applies RANGE regime penalty", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "RANGE",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.1, 8);
	});

	it("applies TREND boost", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.1375, 8);
	});

	it("applies TREND_UP aligned boost for UP side", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND_UP",
			side: "UP",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.1375, 8);
	});

	it("applies TREND_UP opposed penalty for DOWN side", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND_UP",
			side: "DOWN",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.075, 8);
	});

	it("applies TREND_DOWN aligned boost for DOWN side", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND_DOWN",
			side: "DOWN",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.1375, 8);
	});

	it("applies TREND_DOWN opposed penalty for UP side", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND_DOWN",
			side: "UP",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.075, 8);
	});

	it("treats TREND_UP as aligned when side missing", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND_UP",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.1375, 8);
	});

	it("applies explicit TREND_ALIGNED multiplier", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND_ALIGNED",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.1375, 8);
	});

	it("applies explicit TREND_OPPOSED multiplier", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "TREND_OPPOSED",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.075, 8);
	});

	it("ignores unknown regimes", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0.5,
			regime: "SIDEWAYS",
		});

		expect(result.adjustedKelly).toBeCloseTo(0.125, 8);
	});

	it("clamps adjusted Kelly at 25%", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.95,
			avgWinPayout: 0.9,
			avgLossPayout: 0.1,
			bankroll: 100,
			maxSize: 100,
			kellyFraction: 1,
			confidence: 1,
			regime: "TREND",
		});

		expect(result.adjustedKelly).toBe(0.25);
		expect(result.size).toBe(25);
	});

	it("clamps position size to maxSize", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.95,
			avgWinPayout: 0.9,
			avgLossPayout: 0.1,
			bankroll: 10_000,
			maxSize: 12,
			kellyFraction: 1,
			confidence: 1,
		});

		expect(result.size).toBe(12);
	});

	it("clamps position size to minSize", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.52,
			avgWinPayout: 0.5,
			avgLossPayout: 0.5,
			bankroll: 3,
			maxSize: 10,
			minSize: 1,
			kellyFraction: 0.5,
			confidence: 0.5,
		});

		expect(result.size).toBe(1);
	});

	it("uses minSize when bankroll is zero", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 0,
			maxSize: 10,
		});

		expect(result.size).toBe(0.5);
	});

	it("normalizes non-finite bankroll to zero", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: Number.NaN,
			maxSize: 10,
		});

		expect(result.size).toBe(0.5);
	});

	it("treats maxSize smaller than minSize as minSize", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.95,
			avgWinPayout: 0.8,
			avgLossPayout: 0.2,
			bankroll: 100,
			maxSize: 0.2,
			minSize: 1,
			kellyFraction: 1,
			confidence: 1,
		});

		expect(result.size).toBe(1);
	});

	it("clamps win probability below zero", () => {
		const result = calculateKellyPositionSize({
			winProbability: -1,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 10,
		});

		expect(result.reason).toBe("negative_edge");
	});

	it("clamps win probability above one", () => {
		const result = calculateKellyPositionSize({
			winProbability: 2,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
		});

		expect(result.rawKelly).toBeCloseTo(1, 8);
		expect(result.adjustedKelly).toBeCloseTo(0.25, 8);
	});

	it("clamps confidence below zero", () => {
		const withNegativeConfidence = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: -1,
		});

		const withZeroConfidence = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 0,
		});

		expect(withNegativeConfidence.adjustedKelly).toBeCloseTo(withZeroConfidence.adjustedKelly, 8);
	});

	it("clamps confidence above one", () => {
		const withHighConfidence = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 2,
		});

		const withOneConfidence = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			confidence: 1,
		});

		expect(withHighConfidence.adjustedKelly).toBeCloseTo(withOneConfidence.adjustedKelly, 8);
	});

	it("clamps kellyFraction below zero", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			kellyFraction: -1,
			confidence: 0.5,
		});

		expect(result.adjustedKelly).toBe(0);
		expect(result.size).toBe(0.5);
	});

	it("clamps kellyFraction above one", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
			kellyFraction: 2,
			confidence: 0.5,
		});

		expect(result.adjustedKelly).toBeCloseTo(0.25, 8);
	});

	it("returns kelly_sized reason on valid positive edge", () => {
		const result = calculateKellyPositionSize({
			winProbability: 0.7,
			avgWinPayout: 0.4,
			avgLossPayout: 0.6,
			bankroll: 100,
			maxSize: 100,
		});

		expect(result.reason).toBe("kelly_sized");
	});
});
