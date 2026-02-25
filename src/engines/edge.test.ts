import { describe, expect, it } from "vitest";
import type { Regime, StrategyConfig } from "../types.ts";
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

		expect(result.effectiveEdgeUp).toBeCloseTo(0.19, 10);
		expect(result.effectiveEdgeDown).toBeCloseTo(-0.2, 10);
	});

	it("reduces effective DOWN edge on strong negative imbalance", () => {
		const result = computeEdge({
			modelUp: 0.3,
			modelDown: 0.7,
			marketYes: 0.5,
			marketNo: 0.5,
			orderbookImbalance: -0.5,
		});

		expect(result.effectiveEdgeDown).toBeCloseTo(0.19, 10);
		expect(result.effectiveEdgeUp).toBeCloseTo(-0.2, 10);
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

		expect(result.effectiveEdgeUp).toBeCloseTo(0.08, 10);
		expect(result.effectiveEdgeDown).toBeCloseTo(-0.12, 10);
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

	it("keeps effective edges unchanged without orderbook penalties", () => {
		const result = computeEdge({
			modelUp: 0.62,
			modelDown: 0.38,
			marketYes: 0.52,
			marketNo: 0.48,
			orderbookImbalance: 0.1,
			orderbookSpreadUp: 0.02,
			orderbookSpreadDown: 0.02,
		});

		expect(result.effectiveEdgeUp).toBeCloseTo(result.edgeUp as number, 10);
		expect(result.effectiveEdgeDown).toBeCloseTo(result.edgeDown as number, 10);
	});
});

describe("decide", () => {
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

	it("returns NO_TRADE when edge is below threshold", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.05,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_below_0.080");
	});

	it("returns NO_TRADE when model probability is below phase minimum", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.2,
			edgeDown: 0.1,
			modelUp: 0.55,
			modelDown: 0.45,
			regime: "RANGE",
			strategy: makeStrategy(),
		});

		expect(result.reason).toBe("prob_below_0.58");
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

	it("rejects overconfident soft cap when edge does not clear penalized threshold", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.23,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			regime: "CHOP",
			strategy: makeStrategy(),
			marketId: "ETH",
		});

		expect(result.reason).toBe("overconfident_soft_cap");
	});

	it("rejects trade when confidence is below minimum", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.12,
			edgeDown: 0.01,
			modelUp: 0.6,
			modelDown: 0.4,
			regime: "RANGE",
			strategy: makeStrategy(),
			volatility15m: 0.001,
			orderbookImbalance: -0.8,
			vwapSlope: -1,
			rsi: 90,
			macdHist: -1,
			haColor: "red",
			minConfidence: 0.7,
		});

		expect(result.reason?.startsWith("confidence_")).toBe(true);
	});

	it("enters with STRONG strength for high confidence and high edge", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.18,
			edgeDown: 0.01,
			modelUp: 0.85,
			modelDown: 0.15,
			regime: "TREND_UP",
			strategy: makeStrategy(),
			volatility15m: 0.005,
			orderbookImbalance: 0.7,
			vwapSlope: 1,
			rsi: 60,
			macdHist: 0.5,
			haColor: "green",
		});

		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("UP");
		expect(result.strength).toBe("STRONG");
	});

	it("enters with GOOD strength for moderate edge and confidence", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: 0.65,
			modelDown: 0.35,
			regime: "RANGE",
			strategy: makeStrategy(),
			volatility15m: 0.005,
			orderbookImbalance: 0.3,
			vwapSlope: 0.5,
			rsi: 58,
			macdHist: 0.2,
			haColor: "green",
		});

		expect(result.action).toBe("ENTER");
		expect(result.strength).toBe("GOOD");
	});

	it("enters with OPTIONAL strength when edge is below 0.08 but thresholds allow entry", () => {
		const strategy = makeStrategy({ edgeThresholdEarly: 0.05 });
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.06,
			edgeDown: 0.01,
			modelUp: 0.63,
			modelDown: 0.37,
			regime: "RANGE",
			strategy,
			volatility15m: 0.005,
			orderbookImbalance: 0.25,
			vwapSlope: 0.3,
			rsi: 56,
			macdHist: 0.1,
			haColor: "green",
			minConfidence: 0.45,
		});

		expect(result.action).toBe("ENTER");
		expect(result.strength).toBe("OPTIONAL");
	});

	it("disables CHOP trading for BTC due to poor win rate", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.3,
			edgeDown: 0.05,
			modelUp: 0.8,
			modelDown: 0.2,
			regime: "CHOP",
			strategy: makeStrategy(),
			marketId: "BTC",
		});

		expect(result.reason).toBe("skip_chop_poor_market");
	});

	it("applies normal CHOP multiplier for SOL (not disabled)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.15,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			regime: "CHOP",
			strategy: makeStrategy(),
			marketId: "SOL",
		});

		expect(result.reason).toBe("edge_below_0.160");
	});

	it.each([
		["BTC", "edge_below_0.120"],
		["ETH", "edge_below_0.096"],
		["SOL", "edge_below_0.080"],
		["XRP", "edge_below_0.080"],
	])("applies market multipliers for %s", (marketId, reason) => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.079,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			regime: "RANGE",
			strategy: makeStrategy(),
			marketId,
		});

		expect(result.reason).toBe(reason);
	});

	it.each([
		{ regime: "TREND_UP" as Regime, reason: "edge_below_0.072" },
		{ regime: "TREND_DOWN" as Regime, reason: "edge_below_0.112" },
	])("applies trend regime multiplier for $regime", ({ regime, reason }) => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.07,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			regime,
			strategy: makeStrategy(),
		});

		expect(result.reason).toBe(reason);
	});
});
