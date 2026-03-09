import { describe, expect, it } from "vitest";
import type { RiskConfig } from "../core/configTypes.ts";
import { computeKellySize } from "../trading/executionService.ts";

function makeRisk(overrides: Partial<RiskConfig> = {}): RiskConfig {
	return {
		maxTradeSizeUsdc: 10,
		limitDiscount: 0.04,
		dailyMaxLossUsdc: 100,
		maxOpenPositions: 2,
		minLiquidity: 5000,
		maxTradesPerWindow: 2,
		useKellySizing: true,
		kellyFraction: 0.25,
		kellyMinSize: 1,
		...overrides,
	};
}

describe("computeKellySize", () => {
	it("returns null when Kelly sizing is disabled", () => {
		expect(computeKellySize(0.6, 0.5, 1000, makeRisk({ useKellySizing: false }))).toBeNull();
	});

	it("returns null for invalid entry prices", () => {
		expect(computeKellySize(0.6, 0, 1000, makeRisk())).toBeNull();
		expect(computeKellySize(0.6, 1, 1000, makeRisk())).toBeNull();
		expect(computeKellySize(0.6, -0.1, 1000, makeRisk())).toBeNull();
		expect(computeKellySize(0.6, 1.5, 1000, makeRisk())).toBeNull();
	});

	it("returns null for non-finite modelProb", () => {
		expect(computeKellySize(NaN, 0.5, 1000, makeRisk())).toBeNull();
		expect(computeKellySize(Infinity, 0.5, 1000, makeRisk())).toBeNull();
	});

	it("returns 0 (skip) when modelProb <= entryPrice (negative EV)", () => {
		expect(computeKellySize(0.4, 0.5, 1000, makeRisk())).toBe(0);
		expect(computeKellySize(0.5, 0.5, 1000, makeRisk())).toBe(0);
	});

	it("computes correct Kelly size based on balance", () => {
		// modelProb=0.6, price=0.46, balance=1000, fraction=0.25
		// kellyFull = (0.6 - 0.46) / (1 - 0.46) = 0.14/0.54 ≈ 0.2593
		// kellyAdjusted = 0.2593 * 0.25 ≈ 0.0648
		// dollarRisk = 1000 * 0.0648 = 64.8
		// tokens = 64.8 / 0.46 ≈ 140.9
		// capped at maxTradeSizeUsdc = 10
		const result = computeKellySize(0.6, 0.46, 1000, makeRisk());
		expect(result).toBe(10);
	});

	it("returns tokens uncapped when below maxTradeSizeUsdc", () => {
		// modelProb=0.52, price=0.46, balance=50, fraction=0.25
		// kellyFull = (0.52 - 0.46) / (1 - 0.46) = 0.06/0.54 ≈ 0.1111
		// kellyAdjusted = 0.1111 * 0.25 ≈ 0.0278
		// dollarRisk = 50 * 0.0278 = 1.389
		// tokens = 1.389 / 0.46 ≈ 3.02
		const result = computeKellySize(0.52, 0.46, 50, makeRisk());
		expect(result).not.toBeNull();
		expect(result as number).toBeGreaterThan(1);
		expect(result as number).toBeLessThan(10);
	});

	it("returns minSize when Kelly tokens are below minSize but EV is positive", () => {
		// Very small balance → tiny Kelly → below minSize → floor to minSize
		// modelProb=0.52, price=0.46, balance=5, fraction=0.25
		// kellyFull ≈ 0.1111, adjusted ≈ 0.0278
		// dollarRisk = 5 * 0.0278 = 0.139
		// tokens = 0.139 / 0.46 ≈ 0.30 < minSize(1) → return minSize(1)
		expect(computeKellySize(0.52, 0.46, 5, makeRisk())).toBe(1);
	});

	it("scales position size with balance", () => {
		const risk = makeRisk({ maxTradeSizeUsdc: 100 });
		const small = computeKellySize(0.6, 0.46, 100, risk);
		const large = computeKellySize(0.6, 0.46, 1000, risk);
		expect(small).not.toBeNull();
		expect(large).not.toBeNull();
		// Larger balance should give larger (or equal if capped) position
		expect(large as number).toBeGreaterThanOrEqual(small as number);
	});

	it("scales position size with edge strength", () => {
		const weakEdge = computeKellySize(0.52, 0.46, 1000, makeRisk({ maxTradeSizeUsdc: 100 }));
		const strongEdge = computeKellySize(0.7, 0.46, 1000, makeRisk({ maxTradeSizeUsdc: 100 }));
		expect(weakEdge).not.toBeNull();
		expect(strongEdge).not.toBeNull();
		expect(strongEdge as number).toBeGreaterThan(weakEdge as number);
	});

	it("respects kellyFraction parameter", () => {
		const quarter = computeKellySize(0.6, 0.46, 1000, makeRisk({ kellyFraction: 0.25, maxTradeSizeUsdc: 200 }));
		const tenth = computeKellySize(0.6, 0.46, 1000, makeRisk({ kellyFraction: 0.1, maxTradeSizeUsdc: 200 }));
		expect(quarter).not.toBeNull();
		expect(tenth).not.toBeNull();
		// quarter Kelly should be larger than tenth Kelly
		expect(quarter as number).toBeGreaterThan(tenth as number);
	});
});
