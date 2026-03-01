import { beforeEach, describe, expect, it } from "vitest";
import { CONFIG } from "../config.ts";
import type { StrategyConfig } from "../types.ts";
import { computeConfidence, computeEdge, decide } from "./edge.ts";

function makeStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
	return {
		edgeThresholdEarly: 0.08,
		edgeThresholdMid: 0.1,
		edgeThresholdLate: 0.12,
		minProbEarly: 0.58,
		minProbMid: 0.6,
		minProbLate: 0.7,
		blendWeights: { vol: 0.5, ta: 0.5 },
		regimeMultipliers: {
			CHOP: 2.0,
			RANGE: 1.0,
			TREND_ALIGNED: 0.9,
			TREND_OPPOSED: 1.4,
		},
		...overrides,
	};
}

describe("computeConfidence", () => {
	it("returns full indicator alignment for fully aligned UP indicators", () => {
		const result = computeConfidence({
			modelUp: 0.72,
			modelDown: 0.28,
			regime: "TREND_UP",
			volatility15m: 0.005,
			orderbookImbalance: 0.4,
			vwapSlope: 1,
			rsi: 60,
			macdHist: 0.3,
			haColor: "green",
			side: "UP",
		});

		expect(result.factors.indicatorAlignment).toBe(1);
	});

	it("uses optimal volatility score in 0.3%-0.8% range", () => {
		const result = computeConfidence({
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			volatility15m: 0.006,
			orderbookImbalance: null,
			vwapSlope: 0,
			rsi: 50,
			macdHist: 0,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.volatilityScore).toBe(1);
	});

	it("uses low volatility penalty below 0.2%", () => {
		const result = computeConfidence({
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			volatility15m: 0.001,
			orderbookImbalance: null,
			vwapSlope: 0,
			rsi: 50,
			macdHist: 0,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.volatilityScore).toBe(0.3);
	});

	it("uses high volatility penalty above 1%", () => {
		const result = computeConfidence({
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			volatility15m: 0.02,
			orderbookImbalance: null,
			vwapSlope: 0,
			rsi: 50,
			macdHist: 0,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.volatilityScore).toBe(0.4);
	});

	it("scores orderbook highly when it supports side", () => {
		const result = computeConfidence({
			modelUp: 0.62,
			modelDown: 0.38,
			regime: "RANGE",
			volatility15m: 0.005,
			orderbookImbalance: 0.7,
			vwapSlope: 0,
			rsi: 50,
			macdHist: 0,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.orderbookScore).toBeGreaterThanOrEqual(0.8);
	});

	it("scores orderbook at 0.3 when it opposes side", () => {
		const result = computeConfidence({
			modelUp: 0.62,
			modelDown: 0.38,
			regime: "RANGE",
			volatility15m: 0.005,
			orderbookImbalance: -0.7,
			vwapSlope: 0,
			rsi: 50,
			macdHist: 0,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.orderbookScore).toBe(0.3);
	});

	it("sets timing score to 1.0 when model prob is at least 0.7", () => {
		const result = computeConfidence({
			modelUp: 0.7,
			modelDown: 0.3,
			regime: "RANGE",
			volatility15m: null,
			orderbookImbalance: null,
			vwapSlope: null,
			rsi: null,
			macdHist: null,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.timingScore).toBe(1);
	});

	it("sets regime score to 1.0 when trend aligns", () => {
		const result = computeConfidence({
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "TREND_UP",
			volatility15m: null,
			orderbookImbalance: null,
			vwapSlope: null,
			rsi: null,
			macdHist: null,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.regimeScore).toBe(1);
	});

	it("sets regime score to 0.2 in CHOP", () => {
		const result = computeConfidence({
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "CHOP",
			volatility15m: null,
			orderbookImbalance: null,
			vwapSlope: null,
			rsi: null,
			macdHist: null,
			haColor: null,
			side: "UP",
		});

		expect(result.factors.regimeScore).toBe(0.2);
	});

	it("classifies level as HIGH when score >= 0.7", () => {
		const result = computeConfidence({
			modelUp: 0.9,
			modelDown: 0.1,
			regime: "TREND_UP",
			volatility15m: 0.005,
			orderbookImbalance: 0.8,
			vwapSlope: 1,
			rsi: 60,
			macdHist: 0.5,
			haColor: "green",
			side: "UP",
		});

		expect(result.level).toBe("HIGH");
	});

	it("classifies level as MEDIUM when score is between 0.5 and 0.7", () => {
		const result = computeConfidence({
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			volatility15m: null,
			orderbookImbalance: null,
			vwapSlope: 0.1,
			rsi: 55,
			macdHist: -0.1,
			haColor: null,
			side: "UP",
		});

		expect(result.level).toBe("MEDIUM");
	});

	it("classifies level as LOW when score < 0.5", () => {
		const result = computeConfidence({
			modelUp: 0.51,
			modelDown: 0.49,
			regime: "CHOP",
			volatility15m: 0.001,
			orderbookImbalance: -0.8,
			vwapSlope: -1,
			rsi: 85,
			macdHist: -0.2,
			haColor: "red",
			side: "UP",
		});

		expect(result.level).toBe("LOW");
	});
});

describe("computeEdge", () => {
	it("returns null edges when market prices are missing", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: null,
			marketNo: 0.5,
		});

		expect(result.marketUp).toBeNull();
		expect(result.edgeUp).toBeNull();
		expect(result.rawSum).toBeNull();
	});

	it("computes base edges from model and market probabilities", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 0.5,
			marketNo: 0.5,
		});

		expect(result.edgeUp).toBeCloseTo(0.1, 10);
		expect(result.edgeDown).toBeCloseTo(-0.1, 10);
	});

	it("marks arbitrage when rawSum is below 0.98", () => {
		const result = computeEdge({
			modelUp: 0.55,
			modelDown: 0.45,
			marketYes: 0.48,
			marketNo: 0.49,
		});

		expect(result.rawSum).toBeCloseTo(0.97, 10);
		expect(result.arbitrage).toBe(true);
	});

	it("marks overpriced when rawSum is above 1.04", () => {
		const result = computeEdge({
			modelUp: 0.55,
			modelDown: 0.45,
			marketYes: 0.53,
			marketNo: 0.52,
		});

		expect(result.overpriced).toBe(true);
	});

	it("marks vigTooHigh when rawSum is above 1.04", () => {
		const result = computeEdge({
			modelUp: 0.55,
			modelDown: 0.45,
			marketYes: 0.54,
			marketNo: 0.53,
		});

		expect(result.vigTooHigh).toBe(true);
	});

	it("reduces effective UP edge on strong positive imbalance", () => {
		const result = computeEdge({
			modelUp: 0.7,
			modelDown: 0.3,
			marketYes: 0.5,
			marketNo: 0.5,
			orderbookImbalance: 0.5,
		});

		expect(result.effectiveEdgeUp).toBeCloseTo(0.174375, 4);
		expect(result.effectiveEdgeDown).toBeCloseTo(-0.215625, 4);
	});

	it("reduces effective DOWN edge on strong negative imbalance", () => {
		const result = computeEdge({
			modelUp: 0.3,
			modelDown: 0.7,
			marketYes: 0.5,
			marketNo: 0.5,
			orderbookImbalance: -0.5,
		});

		expect(result.effectiveEdgeDown).toBeCloseTo(0.174375, 4);
		expect(result.effectiveEdgeUp).toBeCloseTo(-0.215625, 4);
	});

	it("applies spread penalty to both sides when spread is wide", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 0.5,
			marketNo: 0.5,
			orderbookSpreadUp: 0.06,
			orderbookSpreadDown: 0.06,
		});

		expect(result.effectiveEdgeUp).toBeCloseTo(0.064375, 4);
		expect(result.effectiveEdgeDown).toBeCloseTo(-0.135625, 4);
	});

	it("clamps market prices into [0, 1]", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 1.2,
			marketNo: -0.2,
		});

		expect(result.marketUp).toBe(1);
		expect(result.marketDown).toBe(0);
	});

	it("deducts fee from effective edges even without orderbook penalties", () => {
		const result = computeEdge({
			modelUp: 0.62,
			modelDown: 0.38,
			marketYes: 0.52,
			marketNo: 0.48,
			orderbookImbalance: 0.1,
			orderbookSpreadUp: 0.02,
			orderbookSpreadDown: 0.02,
		});

		// Fee deducted: effectiveEdge = rawEdge - takerFee (no maker rebate)
		const feeUp = 0.25 * (0.52 * 0.48) ** 2;
		const feeDown = 0.25 * (0.48 * 0.52) ** 2;
		expect(result.effectiveEdgeUp).toBeCloseTo((result.edgeUp as number) - feeUp, 10);
		expect(result.effectiveEdgeDown).toBeCloseTo((result.edgeDown as number) - feeDown, 10);
		expect(result.feeEstimateUp).toBeCloseTo(feeUp, 10);
		expect(result.feeEstimateDown).toBeCloseTo(feeDown, 10);
	});
});

