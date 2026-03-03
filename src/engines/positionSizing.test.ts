import { describe, expect, it } from "vitest";
import type { PositionSizingParams } from "./positionSizing.ts";
import { calculateKellyPositionSize } from "./positionSizing.ts";

function makeParams(overrides: Partial<PositionSizingParams> = {}): PositionSizingParams {
	return {
		winProbability: 0.6,
		avgWinPayout: 1,
		avgLossPayout: 1,
		bankroll: 1000,
		maxSize: 50,
		...overrides,
	};
}

describe("calculateKellyPositionSize", () => {
	describe("valid inputs", () => {
		it("should return a positive size for positive edge", () => {
			const result = calculateKellyPositionSize(makeParams());
			expect(result.size).toBeGreaterThan(0);
			expect(result.reason).toBe("kelly_sized");
		});

		it("should compute correct raw Kelly fraction", () => {
			// p=0.6, q=0.4, b=1 => rawKelly = (1*0.6 - 0.4)/1 = 0.2
			const result = calculateKellyPositionSize(makeParams());
			expect(result.rawKelly).toBeCloseTo(0.2, 10);
		});

		it("should apply half-Kelly by default", () => {
			const result = calculateKellyPositionSize(makeParams());
			// rawKelly=0.2, kellyFraction=0.5, confidence=0.5 => confidenceMultiplier=1.0
			// regimeMultiplier=1.0 (no regime)
			// adjustedKelly = 0.2 * 0.5 * 1.0 * 1.0 = 0.1
			expect(result.adjustedKelly).toBeCloseTo(0.1, 10);
		});

		it("should size = adjustedKelly * bankroll", () => {
			const result = calculateKellyPositionSize(makeParams({ bankroll: 500 }));
			// adjustedKelly=0.1, bankroll=500 => sizeRaw=50
			expect(result.size).toBeCloseTo(50, 10);
		});

		it("should clamp to maxSize", () => {
			const result = calculateKellyPositionSize(makeParams({ maxSize: 5 }));
			expect(result.size).toBeLessThanOrEqual(5);
		});

		it("should enforce minSize when size would be lower", () => {
			const result = calculateKellyPositionSize(makeParams({ bankroll: 2, maxSize: 10, minSize: 0.5 }));
			expect(result.size).toBeGreaterThanOrEqual(0.5);
		});

		it("should use default minSize of 0.5 when not provided", () => {
			const result = calculateKellyPositionSize(makeParams({ bankroll: 1 }));
			expect(result.size).toBeGreaterThanOrEqual(0.5);
		});

		it("should use custom kellyFraction", () => {
			const full = calculateKellyPositionSize(makeParams({ kellyFraction: 1.0 }));
			const quarter = calculateKellyPositionSize(makeParams({ kellyFraction: 0.25 }));
			expect(full.adjustedKelly).toBeGreaterThan(quarter.adjustedKelly);
		});
	});

	describe("confidence multiplier", () => {
		it("should boost size for high confidence >= 0.8", () => {
			const high = calculateKellyPositionSize(makeParams({ confidence: 0.85 }));
			const mid = calculateKellyPositionSize(makeParams({ confidence: 0.6 }));
			expect(high.adjustedKelly).toBeGreaterThan(mid.adjustedKelly);
		});

		it("should reduce size for low confidence < 0.5", () => {
			const low = calculateKellyPositionSize(makeParams({ confidence: 0.3 }));
			const mid = calculateKellyPositionSize(makeParams({ confidence: 0.6 }));
			expect(low.adjustedKelly).toBeLessThan(mid.adjustedKelly);
		});

		it("should use 1.0 multiplier for medium confidence", () => {
			const mid = calculateKellyPositionSize(makeParams({ confidence: 0.65 }));
			// rawKelly=0.2, kelly=0.5, conf=1.0, regime=1.0 => 0.1
			expect(mid.adjustedKelly).toBeCloseTo(0.1, 10);
		});
	});

	describe("regime multiplier", () => {
		it("should reduce size in CHOP regime", () => {
			const chop = calculateKellyPositionSize(makeParams({ regime: "CHOP" }));
			const range = calculateKellyPositionSize(makeParams({ regime: "RANGE" }));
			expect(chop.adjustedKelly).toBeLessThan(range.adjustedKelly);
		});

		it("should boost size for TREND_ALIGNED", () => {
			const aligned = calculateKellyPositionSize(makeParams({ regime: "TREND_ALIGNED" }));
			const range = calculateKellyPositionSize(makeParams({ regime: "RANGE" }));
			expect(aligned.adjustedKelly).toBeGreaterThan(range.adjustedKelly);
		});

		it("should reduce size for TREND_OPPOSED", () => {
			const opposed = calculateKellyPositionSize(makeParams({ regime: "TREND_OPPOSED" }));
			const range = calculateKellyPositionSize(makeParams({ regime: "RANGE" }));
			expect(opposed.adjustedKelly).toBeLessThan(range.adjustedKelly);
		});

		it("should align TREND_UP with UP side", () => {
			const aligned = calculateKellyPositionSize(makeParams({ regime: "TREND_UP", side: "UP" }));
			const opposed = calculateKellyPositionSize(makeParams({ regime: "TREND_UP", side: "DOWN" }));
			expect(aligned.adjustedKelly).toBeGreaterThan(opposed.adjustedKelly);
		});

		it("should align TREND_DOWN with DOWN side", () => {
			const aligned = calculateKellyPositionSize(makeParams({ regime: "TREND_DOWN", side: "DOWN" }));
			const opposed = calculateKellyPositionSize(makeParams({ regime: "TREND_DOWN", side: "UP" }));
			expect(aligned.adjustedKelly).toBeGreaterThan(opposed.adjustedKelly);
		});

		it("should use 1.0 multiplier when regime is null", () => {
			const noRegime = calculateKellyPositionSize(makeParams({ regime: null }));
			// rawKelly=0.2, kelly=0.5, conf=1.0, regime=1.0 => 0.1
			expect(noRegime.adjustedKelly).toBeCloseTo(0.1, 10);
		});
	});

	describe("invalid inputs", () => {
		it("should return size 0 with invalid_inputs when winProbability is NaN", () => {
			const result = calculateKellyPositionSize(makeParams({ winProbability: Number.NaN }));
			expect(result.size).toBe(0);
			expect(result.reason).toBe("invalid_inputs");
		});

		it("should return size 0 with invalid_inputs when avgWinPayout is 0", () => {
			const result = calculateKellyPositionSize(makeParams({ avgWinPayout: 0 }));
			expect(result.size).toBe(0);
			expect(result.reason).toBe("invalid_inputs");
		});

		it("should return size 0 with invalid_inputs when avgLossPayout is negative", () => {
			const result = calculateKellyPositionSize(makeParams({ avgLossPayout: -1 }));
			expect(result.size).toBe(0);
			expect(result.reason).toBe("invalid_inputs");
		});

		it("should return size 0 with invalid_inputs when avgWinPayout is Infinity", () => {
			const result = calculateKellyPositionSize(makeParams({ avgWinPayout: Number.POSITIVE_INFINITY }));
			expect(result.size).toBe(0);
			expect(result.reason).toBe("invalid_inputs");
		});
	});

	describe("negative edge", () => {
		it("should return size 0 with negative_edge when win probability is too low", () => {
			const result = calculateKellyPositionSize(makeParams({ winProbability: 0.3 }));
			expect(result.size).toBe(0);
			expect(result.reason).toBe("negative_edge");
			expect(result.rawKelly).toBeLessThan(0);
		});

		it("should return size 0 when edge is exactly zero", () => {
			// p=0.5, b=1 => rawKelly = (1*0.5-0.5)/1 = 0
			const result = calculateKellyPositionSize(makeParams({ winProbability: 0.5 }));
			expect(result.size).toBe(0);
			expect(result.reason).toBe("negative_edge");
		});
	});

	describe("bankroll risk cap", () => {
		it("should cap adjustedKelly at 0.25 (MAX_BANKROLL_RISK_PER_TRADE)", () => {
			// Use very high winProbability and full Kelly to try exceeding cap
			const result = calculateKellyPositionSize(
				makeParams({
					winProbability: 0.9,
					kellyFraction: 1.0,
					confidence: 0.9,
					regime: "TREND_ALIGNED",
				}),
			);
			expect(result.adjustedKelly).toBeLessThanOrEqual(0.25);
		});
	});

	describe("edge cases", () => {
		it("should handle zero bankroll", () => {
			const result = calculateKellyPositionSize(makeParams({ bankroll: 0 }));
			// sizeRaw = adjustedKelly * 0 = 0, clamped to minSize
			expect(result.size).toBe(0.5); // default minSize
		});

		it("should handle maxSize less than minSize by using minSize as maxSize", () => {
			const result = calculateKellyPositionSize(makeParams({ maxSize: 0.1, minSize: 0.5 }));
			expect(result.size).toBeLessThanOrEqual(0.5);
		});

		it("should handle non-finite maxSize", () => {
			const result = calculateKellyPositionSize(makeParams({ maxSize: Number.NaN }));
			// Falls back to minSize
			expect(Number.isFinite(result.size)).toBe(true);
		});

		it("should handle non-finite bankroll", () => {
			const result = calculateKellyPositionSize(makeParams({ bankroll: Number.NaN }));
			expect(Number.isFinite(result.size)).toBe(true);
		});

		it("should clamp winProbability above 1 to 1", () => {
			const result = calculateKellyPositionSize(makeParams({ winProbability: 1.5 }));
			expect(result.rawKelly).toBeGreaterThan(0);
			expect(result.reason).toBe("kelly_sized");
		});

		it("should clamp winProbability below 0 to 0", () => {
			const result = calculateKellyPositionSize(makeParams({ winProbability: -0.5 }));
			expect(result.reason).toBe("negative_edge");
		});
	});
});
