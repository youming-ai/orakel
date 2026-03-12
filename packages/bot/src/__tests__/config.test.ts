import { describe, expect, it } from "vitest";
import { mergeConfigUpdate, parseConfig } from "../core/config.ts";

const VALID_CONFIG = {
	strategy: {
		edgeThresholdEarly: 0.08,
		edgeThresholdMid: 0.05,
		edgeThresholdLate: 0.03,
		phaseEarlySeconds: 180,
		phaseLateSeconds: 60,
		sigmoidScale: 5.0,
		minVolatility: 0.0001,
		maxEntryPrice: 0.92,
		minTimeLeftSeconds: 15,
		maxTimeLeftSeconds: 270,
	},
	risk: {
		paper: { maxTradeSizeUsdc: 5, dailyMaxLossUsdc: 100, maxOpenPositions: 1, maxTradesPerWindow: 1 },
		live: { maxTradeSizeUsdc: 5, dailyMaxLossUsdc: 100, maxOpenPositions: 1, maxTradesPerWindow: 1 },
	},
	execution: { orderType: "GTC", limitDiscount: 0.02, minOrderPrice: 0.05, maxOrderPrice: 0.95 },
	infra: {
		pollIntervalMs: 1000,
		cliTimeoutMs: 10000,
		cliRetries: 1,
		binanceRestUrl: "https://api.binance.com/api/v3",
		binanceWsUrl: "wss://stream.binance.com:9443/ws/btcusdt@trade",
		bybitRestUrl: "https://api.bybit.com",
		bybitWsUrl: "wss://stream.bybit.com/v5/public/spot",
		polymarketGammaUrl: "https://gamma-api.polymarket.com",
		polymarketClobUrl: "https://clob.polymarket.com",
		polymarketClobWsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
		slugPrefix: "btc-updown-5m-",
		windowSeconds: 300,
	},
	maintenance: { signalLogRetentionDays: 30, pruneIntervalMs: 3600000, redeemIntervalMs: 60000 },
};

describe("parseConfig", () => {
	it("parses a valid config", () => {
		const result = parseConfig(JSON.stringify(VALID_CONFIG));
		expect(result.strategy.edgeThresholdEarly).toBe(0.08);
		expect(result.risk.paper.maxTradeSizeUsdc).toBe(5);
	});

	it("throws on invalid config", () => {
		expect(() => parseConfig("{}")).toThrow();
	});

	it("throws on non-JSON", () => {
		expect(() => parseConfig("not json")).toThrow();
	});
});

describe("mergeConfigUpdate", () => {
	it("merges partial strategy update", () => {
		const base = parseConfig(JSON.stringify(VALID_CONFIG));
		const updated = mergeConfigUpdate(base, { strategy: { edgeThresholdEarly: 0.1 } });
		expect(updated.strategy.edgeThresholdEarly).toBe(0.1);
		expect(updated.strategy.edgeThresholdMid).toBe(0.05); // unchanged
	});

	it("merges partial risk update", () => {
		const base = parseConfig(JSON.stringify(VALID_CONFIG));
		const updated = mergeConfigUpdate(base, { risk: { paper: { maxTradeSizeUsdc: 10 } } });
		expect(updated.risk.paper.maxTradeSizeUsdc).toBe(10);
		expect(updated.risk.live.maxTradeSizeUsdc).toBe(5); // unchanged
	});
});
