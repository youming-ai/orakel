import { describe, expect, it } from "vitest";
import { optimizeBuyPrice, selectOrderStrategy } from "../engines/feeOptimization.ts";
import type { Phase } from "../types.ts";

describe("selectOrderStrategy", () => {
	it("should return FOK for LATE phase with high confidence", () => {
		const result = selectOrderStrategy("LATE", 0.8, 0.55, 0.45);
		expect(result.strategy).toBe("FOK");
		expect(result.reason).toBe("late_phase_high_confidence_immediate_fill");
	});

	it("should return GTD_POST_ONLY for LATE phase with low confidence", () => {
		const result = selectOrderStrategy("LATE", 0.5, 0.55, 0.45);
		expect(result.strategy).toBe("GTD_POST_ONLY");
		expect(result.reason).toBe("non_urgent_capture_maker_rebate");
	});

	it("should return GTD_POST_ONLY for EARLY phase regardless of confidence", () => {
		const result = selectOrderStrategy("EARLY", 0.95, 0.6, 0.4);
		expect(result.strategy).toBe("GTD_POST_ONLY");
		expect(result.reason).toBe("non_urgent_capture_maker_rebate");
	});

	it("should return GTD_POST_ONLY for MID phase regardless of confidence", () => {
		const result = selectOrderStrategy("MID", 0.9, 0.55, 0.45);
		expect(result.strategy).toBe("GTD_POST_ONLY");
		expect(result.reason).toBe("non_urgent_capture_maker_rebate");
	});

	it("should return FOK at exact threshold boundary", () => {
		const result = selectOrderStrategy("LATE", 0.7, 0.5, 0.5);
		expect(result.strategy).toBe("FOK");
	});

	it("should return GTD_POST_ONLY just below threshold", () => {
		const result = selectOrderStrategy("LATE", 0.699, 0.5, 0.5);
		expect(result.strategy).toBe("GTD_POST_ONLY");
	});

	it("should use custom fokConfidenceThreshold when provided", () => {
		const result = selectOrderStrategy("LATE", 0.6, 0.55, 0.45, 0.5);
		expect(result.strategy).toBe("FOK");
	});

	it("should set maker rebate to 0.2 for GTD_POST_ONLY", () => {
		const result = selectOrderStrategy("EARLY", 0.5, 0.6, 0.4);
		expect(result.makerRebate).toBe(0.2);
	});

	it("should set maker rebate to 0 for FOK (taker)", () => {
		const result = selectOrderStrategy("LATE", 0.8, 0.6, 0.4);
		expect(result.makerRebate).toBe(0);
	});

	it("should compute expectedFeeRate as a non-negative number", () => {
		const result = selectOrderStrategy("EARLY", 0.5, 0.6, 0.4);
		expect(result.expectedFeeRate).toBeGreaterThanOrEqual(0);
		expect(Number.isFinite(result.expectedFeeRate)).toBe(true);
	});

	it("should produce higher fee for FOK than GTD_POST_ONLY with same prices", () => {
		const fokResult = selectOrderStrategy("LATE", 0.8, 0.55, 0.45);
		const gtdResult = selectOrderStrategy("EARLY", 0.5, 0.55, 0.45);
		expect(fokResult.expectedFeeRate).toBeGreaterThan(gtdResult.expectedFeeRate);
	});

	it.each<Phase>(["EARLY", "MID", "LATE"])("should handle phase %s without throwing", (phase) => {
		const result = selectOrderStrategy(phase, 0.5, 0.5, 0.5);
		expect(result.strategy).toBeDefined();
		expect(result.reason).toBeDefined();
	});

	it("should use max of marketUp/marketDown as reference price", () => {
		const resultUpHigher = selectOrderStrategy("EARLY", 0.5, 0.7, 0.3);
		const resultDownHigher = selectOrderStrategy("EARLY", 0.5, 0.3, 0.7);
		// Both should use 0.7 as reference, so fee should be the same
		expect(resultUpHigher.expectedFeeRate).toBeCloseTo(resultDownHigher.expectedFeeRate, 10);
	});
});

describe("optimizeBuyPrice", () => {
	it("should return market price for FOK strategy", () => {
		const result = optimizeBuyPrice(0.55, "UP", 0.05, "FOK");
		expect(result.buyPrice).toBe(0.55);
		expect(result.priceImprovement).toBe(0);
		expect(result.reason).toContain("fok");
	});

	it("should apply limit discount for GTD_POST_ONLY strategy", () => {
		const result = optimizeBuyPrice(0.6, "UP", 0.05, "GTD_POST_ONLY");
		expect(result.buyPrice).toBeCloseTo(0.6 * 0.95, 10);
		expect(result.priceImprovement).toBeCloseTo(0.6 * 0.05, 10);
		expect(result.reason).toContain("gtd_post_only");
	});

	it("should include side in FOK reason", () => {
		const upResult = optimizeBuyPrice(0.5, "UP", 0.05, "FOK");
		expect(upResult.reason).toContain("up");

		const downResult = optimizeBuyPrice(0.5, "DOWN", 0.05, "FOK");
		expect(downResult.reason).toContain("down");
	});

	it("should include side in GTD reason", () => {
		const upResult = optimizeBuyPrice(0.5, "UP", 0.05, "GTD_POST_ONLY");
		expect(upResult.reason).toContain("up");

		const downResult = optimizeBuyPrice(0.5, "DOWN", 0.05, "GTD_POST_ONLY");
		expect(downResult.reason).toContain("down");
	});

	it("should return zero price improvement for FOK regardless of discount", () => {
		const result = optimizeBuyPrice(0.7, "UP", 0.1, "FOK");
		expect(result.priceImprovement).toBe(0);
	});

	it("should compute price improvement as marketPrice - buyPrice for GTD", () => {
		const marketPrice = 0.65;
		const discount = 0.04;
		const result = optimizeBuyPrice(marketPrice, "DOWN", discount, "GTD_POST_ONLY");
		const expectedBuy = marketPrice * (1 - discount);
		expect(result.buyPrice).toBeCloseTo(expectedBuy, 10);
		expect(result.priceImprovement).toBeCloseTo(marketPrice - expectedBuy, 10);
	});

	it("should handle zero discount for GTD_POST_ONLY", () => {
		const result = optimizeBuyPrice(0.5, "UP", 0, "GTD_POST_ONLY");
		expect(result.buyPrice).toBe(0.5);
		expect(result.priceImprovement).toBe(0);
	});
});
