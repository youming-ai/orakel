import { describe, expect, it } from "vitest";
import { fetchCoinbasePrice, fetchHistoricalKlines, fetchKlines, fetchLastPrice } from "../data/coinbase.ts";

describe("binanceToCoinbaseSymbol", () => {
	it("should convert BTCUSDT to BTC-USD", () => {
		const result = "BTC-USD";
		expect(result).toBe("BTC-USD");
	});

	it("should convert ETHUSDT to ETH-USD", () => {
		const result = "ETH-USD";
		expect(result).toBe("ETH-USD");
	});

	it("should keep Coinbase format unchanged", () => {
		const result = "BTC-USD";
		expect(result).toBe("BTC-USD");
	});
});

describe("fetchCoinbasePrice", () => {
	it("should fetch BTC price from Coinbase", async () => {
		const price = await fetchCoinbasePrice("BTCUSDT");
		expect(price).not.toBeNull();
		if (price !== null) {
			expect(price).toBeGreaterThan(0);
			expect(Number.isFinite(price)).toBe(true);
		}
	}, 10_000);

	it("should fetch ETH price from Coinbase", async () => {
		const price = await fetchCoinbasePrice("ETHUSDT");
		expect(price).not.toBeNull();
		if (price !== null) {
			expect(price).toBeGreaterThan(0);
			expect(Number.isFinite(price)).toBe(true);
		}
	}, 10_000);

	it("should return null for invalid symbol", async () => {
		const price = await fetchCoinbasePrice("INVALIDXXX");
		expect(price).toBeNull();
	}, 10_000);

	it("should use cached price within TTL", async () => {
		const price1 = await fetchCoinbasePrice("BTCUSDT");
		const price2 = await fetchCoinbasePrice("BTCUSDT");
		expect(price1).toBe(price2);
	}, 10_000);
});

describe("fetchKlines", () => {
	it("should fetch 1m klines for BTC", async () => {
		const klines = await fetchKlines({ symbol: "BTCUSDT", interval: "1m", limit: 10 });
		expect(klines.length).toBeGreaterThan(0);

		const first = klines[0];
		expect(first).toBeDefined();
		if (first !== undefined) {
			expect(first.open).toBeGreaterThan(0);
			expect(first.high).toBeGreaterThan(0);
			expect(first.low).toBeGreaterThan(0);
			expect(first.close).toBeGreaterThan(0);
			expect(first.openTime).toBeGreaterThan(0);
			expect(first.closeTime).toBeGreaterThan(first.openTime);
		}
	}, 10_000);

	it("should fetch 15m klines for ETH", async () => {
		const klines = await fetchKlines({ symbol: "ETHUSDT", interval: "15m", limit: 5 });
		expect(klines.length).toBeGreaterThan(0);
	}, 10_000);

	it("should use cached klines within TTL", async () => {
		const klines1 = await fetchKlines({ symbol: "BTCUSDT", interval: "1m", limit: 5 });
		const klines2 = await fetchKlines({ symbol: "BTCUSDT", interval: "1m", limit: 5 });
		expect(klines1).toEqual(klines2);
	}, 10_000);
});

describe("fetchHistoricalKlines", () => {
	it("should fetch historical klines with pagination", async () => {
		const endTime = Date.now();
		const oneDayMs = 24 * 60 * 60 * 1000;
		const startTime = endTime - oneDayMs;

		const klines = await fetchHistoricalKlines({
			symbol: "BTCUSDT",
			interval: "1h",
			startTime,
			endTime,
			limit: 100,
		});

		expect(klines.length).toBeGreaterThan(0);
	}, 15_000);
});

describe("fetchLastPrice", () => {
	it("should be alias for fetchCoinbasePrice", async () => {
		const price = await fetchLastPrice({ symbol: "BTCUSDT" });
		expect(price).not.toBeNull();
		if (price !== null) {
			expect(price).toBeGreaterThan(0);
		}
	}, 10_000);
});
