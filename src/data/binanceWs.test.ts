import { describe, expect, it } from "vitest";
import { buildCombinedWsUrl, buildWsUrl, toNumber } from "./binanceWs.ts";

describe("toNumber", () => {
	it("should convert valid number to number", () => {
		expect(toNumber(42)).toBe(42);
	});

	it("should convert valid string number to number", () => {
		expect(toNumber("123.45")).toBe(123.45);
	});

	it("should convert null to 0", () => {
		expect(toNumber(null)).toBe(0);
	});

	it("should return null for undefined input", () => {
		expect(toNumber(undefined)).toBeNull();
	});

	it("should return null for NaN", () => {
		expect(toNumber(NaN)).toBeNull();
	});

	it("should return null for Infinity", () => {
		expect(toNumber(Infinity)).toBeNull();
	});

	it("should return null for negative Infinity", () => {
		expect(toNumber(-Infinity)).toBeNull();
	});

	it("should return null for non-numeric string", () => {
		expect(toNumber("abc")).toBeNull();
	});

	it("should return null for object", () => {
		expect(toNumber({})).toBeNull();
	});

	it("should convert empty array to 0", () => {
		expect(toNumber([])).toBe(0);
	});

	it("should convert boolean true to 1", () => {
		expect(toNumber(true)).toBe(1);
	});

	it("should convert boolean false to 0", () => {
		expect(toNumber(false)).toBe(0);
	});

	it("should convert zero", () => {
		expect(toNumber(0)).toBe(0);
	});

	it("should convert negative number", () => {
		expect(toNumber(-42.5)).toBe(-42.5);
	});

	it("should convert string zero", () => {
		expect(toNumber("0")).toBe(0);
	});

	it("should convert empty string to 0", () => {
		expect(toNumber("")).toBe(0);
	});
});

describe("buildWsUrl", () => {
	it("should build correct URL for valid symbol", () => {
		expect(buildWsUrl("BTCUSDT")).toBe("wss://stream.binance.com:9443/ws/btcusdt@trade");
	});

	it("should lowercase symbol", () => {
		expect(buildWsUrl("ETHUSDT")).toBe("wss://stream.binance.com:9443/ws/ethusdt@trade");
	});

	it("should handle lowercase input", () => {
		expect(buildWsUrl("solusdt")).toBe("wss://stream.binance.com:9443/ws/solusdt@trade");
	});

	it("should handle mixed case", () => {
		expect(buildWsUrl("XrpUsdt")).toBe("wss://stream.binance.com:9443/ws/xrpusdt@trade");
	});

	it("should handle empty string", () => {
		expect(buildWsUrl("")).toBe("wss://stream.binance.com:9443/ws/@trade");
	});

	it("should handle null-like string", () => {
		expect(buildWsUrl("null")).toBe("wss://stream.binance.com:9443/ws/null@trade");
	});

	it("should handle whitespace", () => {
		expect(buildWsUrl("  BTC  ")).toBe("wss://stream.binance.com:9443/ws/  btc  @trade");
	});
});

describe("buildCombinedWsUrl", () => {
	it("should build URL for single symbol", () => {
		expect(buildCombinedWsUrl(["BTCUSDT"])).toBe("wss://stream.binance.com:9443/stream?streams=btcusdt@trade");
	});

	it("should build URL for multiple symbols", () => {
		expect(buildCombinedWsUrl(["BTCUSDT", "ETHUSDT"])).toBe(
			"wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade",
		);
	});

	it("should build URL for three symbols", () => {
		expect(buildCombinedWsUrl(["BTCUSDT", "ETHUSDT", "SOLUSDT"])).toBe(
			"wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade/solusdt@trade",
		);
	});

	it("should lowercase all symbols", () => {
		expect(buildCombinedWsUrl(["BTC", "ETH"])).toBe("wss://stream.binance.com:9443/stream?streams=btc@trade/eth@trade");
	});

	it("should filter out empty strings", () => {
		expect(buildCombinedWsUrl(["BTCUSDT", "", "ETHUSDT"])).toBe(
			"wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade",
		);
	});

	it("should filter out null-like values", () => {
		expect(buildCombinedWsUrl(["BTCUSDT", null as unknown as string, "ETHUSDT"])).toBe(
			"wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade",
		);
	});

	it("should handle empty array", () => {
		expect(buildCombinedWsUrl([])).toBe("wss://stream.binance.com:9443/stream?streams=");
	});

	it("should handle non-array input", () => {
		expect(buildCombinedWsUrl(null as unknown as string[])).toBe("wss://stream.binance.com:9443/stream?streams=");
	});

	it("should handle array with only empty strings", () => {
		expect(buildCombinedWsUrl(["", "", ""])).toBe("wss://stream.binance.com:9443/stream?streams=");
	});

	it("should handle mixed case symbols", () => {
		expect(buildCombinedWsUrl(["BtcUsdt", "EthUsdt"])).toBe(
			"wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade",
		);
	});
});
