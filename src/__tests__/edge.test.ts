import { describe, expect, it } from "vitest";
import type { StrategyConfig } from "../core/configTypes.ts";
import { computeEdge, decide } from "../engines/edge.ts";

function makeStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
	return {
		edgeThresholdEarly: 0.05,
		edgeThresholdMid: 0.1,
		edgeThresholdLate: 0.2,
		minProbEarly: 0.55,
		minProbMid: 0.6,
		minProbLate: 0.65,
		maxGlobalTradesPerWindow: 100,
		minTimeLeftMin: undefined,
		maxTimeLeftMin: undefined,
		minVolatility15m: undefined,
		maxVolatility15m: undefined,
		candleAggregationMinutes: undefined,
		minPriceToBeatMovePct: undefined,
		...overrides,
	};
}

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

	it("normalizes market prices by sum and computes edge", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 0.5,
			marketNo: 0.5,
		});

		expect(result.marketUp).toBeCloseTo(0.5, 10);
		expect(result.marketDown).toBeCloseTo(0.5, 10);
		expect(result.edgeUp).toBeCloseTo(0.1, 10);
		expect(result.edgeDown).toBeCloseTo(-0.1, 10);
	});

	it("removes vig from market prices via normalization", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 0.53,
			marketNo: 0.52,
		});

		const sum = 0.53 + 0.52;
		expect(result.rawSum).toBeCloseTo(sum, 10);
		expect(result.marketUp).toBeCloseTo(0.53 / sum, 10);
		expect(result.marketDown).toBeCloseTo(0.52 / sum, 10);
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

	it("marks overpriced when rawSum is above 1.08", () => {
		const result = computeEdge({
			modelUp: 0.55,
			modelDown: 0.45,
			marketYes: 0.55,
			marketNo: 0.54,
		});

		expect(result.overpriced).toBe(true);
	});

	it("does not mark overpriced when rawSum is between 1.04 and 1.08", () => {
		const result = computeEdge({
			modelUp: 0.55,
			modelDown: 0.45,
			marketYes: 0.53,
			marketNo: 0.52,
		});

		expect(result.overpriced).toBe(false);
	});

	it("clamps normalized market prices into [0, 1]", () => {
		const result = computeEdge({
			modelUp: 0.6,
			modelDown: 0.4,
			marketYes: 1.2,
			marketNo: -0.2,
		});

		expect(result.marketUp).toBe(1);
		expect(result.marketDown).toBe(0);
	});

	it("sets edge directly without adjustments (simplified strategy)", () => {
		const result = computeEdge({
			modelUp: 0.7,
			modelDown: 0.3,
			marketYes: 0.55,
			marketNo: 0.45,
		});

		expect(result.edgeUp).toBeCloseTo(0.15, 10);
		expect(result.edgeDown).toBeCloseTo(-0.15, 10);
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

	it.each([
		{ windowMinutes: 5, remaining: 4, expected: "EARLY" },
		{ windowMinutes: 5, remaining: 2, expected: "MID" },
		{ windowMinutes: 5, remaining: 1, expected: "LATE" },
		{ windowMinutes: 60, remaining: 45, expected: "EARLY" },
		{ windowMinutes: 60, remaining: 25, expected: "MID" },
		{ windowMinutes: 60, remaining: 10, expected: "LATE" },
		{ windowMinutes: 240, remaining: 180, expected: "EARLY" },
		{ windowMinutes: 240, remaining: 100, expected: "MID" },
		{ windowMinutes: 240, remaining: 30, expected: "LATE" },
	])("proportional phase for $windowMinutes-min window: $remaining min remaining → $expected", ({
		windowMinutes,
		remaining,
		expected,
	}) => {
		const result = decide({
			remainingMinutes: remaining,
			windowMinutes,
			edgeUp: 0,
			edgeDown: 0,
			strategy: makeStrategy(),
		});
		expect(result.phase).toBe(expected);
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
			strategy: makeStrategy({ skipMarkets: ["BTC-15m"] }),
			marketId: "BTC-15m",
		});

		expect(result.reason).toBe("market_skipped_by_config");
	});

	it("returns NO_TRADE when edge is below EARLY threshold (5%)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.04,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_below_0.05");
	});

	it("returns NO_TRADE when edge is below MID threshold (10%)", () => {
		const result = decide({
			remainingMinutes: 8,
			edgeUp: 0.09,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_below_0.1");
	});

	it("returns NO_TRADE when edge is below LATE threshold (20%)", () => {
		const result = decide({
			remainingMinutes: 3,
			edgeUp: 0.19,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_below_0.2");
	});

	it("returns NO_TRADE when model probability is below phase minimum", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.08,
			edgeDown: 0.01,
			modelUp: 0.5,
			modelDown: 0.5,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("prob_below_0.55");
	});

	it("returns NO_TRADE when time left is below strategy minimum", () => {
		const result = decide({
			remainingMinutes: 1,
			edgeUp: 0.2,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			strategy: makeStrategy({ minTimeLeftMin: 2 }),
		});

		expect(result.reason).toBe("time_left_below_2");
	});

	it("returns NO_TRADE when volatility is above strategy maximum", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.2,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			volatility15m: 0.08,
			strategy: makeStrategy({ maxVolatility15m: 0.05 }),
		});

		expect(result.reason).toBe("vol_above_0.05");
	});

	it("returns NO_TRADE when price move vs priceToBeat is below strategy minimum", () => {
		const result = decide({
			remainingMinutes: 8,
			edgeUp: 0.2,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			priceToBeatMovePct: 0.001,
			strategy: makeStrategy({ minPriceToBeatMovePct: 0.002 }),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("ptb_move_below_0.002");
	});

	it("applies priceToBeat move threshold directionally for DOWN entries", () => {
		const result = decide({
			remainingMinutes: 8,
			edgeUp: 0.02,
			edgeDown: 0.2,
			modelUp: 0.2,
			modelDown: 0.8,
			priceToBeatMovePct: -0.003,
			strategy: makeStrategy({ minPriceToBeatMovePct: 0.002 }),
		});

		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("DOWN");
	});

	it("enters with STRONG strength when edge >= 20%", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.22,
			edgeDown: 0.01,
			modelUp: 0.8,
			modelDown: 0.2,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("UP");
		expect(result.strength).toBe("STRONG");
	});

	it("enters with GOOD strength when edge is between 10% and 20%", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.12,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("ENTER");
		expect(result.strength).toBe("GOOD");
	});

	it("enters with OPTIONAL strength when edge is below 10%", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.06,
			edgeDown: 0.01,
			modelUp: 0.65,
			modelDown: 0.35,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("ENTER");
		expect(result.strength).toBe("OPTIONAL");
	});

	it("selects DOWN side when edgeDown exceeds edgeUp", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.01,
			edgeDown: 0.15,
			modelUp: 0.3,
			modelDown: 0.7,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("DOWN");
	});

	it("respects custom threshold overrides", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.14,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy({ edgeThresholdEarly: 0.15 }),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_below_0.15");
	});

	it("does not apply regime multipliers (simplified strategy)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.06,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			regime: "CHOP",
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("UP");
	});
});

