import { describe, expect, it } from "vitest";
import { detectArbitrage } from "./arbitrage.ts";
import { computeEdge } from "./edge.ts";

describe("detectArbitrage", () => {
	it("detects BUY_UP when Polymarket UP is underpriced", () => {
		const result = detectArbitrage("BTC", 0.45, 0.55, 0.52, 0.02);

		expect(result?.direction).toBe("BUY_UP");
		expect(result?.spread).toBeCloseTo(0.07, 10);
		expect(result?.polymarketPrice).toBe(0.45);
		expect(result?.binancePrice).toBe(0.52);
	});

	it("detects BUY_DOWN when Polymarket DOWN is underpriced", () => {
		const result = detectArbitrage("ETH", 0.72, 0.2, 0.7, 0.02);

		expect(result?.direction).toBe("BUY_DOWN");
		expect(result?.spread).toBeCloseTo(0.1, 10);
		expect(result?.polymarketPrice).toBe(0.2);
		expect(result?.binancePrice).toBeCloseTo(0.3, 10);
	});

	it("returns null when spread is too small for BUY_UP", () => {
		const result = detectArbitrage("SOL", 0.495, 0.505, 0.51, 0.02);

		expect(result).toBeNull();
	});

	it("returns null when spread is too small for BUY_DOWN", () => {
		const result = detectArbitrage("SOL", 0.54, 0.49, 0.53, 0.02);

		expect(result).toBeNull();
	});

	it("returns null when prices are non-finite", () => {
		expect(detectArbitrage("BTC", Number.NaN, 0.5, 0.5, 0.02)).toBeNull();
		expect(detectArbitrage("BTC", 0.5, Number.POSITIVE_INFINITY, 0.5, 0.02)).toBeNull();
		expect(detectArbitrage("BTC", 0.5, 0.5, Number.NEGATIVE_INFINITY, 0.02)).toBeNull();
	});

	it("normalizes out-of-range values before detection", () => {
		const result = detectArbitrage("XRP", -0.5, 1.2, 1.4, 0.02);

		expect(result?.direction).toBe("BUY_UP");
		expect(result?.polymarketPrice).toBe(0);
		expect(result?.binancePrice).toBe(1);
		expect(result?.spread).toBe(1);
	});

	it("uses absolute spread in returned payload", () => {
		const result = detectArbitrage("BTC", 0.35, 0.65, 0.58, 0.02);

		expect(result?.spread).toBeCloseTo(Math.abs(0.58 - 0.35), 10);
	});

	it("chooses BUY_UP when both sides qualify and UP spread is larger", () => {
		const result = detectArbitrage("BTC", 0.35, 0.44, 0.6, 0.02);

		expect(result?.direction).toBe("BUY_UP");
		expect(result?.spread).toBeCloseTo(0.25, 10);
	});

	it("chooses BUY_DOWN when both sides qualify and DOWN spread is larger", () => {
		const result = detectArbitrage("BTC", 0.52, 0.15, 0.6, 0.02);

		expect(result?.direction).toBe("BUY_DOWN");
		expect(result?.spread).toBeCloseTo(0.25, 10);
	});

	it("prefers BUY_UP on equal spreads", () => {
		const result = detectArbitrage("BTC", 0.35, 0.25, 0.55, 0.02);

		expect(result?.direction).toBe("BUY_UP");
	});

	it("handles zero minSpread by still requiring underpricing condition", () => {
		expect(detectArbitrage("BTC", 0.5, 0.5, 0.5, 0)).toBeNull();

		const result = detectArbitrage("BTC", 0.49, 0.51, 0.5, 0);
		expect(result?.direction).toBe("BUY_UP");
	});

	it("computes confidence baseline at threshold spread", () => {
		const result = detectArbitrage("ETH", 0.479, 0.521, 0.5, 0.02);

		expect(result?.spread).toBeCloseTo(0.021, 10);
		expect(result?.confidence).toBeCloseTo(0.525, 10);
	});

	it("caps confidence at 1 for large spread", () => {
		const result = detectArbitrage("ETH", 0.2, 0.8, 0.8, 0.02);

		expect(result?.confidence).toBe(1);
	});

	it("returns a timestamp in epoch milliseconds", () => {
		const before = Date.now();
		const result = detectArbitrage("SOL", 0.45, 0.55, 0.5, 0.02);
		const after = Date.now();

		expect(result).not.toBeNull();
		expect((result as { timestamp: number }).timestamp).toBeGreaterThanOrEqual(before);
		expect((result as { timestamp: number }).timestamp).toBeLessThanOrEqual(after);
	});
});

