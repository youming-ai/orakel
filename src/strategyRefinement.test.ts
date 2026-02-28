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
	it.each(["BTC", "ETH"])("should skip CHOP regime for %s when market skipChop is true", (market) => {
		const result = shouldTakeTrade({
			market,
			regime: "CHOP",
			volatility: 0.002,
		});

		expect(result).toEqual({ shouldTrade: false, reason: "skip_chop_regime" });
	});

	it.each(["SOL", "XRP"])("should allow CHOP regime for %s when market skipChop is false", (market) => {
		const result = shouldTakeTrade({
			market,
			regime: "CHOP",
			volatility: 0.002,
		});

		expect(result).toEqual({ shouldTrade: true });
	});

	it("should allow CHOP regime for unknown market by default", () => {
		const result = shouldTakeTrade({
			market: "DOGE",
			regime: "CHOP",
			volatility: 0.002,
		});

		expect(result).toEqual({ shouldTrade: true });
	});

	it("should prioritize CHOP skip reason before volatility filters", () => {
		const result = shouldTakeTrade({
			market: "BTC",
			regime: "CHOP",
			volatility: 0.01,
		});

		expect(result).toEqual({ shouldTrade: false, reason: "skip_chop_regime" });
	});

	it("should reject trade when volatility is above max threshold", () => {
		const result = shouldTakeTrade({
			market: "SOL",
			regime: "TREND_UP",
			volatility: 0.0041,
		});

		expect(result).toEqual({ shouldTrade: false, reason: "volatility_too_high" });
	});

	it("should reject trade when volatility is below min threshold", () => {
		const result = shouldTakeTrade({
			market: "SOL",
			regime: "RANGE",
			volatility: 0.00049,
		});

		expect(result).toEqual({ shouldTrade: false, reason: "volatility_too_low" });
	});

	it("should allow trade when volatility equals max threshold", () => {
		const result = shouldTakeTrade({
			market: "SOL",
			regime: "RANGE",
			volatility: 0.004,
		});

		expect(result).toEqual({ shouldTrade: true });
	});

	it("should allow trade when volatility equals min threshold", () => {
		const result = shouldTakeTrade({
			market: "SOL",
			regime: "RANGE",
			volatility: 0.0005,
		});

		expect(result).toEqual({ shouldTrade: true });
	});

	it("should allow trade when volatility is in valid range", () => {
		const result = shouldTakeTrade({
			market: "SOL",
			regime: "RANGE",
			volatility: 0.0025,
		});

		expect(result).toEqual({ shouldTrade: true });
	});

	it("should allow trade for all non-CHOP regimes with valid volatility", () => {
		for (const regime of ["TREND_UP", "TREND_DOWN", "RANGE", null]) {
			const result = shouldTakeTrade({
				market: "BTC",
				regime,
				volatility: 0.002,
			});

			expect(result).toEqual({ shouldTrade: true });
		}
	});

	it("should keep global CHOP toggle disabled while per-market settings still apply", () => {
		expect(BACKTEST_INSIGHTS.skipChop).toBe(false);

		const solResult = shouldTakeTrade({
			market: "SOL",
			regime: "CHOP",
			volatility: 0.002,
		});
		const btcResult = shouldTakeTrade({
			market: "BTC",
			regime: "CHOP",
			volatility: 0.002,
		});

		expect(solResult).toEqual({ shouldTrade: true });
		expect(btcResult).toEqual({ shouldTrade: false, reason: "skip_chop_regime" });
	});
});