describe("minExpectedEdge filter", () => {
	it("returns NO_TRADE when edge is below minExpectedEdge", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.06,
			edgeDown: 0.01,
			modelUp: 0.65,
			modelDown: 0.35,
			strategy: makeStrategy({ minExpectedEdge: 0.08 }),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("expected_edge_below_0.08");
	});

	it("allows trade when edge meets minExpectedEdge", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy({ minExpectedEdge: 0.08 }),
		});

		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("UP");
	});

	it("does not apply when minExpectedEdge is undefined", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.06,
			edgeDown: 0.01,
			modelUp: 0.65,
			modelDown: 0.35,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("ENTER");
	});
});

describe("maxEntryPrice filter", () => {
	it("returns NO_TRADE when market price exceeds maxEntryPrice", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy({ maxEntryPrice: 0.55 }),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("entry_price_above_0.55");
	});

	it("allows trade when market price is at maxEntryPrice", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: 0.6,
			modelDown: 0.4,
			strategy: makeStrategy({ maxEntryPrice: 0.5 }),
		});

		expect(result.action).toBe("ENTER");
	});

	it("allows cheap side trades (market price < 0.50)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.01,
			edgeDown: 0.15,
			modelUp: 0.3,
			modelDown: 0.7,
			strategy: makeStrategy({ maxEntryPrice: 0.58 }),
		});

		expect(result.action).toBe("ENTER");
		expect(result.side).toBe("DOWN");
	});

	it("does not apply when modelUp/Down is null", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: null,
			modelDown: null,
			strategy: makeStrategy({ maxEntryPrice: 0.4 }),
		});

		expect(result.action).toBe("ENTER");
	});

	it("does not apply when maxEntryPrice is undefined", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.1,
			edgeDown: 0.01,
			modelUp: 0.7,
			modelDown: 0.3,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("ENTER");
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
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("edge_not_finite");
	});

	it("allows null model probs (decide uses edge only)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: 0.15,
			edgeDown: 0.01,
			modelUp: null,
			modelDown: null,
			strategy: makeStrategy(),
		});

		expect(result.action).not.toBe("NO_TRADE");
	});

	it("allows null edges (existing missing_market_data path)", () => {
		const result = decide({
			remainingMinutes: 12,
			edgeUp: null,
			edgeDown: null,
			modelUp: 0.6,
			modelDown: 0.4,
			strategy: makeStrategy(),
		});

		expect(result.action).toBe("NO_TRADE");
		expect(result.reason).toBe("missing_market_data");
	});
});
