import { describe, expect, it } from "vitest";
import { fetchHistoricalKlines, fetchKlines, fetchLastPrice } from "../data/bybit.ts";

describe("Bybit Integration", () => {
	describe("fetchLastPrice", () => {
		it("should fetch BTCUSDT price from Bybit", async () => {
			const price = await fetchLastPrice({ symbol: "BTCUSDT" });
			expect(price).not.toBeNull();
			expect(typeof price).toBe("number");
			expect(price).toBeGreaterThan(0);
			expect(price).toBeGreaterThan(10000); // BTC should be > $10k
			expect(price).toBeLessThan(200000); // BTC should be < $200k
		}, 10000);

		it("should fetch ETHUSDT price from Bybit", async () => {
			const price = await fetchLastPrice({ symbol: "ETHUSDT" });
			expect(price).not.toBeNull();
			expect(typeof price).toBe("number");
			expect(price).toBeGreaterThan(0);
			expect(price).toBeGreaterThan(1000); // ETH should be > $1k
			expect(price).toBeLessThan(50000); // ETH should be < $50k
		}, 10000);

		it("should return null for invalid symbol", async () => {
			const price = await fetchLastPrice({ symbol: "INVALID" });
			expect(price).toBeNull();
		}, 10000);
	});

	describe("fetchKlines", () => {
		it("should fetch 1m candles for BTCUSDT", async () => {
			const candles = await fetchKlines({
				symbol: "BTCUSDT",
				interval: "1m",
				limit: 10,
			});
			expect(candles).toHaveLength(10);
			expect(candles[0]).toHaveProperty("openTime");
			expect(candles[0]).toHaveProperty("open");
			expect(candles[0]).toHaveProperty("high");
			expect(candles[0]).toHaveProperty("low");
			expect(candles[0]).toHaveProperty("close");
			expect(candles[0]).toHaveProperty("volume");
			expect(candles[0]).toHaveProperty("closeTime");
			const firstCandle = candles[0];
			if (firstCandle) {
				expect(typeof firstCandle.close).toBe("number");
			}
		}, 10000);

		it("should fetch 5m candles for ETHUSDT", async () => {
			const candles = await fetchKlines({
				symbol: "ETHUSDT",
				interval: "5m",
				limit: 5,
			});
			expect(candles).toHaveLength(5);
			const first = candles[0];
			const last = candles[4];
			if (first && last) {
				expect(first.openTime).toBeLessThan(last.openTime);
			}
		}, 10000);

		it("should use cache for repeated calls", async () => {
			const start1 = Date.now();
			await fetchKlines({ symbol: "BTCUSDT", interval: "1m", limit: 5 });
			const duration1 = Date.now() - start1;

			const start2 = Date.now();
			await fetchKlines({ symbol: "BTCUSDT", interval: "1m", limit: 5 });
			const duration2 = Date.now() - start2;

			// Cached call should be faster
			expect(duration2).toBeLessThan(duration1);
		}, 10000);
	});

	describe("fetchHistoricalKlines", () => {
		it("should fetch historical candles with pagination", async () => {
			const endTime = Date.now();
			const startTime = endTime - 60 * 60 * 1000; // 1 hour ago

			const candles = await fetchHistoricalKlines({
				symbol: "BTCUSDT",
				interval: "1m",
				startTime,
				endTime,
				limit: 100,
			});

			expect(candles.length).toBeGreaterThan(0);
			expect(candles.length).toBeGreaterThanOrEqual(50);
			const first = candles[0];
			const last = candles[candles.length - 1];
			if (first && last) {
				expect(first.openTime).toBeLessThanOrEqual(endTime);
				expect(last.openTime).toBeGreaterThanOrEqual(startTime - 5 * 60 * 1000);
			}
		}, 15000);
	});
});