describe("decide", () => {
	beforeEach(() => {
		CONFIG.strategy.marketPerformance = {};
	});

	it("classifies phase as EARLY when remainingMinutes > 10", () => {
		const result = decide({
			remainingMinutes: 11,
			edgeUp: 0,
			edgeDown: 0,
			strategy: makeStrategy(),
		});
		expect(result.phase).toBe("EARLY");
	});

	it("classifies phase as MID when remainingMinutes is between 5 and 10", () => {
		const result = decide({
			remainingMinutes: 8,
			edgeUp: 0,
			edgeDown: 0,
			strategy: makeStrategy(),
		});
		expect(result.phase).toBe("MID");
	});

	it("classifies phase as LATE when remainingMinutes <= 5", () => {
		const result = decide({
			remainingMinutes: 3,
			edgeUp: 0,
			edgeDown: 0,
			strategy: makeStrategy(),
		});
		expect(result.phase).toBe("LATE");
	});

	it("returns NO_TRADE for missing market edge data", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: null,
			edgeDown: 0.1,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("missing_market_data");
	});

	it("skips configured markets", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.2,
			edgeDown: 0.1,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy({ skipMarkets: ["BTC"] }),
			marketId: "BTC",
		});

		expect(result.reason).toBe("market_skipped_by_config");
	});

	it("rejects overconfident hard cap edges above 0.30", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.35,
			edgeDown: 0.01,
			modelUp: 0.9,
			modelDown: 0.1,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.reason).toBe("overconfident_hard_cap");
	});

	it("returns NO_TRADE when time is below minimum", () => {
		const result = decide({
			remainingMinutes: 2,
			edgeUp: 0.1,
			edgeDown: 0.01,
			strategy: makeStrategy(),
		});
		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toContain("time_left");
	});

	it("returns NO_TRADE when trade quality is below minimum", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.02,
			edgeDown: 0.01,
			modelUp: 0.52,
			modelDown: 0.48,
			regime: "CHOP",
			strategy: makeStrategy(),
			volatility15m: 0.001,
			vwapSlope: -1,
			rsi: 90,
			macdHist: -1,
			haColor: "red",
		});
		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toContain("quality_");
		expect(result.tradeQuality).toBeDefined();
		expect(result.tradeQuality).toBeLessThan(0.55);
	});

	it("enters with STRONG strength for high quality trade", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.18,
			edgeDown: 0.01,
			modelUp: 0.85,
			modelDown: 0.15,
			regime: "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.003,
			orderbookImbalance: 0.7,
			vwapSlope: 1,
			rsi: 60,
			macdHist: 0.5,
			haColor: "green",
		});
		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("UP");
		expect(result.strength).toBe("STRONG");
		expect(result.tradeQuality).toBeGreaterThanOrEqual(0.75);
	});

	it("enters with GOOD strength for moderate quality trade", () => {
		// Partial indicator alignment + moderate edge → quality in [0.60, 0.75)
		const result = decide({
			remainingMinutes: 8,
			edgeUp: 0.07,
			edgeDown: 0.01,
			modelUp: 0.58,
			modelDown: 0.42,
			regime: "RANGE",
			strategy: makeStrategy(),
			volatility15m: 0.003,
			vwapSlope: 0.5,
			rsi: 55,
			macdHist: -0.1,
			haColor: null,
		});
		expect(result.action).toBe("ENTER");
		expect(result.strength).toBe("GOOD");
		expect(result.tradeQuality).toBeGreaterThanOrEqual(0.6);
		expect(result.tradeQuality).toBeLessThan(0.75);
	});

	it("enters with OPTIONAL strength for borderline quality trade", () => {
		// Weak indicators + small edge → quality in [0.45, 0.60)
		const result = decide({
			remainingMinutes: 6,
			edgeUp: 0.05,
			edgeDown: 0.01,
			modelUp: 0.55,
			modelDown: 0.45,
			regime: "RANGE",
			strategy: makeStrategy({ minTradeQuality: 0.45 }),
			volatility15m: 0.003,
			vwapSlope: -0.1,
			rsi: 52,
			macdHist: -0.05,
			haColor: null,
		});
		expect(result.action).toBe("ENTER");
		expect(result.strength).toBe("OPTIONAL");
		expect(result.tradeQuality).toBeLessThan(0.6);
	});

	it("includes tradeQuality and confidence in ENTER decisions", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.15,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			regime: "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.003,
			vwapSlope: 1,
			rsi: 60,
			macdHist: 0.5,
			haColor: "green",
		});
		expect(result.action).toBe("ENTER");
		expect(result.tradeQuality).toBeDefined();
		expect(typeof result.tradeQuality).toBe("number");
		expect(result.confidence).toBeDefined();
		expect(result.confidence?.factors).toBeDefined();
	});

	it("includes tradeQuality in NO_TRADE quality rejections", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.02,
			edgeDown: 0.01,
			modelUp: 0.52,
			modelDown: 0.48,
			regime: "CHOP",
			strategy: makeStrategy(),
		});
		if (result.reason?.startsWith("quality_")) {
			expect(result.tradeQuality).toBeDefined();
			expect(result.tradeQuality).toBeLessThan(0.55);
		}
	});

	it("respects custom minTradeQuality from strategy config", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.05,
			edgeDown: 0.01,
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			strategy: makeStrategy({ minTradeQuality: 0.3 }),
			volatility15m: 0.003,
			vwapSlope: 0.5,
			rsi: 55,
			macdHist: 0.1,
			haColor: "green",
		});
		expect(result.action).toBe("ENTER");
	});

	it("selects correct side based on effective edge", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.01,
			edgeDown: 0.15,
			modelUp: 0.2,
			modelDown: 0.8,
			regime: "TREND_DOWN",
			strategy: makeStrategy({ minTradeQuality: 0.4 }),
			volatility15m: 0.003,
			vwapSlope: -1,
			rsi: 40,
			macdHist: -0.5,
			haColor: "red",
		});
		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("DOWN");
	});

	it("uses effectiveEdge when provided", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.15,
			edgeDown: 0.01,
			effectiveEdgeUp: 0.01,
			effectiveEdgeDown: 0.005,
			modelUp: 0.52,
			modelDown: 0.48,
			regime: "CHOP",
			strategy: makeStrategy(),
			volatility15m: 0.001,
		});
		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toContain("quality_");
	});

	it("rejects trades when bestEdge is zero", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0,
			edgeDown: -0.05,
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.003,
			vwapSlope: 1,
			rsi: 60,
			macdHist: 0.5,
			haColor: "green",
		});
		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("non_positive_edge");
	});

	it("rejects trades when bestEdge is negative", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: -0.02,
			edgeDown: -0.05,
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.003,
		});
		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("non_positive_edge");
	});

	it("rejects trades when volatility is too high", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.15,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			regime: "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.01,
		});
		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("volatility_too_high");
	});

	it("rejects trades when volatility is too low", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.15,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			regime: "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.0001,
		});
		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("volatility_too_low");
	});

	it("applies overconfidence penalty for edges above softCap", () => {
		// Compare quality of edge=0.10 (below softCap) vs edge=0.25 (above softCap)
		// With overconfidence dampening, edge=0.25 should NOT have much higher quality
		const baseline = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			regime: "RANGE",
			strategy: makeStrategy(),
			volatility15m: 0.003,
			vwapSlope: 0.5,
			rsi: 55,
			macdHist: 0.1,
			haColor: "green",
		});
		const overconfident = decide({
			remainingMinutes: 12,
			edgeUp: 0.25,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			regime: "RANGE",
			strategy: makeStrategy(),
			volatility15m: 0.003,
			vwapSlope: 0.5,
			rsi: 55,
			macdHist: 0.1,
			haColor: "green",
		});
		// Both should enter, but overconfident edge quality should be dampened
		expect(baseline.action).toBe("ENTER");
		expect(overconfident.action).toBe("ENTER");
		// The gap between them should be small due to dampening
		const gap = (overconfident.tradeQuality ?? 0) - (baseline.tradeQuality ?? 0);
		expect(gap).toBeLessThan(0.05);
	});

	it("produces lower quality for CHOP than TREND_ALIGNED under same conditions", () => {
		const makeParams = (regime: "CHOP" | "TREND_UP") => ({
			remainingMinutes: 12,
			edgeUp: 0.08,
			edgeDown: 0.01,
			modelUp: 0.65,
			modelDown: 0.35,
			regime: regime as "CHOP" | "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.003,
			vwapSlope: 0.5,
			rsi: 55,
			macdHist: 0.1,
			haColor: "green",
		});

		const chopResult = decide(makeParams("CHOP"));
		const trendResult = decide(makeParams("TREND_UP"));

		// TREND_UP should have meaningfully higher quality than CHOP
		const chopQ = chopResult.tradeQuality ?? 0;
		const trendQ = trendResult.tradeQuality ?? 0;
		expect(trendQ).toBeGreaterThan(chopQ);
		expect(trendQ - chopQ).toBeGreaterThanOrEqual(0.1);
	});
});

describe("NaN safety (P0-1)", () => {
	it("rejects NaN modelUp", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: NaN,
			modelDown: 0.4,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("model_prob_not_finite");
	});

	it("rejects Infinity modelDown", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: 0.6,
			modelDown: Infinity,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("model_prob_not_finite");
	});

	it("rejects NaN edgeUp", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: NaN,
			edgeDown: 0.01,
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_not_finite");
	});

	it("rejects -Infinity edgeDown", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: -Infinity,
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_not_finite");
	});

	it("allows null model probs (existing behavior)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.15,
			edgeDown: 0.01,
			modelUp: null,
			modelDown: null,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		// null models should still work (decide uses edge only)
		expect(result.action).not.toBe("NO_TRADE");
	});

	it("allows null edges (existing missing_market_data path)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: null,
			edgeDown: null,
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("missing_market_data");
	});
});
