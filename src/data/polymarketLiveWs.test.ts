import { describe, expect, it } from "vitest";
import { normalizePayload, normSymbol, safeJsonParse, toFiniteNumber } from "./polymarketLiveWs.ts";

describe("safeJsonParse", () => {
	it("should parse valid JSON object", () => {
		const result = safeJsonParse('{"key":"value"}');
		expect(result).toEqual({ key: "value" });
	});

	it("should parse valid JSON array", () => {
		const result = safeJsonParse("[1,2,3]");
		expect(result).toEqual([1, 2, 3]);
	});

	it("should parse valid JSON number", () => {
		const result = safeJsonParse("42");
		expect(result).toBe(42);
	});

	it("should parse valid JSON string", () => {
		const result = safeJsonParse('"hello"');
		expect(result).toBe("hello");
	});

	it("should parse valid JSON boolean", () => {
		const result = safeJsonParse("true");
		expect(result).toBe(true);
	});

	it("should parse valid JSON null", () => {
		const result = safeJsonParse("null");
		expect(result).toBeNull();
	});

	it("should return null for invalid JSON", () => {
		expect(safeJsonParse("{invalid}")).toBeNull();
	});

	it("should return null for malformed JSON", () => {
		expect(safeJsonParse('{"key": undefined}')).toBeNull();
	});

	it("should return null for empty string", () => {
		expect(safeJsonParse("")).toBeNull();
	});

	it("should return null for incomplete JSON", () => {
		expect(safeJsonParse('{"key":')).toBeNull();
	});

	it("should return null for trailing comma", () => {
		expect(safeJsonParse('{"key":"value",}')).toBeNull();
	});

	it("should parse nested JSON", () => {
		const result = safeJsonParse('{"outer":{"inner":"value"}}');
		expect(result).toEqual({ outer: { inner: "value" } });
	});

	it("should parse JSON with special characters", () => {
		const result = safeJsonParse('{"key":"value with \\"quotes\\""}');
		expect(result).toEqual({ key: 'value with "quotes"' });
	});
});

describe("normalizePayload", () => {
	it("should return object as-is", () => {
		const obj = { key: "value" };
		expect(normalizePayload(obj)).toEqual(obj);
	});

	it("should return null for null input", () => {
		expect(normalizePayload(null)).toBeNull();
	});

	it("should return null for undefined input", () => {
		expect(normalizePayload(undefined)).toBeNull();
	});

	it("should return null for false input", () => {
		expect(normalizePayload(false)).toBeNull();
	});

	it("should return null for zero input", () => {
		expect(normalizePayload(0)).toBeNull();
	});

	it("should return null for empty string", () => {
		expect(normalizePayload("")).toBeNull();
	});

	it("should parse and return JSON string as object", () => {
		const result = normalizePayload('{"key":"value"}');
		expect(result).toEqual({ key: "value" });
	});

	it("should return null for non-JSON string", () => {
		expect(normalizePayload("not json")).toBeNull();
	});

	it("should return null for array input", () => {
		expect(normalizePayload([1, 2, 3])).toBeNull();
	});

	it("should return null for JSON array string", () => {
		expect(normalizePayload("[1,2,3]")).toBeNull();
	});

	it("should return null for JSON number string", () => {
		expect(normalizePayload("42")).toBeNull();
	});

	it("should return null for JSON boolean string", () => {
		expect(normalizePayload("true")).toBeNull();
	});

	it("should return null for JSON null string", () => {
		expect(normalizePayload("null")).toBeNull();
	});

	it("should handle nested objects", () => {
		const obj = { outer: { inner: "value" } };
		expect(normalizePayload(obj)).toEqual(obj);
	});

	it("should parse nested JSON string", () => {
		const result = normalizePayload('{"outer":{"inner":"value"}}');
		expect(result).toEqual({ outer: { inner: "value" } });
	});

	it("should return null for number input", () => {
		expect(normalizePayload(42)).toBeNull();
	});

	it("should return null for boolean input", () => {
		expect(normalizePayload(true)).toBeNull();
	});
});

