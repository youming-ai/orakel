import { describe, expect, it } from "vitest";
import { BACKTEST_INSIGHTS, shouldTakeTrade } from "./strategyRefinement.ts";

describe("BACKTEST_INSIGHTS", () => {
	it("should set maxVolatility15m to 0.004", () => {
		expect(BACKTEST_INSIGHTS.maxVolatility15m).toBe(0.004);
	});

	it("should set minVolatility15m to 0.0005", () => {
		expect(BACKTEST_INSIGHTS.minVolatility15m).toBe(0.0005);
	});

	it("should set skipChop to false", () => {
		expect(BACKTEST_INSIGHTS.skipChop).toBe(false);
	});
});

describe("shouldTakeTrade", () => {
	it.each([
		{ market: "BTC", regime: "CHOP", volatility: 0.01 },
		{ market: "ETH", regime: "CHOP", volatility: 0.002 },
		{ market: "SOL", regime: "RANGE", volatility: 0.00049 },
		{ market: "XRP", regime: "TREND_UP", volatility: 0.0041 },
		{ market: "DOGE", regime: null, volatility: 0.0025 },
	])("always allows trade for deprecated noop path (%o)", ({ market, regime, volatility }) => {
		const result = shouldTakeTrade({ market, regime, volatility });
		expect(result).toEqual({ shouldTrade: true });
	});

	it("keeps global CHOP insight disabled", () => {
		expect(BACKTEST_INSIGHTS.skipChop).toBe(false);
	});
});
