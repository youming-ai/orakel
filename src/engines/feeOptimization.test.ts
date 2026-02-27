import { describe, expect, it } from "vitest";
import { estimatePolymarketFee } from "../utils.ts";
import { optimizeBuyPrice, selectOrderStrategy } from "./feeOptimization.ts";

describe("selectOrderStrategy", () => {
	it("selects FOK in LATE phase at confidence boundary 0.7", () => {
		const result = selectOrderStrategy("LATE", 0.7, 0.61, 0.39);

		expect(result.strategy).toBe("FOK");
		expect(result.makerRebate).toBe(0);
		expect(result.reason).toBe("late_phase_high_confidence_immediate_fill");
	});

	it("selects FOK in LATE phase above confidence threshold", () => {
		const result = selectOrderStrategy("LATE", 0.9, 0.55, 0.45);

		expect(result.strategy).toBe("FOK");
		expect(result.makerRebate).toBe(0);
	});

	it("selects GTD_POST_ONLY in LATE phase below confidence threshold", () => {
		const result = selectOrderStrategy("LATE", 0.6999, 0.55, 0.45);

		expect(result.strategy).toBe("GTD_POST_ONLY");
		expect(result.makerRebate).toBe(0.2);
		expect(result.reason).toBe("non_urgent_capture_maker_rebate");
	});

	it.each(["EARLY", "MID"] as const)("uses GTD_POST_ONLY in %s phase regardless of confidence", (phase) => {
		const result = selectOrderStrategy(phase, 0.99, 0.58, 0.42);

		expect(result.strategy).toBe("GTD_POST_ONLY");
		expect(result.makerRebate).toBe(0.2);
	});

	it("uses the higher side price for expected fee estimate", () => {
		const result = selectOrderStrategy("MID", 0.6, 0.32, 0.68);

		expect(result.expectedFeeRate).toBeCloseTo(estimatePolymarketFee(0.68, 0.2), 12);
	});

	it("applies taker fee formula when selecting FOK", () => {
		const result = selectOrderStrategy("LATE", 0.75, 0.63, 0.37);

		expect(result.expectedFeeRate).toBeCloseTo(estimatePolymarketFee(0.63, 0), 12);
	});

	it("applies maker rebate fee formula when selecting GTD_POST_ONLY", () => {
		const result = selectOrderStrategy("EARLY", 0.75, 0.63, 0.37);

		expect(result.expectedFeeRate).toBeCloseTo(estimatePolymarketFee(0.63, 0.2), 12);
	});

	it("returns lower expected fee for maker-rebate strategy at same price", () => {
		const fok = selectOrderStrategy("LATE", 0.8, 0.57, 0.43);
		const gtd = selectOrderStrategy("MID", 0.8, 0.57, 0.43);

		expect(gtd.expectedFeeRate).toBeLessThan(fok.expectedFeeRate);
	});

	it.each([
		{ marketUp: 0, marketDown: 0 },
		{ marketUp: 1, marketDown: 0.4 },
		{ marketUp: 0.6, marketDown: 1 },
	])("returns zero expected fee at extreme boundary prices %#", ({ marketUp, marketDown }) => {
		const result = selectOrderStrategy("EARLY", 0.5, marketUp, marketDown);

		expect(result.expectedFeeRate).toBe(0);
	});

	it("produces deterministic output for identical inputs", () => {
		const first = selectOrderStrategy("MID", 0.55, 0.51, 0.49);
		const second = selectOrderStrategy("MID", 0.55, 0.51, 0.49);

		expect(second).toEqual(first);
	});
});

describe("optimizeBuyPrice", () => {
	it.each(["UP", "DOWN"] as const)("keeps market price for %s with FOK", (side) => {
		const result = optimizeBuyPrice(0.56, side, 0.05, "FOK");

		expect(result.buyPrice).toBe(0.56);
		expect(result.priceImprovement).toBe(0);
		expect(result.reason).toContain("fok");
	});

	it.each(["UP", "DOWN"] as const)("applies limit discount for %s with GTD_POST_ONLY", (side) => {
		const result = optimizeBuyPrice(0.6, side, 0.05, "GTD_POST_ONLY");

		expect(result.buyPrice).toBeCloseTo(0.57, 12);
		expect(result.priceImprovement).toBeCloseTo(0.03, 12);
		expect(result.reason).toContain("gtd_post_only");
	});

	it("returns zero improvement for GTD_POST_ONLY when discount is zero", () => {
		const result = optimizeBuyPrice(0.42, "UP", 0, "GTD_POST_ONLY");

		expect(result.buyPrice).toBe(0.42);
		expect(result.priceImprovement).toBe(0);
	});

	it("handles full discount by returning zero buy price", () => {
		const result = optimizeBuyPrice(0.42, "DOWN", 1, "GTD_POST_ONLY");

		expect(result.buyPrice).toBe(0);
		expect(result.priceImprovement).toBe(0.42);
	});

	it("passes through zero market price correctly", () => {
		const result = optimizeBuyPrice(0, "UP", 0.05, "GTD_POST_ONLY");

		expect(result.buyPrice).toBe(0);
		expect(result.priceImprovement).toBe(0);
	});

	it("increases buy price for negative discount inputs", () => {
		const result = optimizeBuyPrice(0.5, "DOWN", -0.1, "GTD_POST_ONLY");

		expect(result.buyPrice).toBeCloseTo(0.55, 12);
		expect(result.priceImprovement).toBeCloseTo(-0.05, 12);
	});

	it("keeps price improvement consistent with market-buy delta", () => {
		const result = optimizeBuyPrice(0.73, "UP", 0.08, "GTD_POST_ONLY");

		expect(result.priceImprovement).toBeCloseTo(0.73 - result.buyPrice, 12);
	});

	it("returns side-specific reason for UP", () => {
		const result = optimizeBuyPrice(0.7, "UP", 0.05, "GTD_POST_ONLY");

		expect(result.reason.startsWith("up_")).toBe(true);
	});

	it("returns side-specific reason for DOWN", () => {
		const result = optimizeBuyPrice(0.7, "DOWN", 0.05, "GTD_POST_ONLY");

		expect(result.reason.startsWith("down_")).toBe(true);
	});

	it("returns exact market price for FOK even with non-zero discount input", () => {
		const result = optimizeBuyPrice(0.66, "UP", 0.2, "FOK");

		expect(result.buyPrice).toBe(0.66);
		expect(result.priceImprovement).toBe(0);
	});

	it("is deterministic for identical GTD inputs", () => {
		const first = optimizeBuyPrice(0.64, "DOWN", 0.04, "GTD_POST_ONLY");
		const second = optimizeBuyPrice(0.64, "DOWN", 0.04, "GTD_POST_ONLY");

		expect(second).toEqual(first);
	});
});