describe("arbitrage integration in computeEdge", () => {
	it("does not detect arbitrage when binanceChainlinkDelta is missing", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 0.55,
			marketNo: 0.45,
			binanceChainlinkDelta: null,
		});

		expect(result.arbitrageDetected).toBe(false);
	});

	it("sets arbitrageDetected when cross-exchange spread qualifies", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 0.44,
			marketNo: 0.56,
			binanceChainlinkDelta: 0.03,
		});

		expect(result.arbitrageDetected).toBe(true);
	});

	it("boosts effective UP edge when BUY_UP arbitrage is detected", () => {
		const baseline = computeEdge({
			modelUp: 0.62,
			modelDown: 0.38,
			marketYes: 0.45,
			marketNo: 0.55,
			binanceChainlinkDelta: null,
		});
		const withArb = computeEdge({
			modelUp: 0.62,
			modelDown: 0.38,
			marketYes: 0.45,
			marketNo: 0.55,
			binanceChainlinkDelta: 0.03,
		});

		expect(withArb.arbitrageDetected).toBe(true);
		expect((withArb.effectiveEdgeUp as number) - (baseline.effectiveEdgeUp as number)).toBeGreaterThan(0);
		expect(withArb.effectiveEdgeDown).toBeCloseTo(baseline.effectiveEdgeDown as number, 10);
	});

	it("boosts effective DOWN edge when BUY_DOWN arbitrage is detected", () => {
		const baseline = computeEdge({
			modelUp: 0.4,
			modelDown: 0.6,
			marketYes: 0.7,
			marketNo: 0.3,
			binanceChainlinkDelta: null,
		});
		const withArb = computeEdge({
			modelUp: 0.4,
			modelDown: 0.6,
			marketYes: 0.7,
			marketNo: 0.3,
			binanceChainlinkDelta: -0.2,
		});

		expect(withArb.arbitrageDetected).toBe(true);
		expect((withArb.effectiveEdgeDown as number) - (baseline.effectiveEdgeDown as number)).toBeGreaterThan(0);
		expect(withArb.effectiveEdgeUp).toBeCloseTo(baseline.effectiveEdgeUp as number, 10);
	});

	it("keeps edge unchanged when spread does not meet threshold", () => {
		const baseline = computeEdge({
			modelUp: 0.55,
			modelDown: 0.45,
			marketYes: 0.5,
			marketNo: 0.5,
			binanceChainlinkDelta: null,
		});
		const withSmallDelta = computeEdge({
			modelUp: 0.55,
			modelDown: 0.45,
			marketYes: 0.5,
			marketNo: 0.5,
			binanceChainlinkDelta: 0.001,
		});

		expect(withSmallDelta.arbitrageDetected).toBe(false);
		expect(withSmallDelta.effectiveEdgeUp).toBeCloseTo(baseline.effectiveEdgeUp as number, 10);
		expect(withSmallDelta.effectiveEdgeDown).toBeCloseTo(baseline.effectiveEdgeDown as number, 10);
	});

	it("handles extreme delta values by clamping implied Binance probability", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 0,
			marketNo: 1,
			binanceChainlinkDelta: 999,
		});

		expect(result.arbitrageDetected).toBe(true);
		expect(result.effectiveEdgeUp).not.toBeNull();
	});

	it("returns arbitrageDetected false when market prices are missing", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: null,
			marketNo: 0.5,
			binanceChainlinkDelta: 0.05,
		});

		expect(result.arbitrageDetected).toBe(false);
	});

	it("sets top-level arbitrage true when cross-exchange arbitrage is detected", () => {
		const result = computeEdge({
			modelUp: 0.62,
			modelDown: 0.38,
			marketYes: 0.45,
			marketNo: 0.55,
			binanceChainlinkDelta: 0.03,
		});

		expect(result.arbitrageDetected).toBe(true);
		expect(result.arbitrage).toBe(true);
	});
});
