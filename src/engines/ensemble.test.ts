import { describe, expect, it } from "vitest";
import { computeEnsemble } from "./ensemble.ts";

describe("computeEnsemble", () => {
	it("computes ensemble with all models available", () => {
		const result = computeEnsemble({
			volImpliedUp: 0.62,
			taRawUp: 0.56,
			blendedUp: 0.59,
			blendSource: "blended",
			signalQualityWinRate: 0.64,
			signalQualityConfidence: "MEDIUM",
			regime: "RANGE",
			volatility15m: 0.005,
			orderbookImbalance: 0,
		});

		expect(result.finalUp).toBeGreaterThan(0.56);
		expect(result.finalDown).toBeCloseTo(1 - result.finalUp, 10);
		expect(result.models.length).toBe(4);
	});

	it("handles ta_only case with vol_implied unavailable", () => {
		const result = computeEnsemble({
			volImpliedUp: null,
			taRawUp: 0.61,
			blendedUp: 0.61,
			blendSource: "ta_only",
			signalQualityWinRate: null,
			signalQualityConfidence: "INSUFFICIENT",
			regime: "RANGE",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});

		expect(result.finalUp).toBeCloseTo(0.61, 10);
		expect(result.models.find((m) => m.name === "vol_implied")?.available).toBe(false);
	});

	it("sets signal_quality weight to 0 when confidence is INSUFFICIENT", () => {
		const result = computeEnsemble({
			volImpliedUp: 0.6,
			taRawUp: 0.6,
			blendedUp: 0.6,
			blendSource: "blended",
			signalQualityWinRate: 0.9,
			signalQualityConfidence: "INSUFFICIENT",
			regime: "RANGE",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});

		expect(result.models.find((m) => m.name === "signal_quality")?.weight).toBe(0);
	});

	it("assigns higher signal_quality influence at HIGH confidence", () => {
		const high = computeEnsemble({
			volImpliedUp: 0.5,
			taRawUp: 0.5,
			blendedUp: 0.5,
			blendSource: "blended",
			signalQualityWinRate: 0.9,
			signalQualityConfidence: "HIGH",
			regime: "RANGE",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});
		const low = computeEnsemble({
			volImpliedUp: 0.5,
			taRawUp: 0.5,
			blendedUp: 0.5,
			blendSource: "blended",
			signalQualityWinRate: 0.9,
			signalQualityConfidence: "LOW",
			regime: "RANGE",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});

		expect(high.finalUp).toBeGreaterThan(low.finalUp);
	});

	it("in CHOP regime boosts signal_quality weight", () => {
		const chop = computeEnsemble({
			volImpliedUp: 0.5,
			taRawUp: 0.5,
			blendedUp: 0.5,
			blendSource: "blended",
			signalQualityWinRate: 0.8,
			signalQualityConfidence: "HIGH",
			regime: "CHOP",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});
		const range = computeEnsemble({
			volImpliedUp: 0.5,
			taRawUp: 0.5,
			blendedUp: 0.5,
			blendSource: "blended",
			signalQualityWinRate: 0.8,
			signalQualityConfidence: "HIGH",
			regime: "RANGE",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});

		const chopWeight = chop.models.find((m) => m.name === "signal_quality")?.weight ?? 0;
		const rangeWeight = range.models.find((m) => m.name === "signal_quality")?.weight ?? 0;
		expect(chopWeight).toBeGreaterThan(rangeWeight);
	});

	it("agreement is approximately 1.0 when all models agree", () => {
		const result = computeEnsemble({
			volImpliedUp: 0.6,
			taRawUp: 0.6,
			blendedUp: 0.6,
			blendSource: "blended",
			signalQualityWinRate: 0.6,
			signalQualityConfidence: "HIGH",
			regime: "RANGE",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});

		expect(result.agreement).toBeCloseTo(1, 8);
	});

	it("agreement drops when models strongly disagree", () => {
		const result = computeEnsemble({
			volImpliedUp: 0.99,
			taRawUp: 0.01,
			blendedUp: 0.99,
			blendSource: "blended",
			signalQualityWinRate: 0.01,
			signalQualityConfidence: "HIGH",
			regime: "RANGE",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});

		expect(result.agreement).toBeLessThan(0.5);
	});

	it("always clamps finalUp to [0.01, 0.99]", () => {
		const high = computeEnsemble({
			volImpliedUp: 0.99,
			taRawUp: 0.99,
			blendedUp: 0.99,
			blendSource: "blended",
			signalQualityWinRate: 0.99,
			signalQualityConfidence: "HIGH",
			regime: "RANGE",
			volatility15m: 0.02,
			orderbookImbalance: 0.9,
		});
		const low = computeEnsemble({
			volImpliedUp: 0.01,
			taRawUp: 0.01,
			blendedUp: 0.01,
			blendSource: "blended",
			signalQualityWinRate: 0.01,
			signalQualityConfidence: "HIGH",
			regime: "RANGE",
			volatility15m: 0.02,
			orderbookImbalance: -0.9,
		});

		expect(high.finalUp).toBeGreaterThanOrEqual(0.01);
		expect(high.finalUp).toBeLessThanOrEqual(0.99);
		expect(low.finalUp).toBeGreaterThanOrEqual(0.01);
		expect(low.finalUp).toBeLessThanOrEqual(0.99);
	});

	it("reports dominantModel as highest weighted available model", () => {
		const result = computeEnsemble({
			volImpliedUp: 0.5,
			taRawUp: 0.5,
			blendedUp: 0.5,
			blendSource: "blended",
			signalQualityWinRate: 0.9,
			signalQualityConfidence: "HIGH",
			regime: "CHOP",
			volatility15m: 0.004,
			orderbookImbalance: null,
		});

		expect(result.dominantModel).toBe("signal_quality");
	});
});
