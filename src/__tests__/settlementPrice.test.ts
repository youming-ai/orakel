import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketConfig } from "../core/configTypes.ts";
import { fetchSettlementPrice } from "../runtime/settlementCycle.ts";

// Mock the chainlink module
vi.mock("../data/chainlink.ts", () => ({
	fetchChainlinkPrice: vi.fn(),
}));

const { fetchChainlinkPrice } = await import("../data/chainlink.ts");
const mockFetchChainlink = vi.mocked(fetchChainlinkPrice);

beforeEach(() => {
	mockFetchChainlink.mockReset();
});

const btcMarket: MarketConfig = {
	id: "BTC-15m",
	coin: "BTC",
	label: "Bitcoin 15m",
	candleWindowMinutes: 15,
	resolutionSource: "chainlink",
	binanceSymbol: "BTCUSDT",
	polymarket: { seriesId: "10192", seriesSlug: "btc-up-or-down-15m", slugPrefix: "btc-updown-15m-" },
	chainlink: { aggregator: "0xabc", decimals: 8, wsSymbol: "btc" },
	pricePrecision: 0,
};

const binanceMarket: MarketConfig = {
	...btcMarket,
	id: "TEST-binance",
	resolutionSource: "binance",
};

describe("fetchSettlementPrice", () => {
	it("returns Chainlink price for chainlink-resolved markets", async () => {
		mockFetchChainlink.mockResolvedValueOnce({ price: 84500, updatedAt: Date.now(), source: "chainlink" });
		const fallback = new Map([["BTC-15m", 84400]]);

		const price = await fetchSettlementPrice(btcMarket, fallback);
		expect(price).toBe(84500);
		expect(mockFetchChainlink).toHaveBeenCalledWith({ aggregator: "0xabc", decimals: 8 });
	});

	it("falls back to latestPrices when Chainlink returns null", async () => {
		mockFetchChainlink.mockResolvedValueOnce({ price: null, updatedAt: null, source: "chainlink" });
		const fallback = new Map([["BTC-15m", 84400]]);

		const price = await fetchSettlementPrice(btcMarket, fallback);
		expect(price).toBe(84400);
	});

	it("falls back to latestPrices when Chainlink throws", async () => {
		mockFetchChainlink.mockRejectedValueOnce(new Error("rpc_timeout"));
		const fallback = new Map([["BTC-15m", 84400]]);

		const price = await fetchSettlementPrice(btcMarket, fallback);
		expect(price).toBe(84400);
	});

	it("skips Chainlink for binance-resolved markets", async () => {
		const fallback = new Map([["TEST-binance", 3200]]);

		const price = await fetchSettlementPrice(binanceMarket, fallback);
		expect(price).toBe(3200);
		expect(mockFetchChainlink).not.toHaveBeenCalled();
	});

	it("returns null when no prices available", async () => {
		mockFetchChainlink.mockResolvedValueOnce({ price: null, updatedAt: null, source: "chainlink" });
		const fallback = new Map<string, number>();

		const price = await fetchSettlementPrice(btcMarket, fallback);
		expect(price).toBeNull();
	});
});
