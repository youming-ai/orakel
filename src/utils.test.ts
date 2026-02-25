import { describe, expect, it } from "vitest";
import { clamp, estimatePolymarketFee, formatNumber, formatPct, getCandleWindowTiming, normalCDF } from "./utils.ts";

describe("clamp", () => {
	it("should return value when within range", () => {
		expect(clamp(5, 0, 10)).toBe(5);
	});

	it("should return min when value is below min", () => {
		expect(clamp(-1, 0, 10)).toBe(0);
	});

	it("should return max when value is above max", () => {
		expect(clamp(15, 0, 10)).toBe(10);
	});

	it("should return value at lower boundary", () => {
		expect(clamp(0, 0, 10)).toBe(0);
	});

	it("should return value at upper boundary", () => {
		expect(clamp(10, 0, 10)).toBe(10);
	});

	it("should handle negative range", () => {
		expect(clamp(-5, -10, -1)).toBe(-5);
	});

	it("should clamp negative value to negative min", () => {
		expect(clamp(-15, -10, -1)).toBe(-10);
	});

	it("should clamp negative value to negative max", () => {
		expect(clamp(5, -10, -1)).toBe(-1);
	});
});

describe("normalCDF", () => {
	it("should return ~0.5 at x=0", () => {
		const result = normalCDF(0);
		expect(result).toBeCloseTo(0.5, 4);
	});

	it("should return ~0.87 at x=1", () => {
		const result = normalCDF(1);
		expect(result).toBeCloseTo(0.8703, 3);
	});

	it("should return ~0.13 at x=-1", () => {
		const result = normalCDF(-1);
		expect(result).toBeCloseTo(0.1297, 3);
	});

	it("should return ~0.983 at x=2", () => {
		const result = normalCDF(2);
		expect(result).toBeCloseTo(0.9827, 3);
	});

	it("should return ~0.017 at x=-2", () => {
		const result = normalCDF(-2);
		expect(result).toBeCloseTo(0.0173, 3);
	});

	it("should approach 1.0 for large positive x", () => {
		const result = normalCDF(6);
		expect(result).toBeGreaterThan(0.999);
	});

	it("should approach 0.0 for large negative x", () => {
		const result = normalCDF(-6);
		expect(result).toBeLessThan(0.001);
	});

	it("should satisfy symmetry: CDF(-x) ≈ 1 - CDF(x)", () => {
		const x = 1.5;
		const cdfPos = normalCDF(x);
		const cdfNeg = normalCDF(-x);
		expect(cdfNeg).toBeCloseTo(1 - cdfPos, 4);
	});
});

describe("formatNumber", () => {
	it("should format with commas", () => {
		expect(formatNumber(1234, 0)).toBe("1,234");
	});

	it("should format with decimals", () => {
		expect(formatNumber(1234.567, 2)).toBe("1,234.57");
	});

	it("should return '-' for null", () => {
		expect(formatNumber(null, 0)).toBe("-");
	});

	it("should return '-' for undefined", () => {
		expect(formatNumber(undefined, 0)).toBe("-");
	});

	it("should return '-' for NaN", () => {
		expect(formatNumber(NaN, 0)).toBe("-");
	});

	it("should format zero", () => {
		expect(formatNumber(0, 0)).toBe("0");
	});

	it("should format with default digits=0", () => {
		expect(formatNumber(1234.567)).toBe("1,235");
	});

	it("should format small decimals", () => {
		expect(formatNumber(0.123, 3)).toBe("0.123");
	});

	it("should format negative numbers", () => {
		expect(formatNumber(-1234.5, 1)).toBe("-1,234.5");
	});
});

describe("formatPct", () => {
	it("should format 0.5 as 50.00%", () => {
		expect(formatPct(0.5)).toBe("50.00%");
	});

	it("should format with custom digits", () => {
		expect(formatPct(0.1234, 1)).toBe("12.3%");
	});

	it("should format negative percentage", () => {
		expect(formatPct(-0.05)).toBe("-5.00%");
	});

	it("should return '-' for null", () => {
		expect(formatPct(null)).toBe("-");
	});

	it("should return '-' for undefined", () => {
		expect(formatPct(undefined)).toBe("-");
	});

	it("should return '-' for NaN", () => {
		expect(formatPct(NaN)).toBe("-");
	});

	it("should format zero", () => {
		expect(formatPct(0)).toBe("0.00%");
	});

	it("should format with default digits=2", () => {
		expect(formatPct(0.12345)).toBe("12.35%");
	});
});

