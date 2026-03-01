import { describe, expect, it } from "vitest";
import { CONFIG } from "../config.ts";
import type { AppConfig, Candle, MarketConfig, RawMarketData } from "../types.ts";
import { computeMarketDecision, countVwapCrosses } from "./compute.ts";

const TEST_MARKET: MarketConfig = {
	id: "SOL",
	label: "SOL",
	binanceSymbol: "SOLUSDT",
	polymarket: {
		seriesId: "series-sol",
		seriesSlug: "sol-series",
		slugPrefix: "sol",
	},
	chainlink: {
		aggregator: "0x0000000000000000000000000000000000000000",
		decimals: 8,
		wsSymbol: "SOLUSD",
	},
	pricePrecision: 2,
};

function makeCandle(overrides: Partial<Candle> = {}): Candle {
	return {
		openTime: 0,
		open: 100,
		high: 100.5,
		low: 99.5,
		close: 100,
		volume: 120,
		closeTime: 59_999,
		...overrides,
	};
}

function makeCandles(count = 80, startPrice = 100): Candle[] {
	let close = startPrice;
	return Array.from({ length: count }, (_, index) => {
		const walkStep = ((index % 7) - 3) * 0.08 + (index % 2 === 0 ? 0.03 : -0.02);
		const nextClose = Number((close + walkStep).toFixed(4));
		const nextOpen = Number((close + walkStep * 0.4).toFixed(4));
		const high = Number((Math.max(nextOpen, nextClose) + 0.18).toFixed(4));
		const low = Number((Math.min(nextOpen, nextClose) - 0.18).toFixed(4));
		close = nextClose;

		return makeCandle({
			openTime: index * 60_000,
			closeTime: (index + 1) * 60_000 - 1,
			open: nextOpen,
			high,
			low,
			close: nextClose,
			volume: 100 + (index % 6) * 15,
		});
	});
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
	const base = structuredClone(CONFIG) as AppConfig;
	return {
		...base,
		...overrides,
		strategy: {
			...base.strategy,
			...(overrides.strategy ?? {}),
		},
		chainlink: {
			...base.chainlink,
			...(overrides.chainlink ?? {}),
		},
		polymarket: {
			...base.polymarket,
			...(overrides.polymarket ?? {}),
		},
	};
}

function makeRawMarketData(overrides: Partial<RawMarketData> = {}): RawMarketData {
	const baseCandles = makeCandles(80, 100);
	const base: RawMarketData = {
		ok: true,
		market: TEST_MARKET,
		spotPrice: 100.8,
		currentPrice: 100.7,
		lastPrice: 100.7,
		timeLeftMin: 8,
		marketSlug: "sol-test-window",
		marketStartMs: Date.now() - 2 * 60_000,
		candles: baseCandles,
		poly: {
			ok: true,
			prices: { up: 0.5, down: 0.49 },
			orderbook: {
				up: {
					bestBid: 0.5,
					bestAsk: 0.51,
					spread: 0.01,
					bidLiquidity: 20_000,
					askLiquidity: 19_000,
				},
				down: {
					bestBid: 0.49,
					bestAsk: 0.5,
					spread: 0.01,
					bidLiquidity: 18_500,
					askLiquidity: 19_500,
				},
			},
		},
	};

	return {
		...base,
		...overrides,
		market: overrides.market ?? base.market,
		candles: overrides.candles ?? base.candles,
		poly: overrides.poly ?? base.poly,
	};
}

describe("countVwapCrosses", () => {
	it("returns 0 when there are no crosses", () => {
		expect(countVwapCrosses([2, 2, 2, 2], [1, 1, 1, 1], 4)).toBe(0);
	});

	it("counts a single cross", () => {
		expect(countVwapCrosses([1, 2, 0], [1, 1, 1], 3)).toBe(1);
	});

	it("counts multiple crosses within lookback", () => {
		expect(countVwapCrosses([2, 0, 2, 0, 2], [1, 1, 1, 1, 1], 5)).toBe(4);
	});

	it("returns null when there is insufficient data", () => {
		expect(countVwapCrosses([1, 2, 3], [1, 2, 3], 5)).toBeNull();
	});

	it("returns null for empty arrays", () => {
		expect(countVwapCrosses([], [], 1)).toBeNull();
	});
});

describe("computeMarketDecision", () => {
	it("computes a decision shape with minimal valid market data", () => {
		const config = makeConfig();
		const data = makeRawMarketData();

		const result = computeMarketDecision(data, 101.2, config);

		expect(result).toHaveProperty("rec");
		expect(result).toHaveProperty("consec");
		expect(result).toHaveProperty("rsiNow");
		expect(result).toHaveProperty("macd");
		expect(result).toHaveProperty("vwapSlope");
		expect(result).toHaveProperty("volatility15m");
		expect(result).toHaveProperty("binanceChainlinkDelta");
		expect(result).toHaveProperty("orderbookImbalance");
		expect(result).toHaveProperty("marketUp");
		expect(result).toHaveProperty("marketDown");
		expect(result).toHaveProperty("edge");
		expect(result).toHaveProperty("scored");
		expect(result).toHaveProperty("blended");
		expect(result).toHaveProperty("regimeInfo");
		expect(result).toHaveProperty("finalUp");
		expect(result).toHaveProperty("finalDown");
		expect(result).toHaveProperty("volImplied");
		expect(result).toHaveProperty("pLong");
		expect(result).toHaveProperty("pShort");
		expect(result).toHaveProperty("predictNarrative");
		expect(result).toHaveProperty("actionText");
		expect(result.finalDown).toBeCloseTo(1 - result.finalUp, 10);
	});

	it("handles null priceToBeat", () => {
		const config = makeConfig();
		const data = makeRawMarketData();

		const result = computeMarketDecision(data, null, config);

		expect(result.volImplied).toBeNull();
		expect(result.blended.source).toBe("ta_only");
	});

	it.each([
		[11, "EARLY"],
		[8, "MID"],
		[4, "LATE"],
	])("sets phase %s minutes to %s", (timeLeftMin, expectedPhase) => {
		const config = makeConfig();
		const data = makeRawMarketData({ timeLeftMin });

		const result = computeMarketDecision(data, 101.2, config);

		expect(result.rec.phase).toBe(expectedPhase);
	});
});