describe("toFiniteNumber", () => {
	it("should convert valid number", () => {
		expect(toFiniteNumber(42)).toBe(42);
	});

	it("should convert valid string number", () => {
		expect(toFiniteNumber("123.45")).toBe(123.45);
	});

	it("should return null for null input", () => {
		expect(toFiniteNumber(null)).toBeNull();
	});

	it("should return null for undefined input", () => {
		expect(toFiniteNumber(undefined)).toBeNull();
	});

	it("should return null for NaN", () => {
		expect(toFiniteNumber(NaN)).toBeNull();
	});

	it("should return null for Infinity", () => {
		expect(toFiniteNumber(Infinity)).toBeNull();
	});

	it("should return null for negative Infinity", () => {
		expect(toFiniteNumber(-Infinity)).toBeNull();
	});

	it("should return null for non-numeric string", () => {
		expect(toFiniteNumber("abc")).toBeNull();
	});

	it("should return null for object", () => {
		expect(toFiniteNumber({})).toBeNull();
	});

	it("should return null for array", () => {
		expect(toFiniteNumber([42])).toBeNull();
	});

	it("should return null for boolean", () => {
		expect(toFiniteNumber(true)).toBeNull();
	});

	it("should convert zero", () => {
		expect(toFiniteNumber(0)).toBe(0);
	});

	it("should convert negative number", () => {
		expect(toFiniteNumber(-42.5)).toBe(-42.5);
	});

	it("should convert string zero", () => {
		expect(toFiniteNumber("0")).toBe(0);
	});

	it("should convert empty string to 0", () => {
		expect(toFiniteNumber("")).toBe(0);
	});

	it("should convert string with leading/trailing spaces", () => {
		expect(toFiniteNumber("  42  ")).toBe(42);
	});

	it("should convert scientific notation string", () => {
		expect(toFiniteNumber("1e3")).toBe(1000);
	});

	it("should return null for string Infinity", () => {
		expect(toFiniteNumber("Infinity")).toBeNull();
	});
});

describe("normSymbol", () => {
	it("should lowercase symbol", () => {
		expect(normSymbol("BTC")).toBe("btc");
	});

	it("should lowercase mixed case", () => {
		expect(normSymbol("BtcUsdt")).toBe("btcusdt");
	});

	it("should remove special characters", () => {
		expect(normSymbol("BTC-USDT")).toBe("btcusdt");
	});

	it("should remove spaces", () => {
		expect(normSymbol("BTC USDT")).toBe("btcusdt");
	});

	it("should remove slashes", () => {
		expect(normSymbol("BTC/USDT")).toBe("btcusdt");
	});

	it("should handle null input", () => {
		expect(normSymbol(null)).toBe("");
	});

	it("should handle undefined input", () => {
		expect(normSymbol(undefined)).toBe("");
	});

	it("should handle empty string", () => {
		expect(normSymbol("")).toBe("");
	});

	it("should handle number input", () => {
		expect(normSymbol(42)).toBe("42");
	});

	it("should handle boolean input", () => {
		expect(normSymbol(true)).toBe("true");
	});

	it("should remove multiple special characters", () => {
		expect(normSymbol("BTC-USD_T!@#")).toBe("btcusdt");
	});

	it("should keep numbers", () => {
		expect(normSymbol("BTC123")).toBe("btc123");
	});

	it("should handle all uppercase", () => {
		expect(normSymbol("ETHEREUM")).toBe("ethereum");
	});

	it("should handle all lowercase", () => {
		expect(normSymbol("bitcoin")).toBe("bitcoin");
	});

	it("should remove parentheses", () => {
		expect(normSymbol("BTC(USDT)")).toBe("btcusdt");
	});

	it("should remove brackets", () => {
		expect(normSymbol("BTC[USDT]")).toBe("btcusdt");
	});

	it("should remove dots", () => {
		expect(normSymbol("BTC.USDT")).toBe("btcusdt");
	});

	it("should remove commas", () => {
		expect(normSymbol("BTC,USDT")).toBe("btcusdt");
	});

	it("should handle object input", () => {
		expect(normSymbol({})).toBe("objectobject");
	});

	it("should handle array input", () => {
		expect(normSymbol(["BTC"])).toBe("btc");
	});
});
