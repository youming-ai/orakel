import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBinaryPnl } from "./pnl.ts";

describe("computeBinaryPnl", () => {
	it("should compute correct PnL for winning trade at price 0.5", () => {
		const pnl = computeBinaryPnl(100, 0.5, true);
		expect(pnl).toBe(100);
	});

	it("should compute correct PnL for winning trade at price 0.6", () => {
		const pnl = computeBinaryPnl(100, 0.6, true);
		expect(pnl).toBeCloseTo(66.67, 2);
	});

	it("should return negative size for losing trade", () => {
		const pnl = computeBinaryPnl(100, 0.5, false);
		expect(pnl).toBe(-100);
	});

	it("should return size when price is 0 (guard case)", () => {
		const pnl = computeBinaryPnl(100, 0, true);
		expect(pnl).toBe(100);
	});

	it("should return negative size when price is 0 and lost", () => {
		const pnl = computeBinaryPnl(100, 0, false);
		expect(pnl).toBe(-100);
	});

	it("should return size when price is 1 (guard case)", () => {
		const pnl = computeBinaryPnl(100, 1, true);
		expect(pnl).toBe(100);
	});

	it("should return negative size when price is 1 and lost", () => {
		const pnl = computeBinaryPnl(100, 1, false);
		expect(pnl).toBe(-100);
	});

	it("should handle very small prices", () => {
		const pnl = computeBinaryPnl(100, 0.01, true);
		expect(pnl).toBe(9900);
	});

	it("should handle prices close to 1", () => {
		const pnl = computeBinaryPnl(100, 0.99, true);
		expect(pnl).toBeCloseTo(1.01, 2);
	});

	it("should handle negative price as guard case", () => {
		const pnl = computeBinaryPnl(100, -0.1, true);
		expect(pnl).toBe(100);
	});

	it("should handle price > 1 as guard case", () => {
		const pnl = computeBinaryPnl(100, 1.5, true);
		expect(pnl).toBe(100);
	});

	it("should handle zero size", () => {
		const pnl = computeBinaryPnl(0, 0.5, true);
		expect(pnl).toBe(0);
	});
});