describe("getCandleWindowTiming", () => {
	it("should return all expected timing fields", () => {
		const result = getCandleWindowTiming(15);

		expect(result).toHaveProperty("startMs");
		expect(result).toHaveProperty("endMs");
		expect(result).toHaveProperty("elapsedMs");
		expect(result).toHaveProperty("remainingMs");
		expect(result).toHaveProperty("elapsedMinutes");
		expect(result).toHaveProperty("remainingMinutes");
	});

	it("should align 15-minute windows to exact boundaries", () => {
		const result = getCandleWindowTiming(15);
		const windowMs = 15 * 60_000;

		expect(result.startMs % windowMs).toBe(0);
		expect(result.endMs % windowMs).toBe(0);
		expect(result.endMs - result.startMs).toBe(windowMs);
	});

	it("should align 1-minute windows to exact boundaries", () => {
		const result = getCandleWindowTiming(1);
		const windowMs = 60_000;

		expect(result.startMs % windowMs).toBe(0);
		expect(result.endMs % windowMs).toBe(0);
		expect(result.endMs - result.startMs).toBe(windowMs);
	});

	it("should always have start before end", () => {
		const result = getCandleWindowTiming(15);
		expect(result.startMs).toBeLessThan(result.endMs);
	});

	it("should have elapsed and remaining adding up to window length", () => {
		const result = getCandleWindowTiming(15);
		expect(result.elapsedMs + result.remainingMs).toBeCloseTo(15 * 60_000, -2);
	});

	it("should never return negative elapsed time", () => {
		const result = getCandleWindowTiming(15);
		expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	it("should never return negative remaining time", () => {
		const result = getCandleWindowTiming(15);
		expect(result.remainingMs).toBeGreaterThanOrEqual(0);
	});

	it("should convert elapsed milliseconds to minutes consistently", () => {
		const result = getCandleWindowTiming(15);
		expect(result.elapsedMinutes).toBe(result.elapsedMs / 60_000);
	});

	it("should convert remaining milliseconds to minutes consistently", () => {
		const result = getCandleWindowTiming(15);
		expect(result.remainingMinutes).toBe(result.remainingMs / 60_000);
	});

	it("should ensure current time is inside [startMs, endMs)", () => {
		const result = getCandleWindowTiming(15);
		const nowMs = Date.now();

		expect(nowMs).toBeGreaterThanOrEqual(result.startMs);
		expect(nowMs).toBeLessThan(result.endMs);
	});

	it("should keep elapsed and remaining within valid bounds", () => {
		const result = getCandleWindowTiming(15);
		const windowMs = 15 * 60_000;

		expect(result.elapsedMs).toBeLessThan(windowMs);
		expect(result.remainingMs).toBeLessThanOrEqual(windowMs);
	});

	it("should produce correct window width for custom window sizes", () => {
		const cases = [2, 5, 7, 30];

		for (const minutes of cases) {
			const result = getCandleWindowTiming(minutes);
			expect(result.endMs - result.startMs).toBe(minutes * 60_000);
		}
	});
});

describe("estimatePolymarketFee", () => {
	it("returns 0 for price at boundary 0", () => {
		expect(estimatePolymarketFee(0)).toBe(0);
	});

	it("returns 0 for price at boundary 1", () => {
		expect(estimatePolymarketFee(1)).toBe(0);
	});

	it("computes taker fee at price 0.5 (max fee point)", () => {
		// 0.25 × (0.5 × 0.5)^2 = 0.25 × 0.0625 = 0.015625
		expect(estimatePolymarketFee(0.5)).toBeCloseTo(0.015625, 10);
	});

	it("computes maker fee with 20% rebate at price 0.5", () => {
		// 0.25 × (0.5 × 0.5)^2 × 0.8 = 0.0125
		expect(estimatePolymarketFee(0.5, 0.2)).toBeCloseTo(0.0125, 10);
	});

	it("computes fee at asymmetric price 0.8", () => {
		// 0.25 × (0.8 × 0.2)^2 = 0.25 × 0.0256 = 0.0064
		expect(estimatePolymarketFee(0.8)).toBeCloseTo(0.0064, 10);
	});

	it("computes fee at asymmetric price 0.2", () => {
		// Symmetric with price 0.8
		expect(estimatePolymarketFee(0.2)).toBeCloseTo(estimatePolymarketFee(0.8), 10);
	});

	it("fee is symmetric around 0.5", () => {
		expect(estimatePolymarketFee(0.3)).toBeCloseTo(estimatePolymarketFee(0.7), 10);
		expect(estimatePolymarketFee(0.1)).toBeCloseTo(estimatePolymarketFee(0.9), 10);
	});

	it("fee decreases as price moves away from 0.5", () => {
		expect(estimatePolymarketFee(0.5)).toBeGreaterThan(estimatePolymarketFee(0.6));
		expect(estimatePolymarketFee(0.6)).toBeGreaterThan(estimatePolymarketFee(0.7));
		expect(estimatePolymarketFee(0.7)).toBeGreaterThan(estimatePolymarketFee(0.8));
	});

	it("returns 0 for negative prices", () => {
		expect(estimatePolymarketFee(-0.1)).toBe(0);
	});
});
