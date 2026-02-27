import { describe, expect, it } from "vitest";
import { normalizeTokenIds, parseHexToNumber, toDecimal } from "./polygonBalance.ts";

describe("toDecimal", () => {
	it("should convert raw string with decimals to decimal number", () => {
		expect(toDecimal("1000000", 6)).toBe(1);
		expect(toDecimal("1500000", 6)).toBe(1.5);
		expect(toDecimal("123456789", 8)).toBe(1.23456789);
	});

	it("should handle zero values", () => {
		expect(toDecimal("0", 6)).toBe(0);
		expect(toDecimal("0", 18)).toBe(0);
	});

	it("should handle large numbers", () => {
		expect(toDecimal("1000000000000000000", 18)).toBe(1);
		expect(toDecimal("999999999999999999", 18)).toBeCloseTo(0.999999999999999999, 10);
	});

	it("should handle different decimal places", () => {
		expect(toDecimal("100", 2)).toBe(1);
		expect(toDecimal("10000", 4)).toBe(1);
		expect(toDecimal("1000000000000000000000000", 24)).toBe(1);
	});

	it("should return 0 for non-numeric strings", () => {
		expect(toDecimal("abc", 6)).toBe(0);
		expect(toDecimal("", 6)).toBe(0);
		expect(toDecimal("NaN", 6)).toBe(0);
	});

	it("should return 0 for Infinity", () => {
		expect(toDecimal("Infinity", 6)).toBe(0);
		expect(toDecimal("-Infinity", 6)).toBe(0);
	});

	it("should handle negative numbers", () => {
		expect(toDecimal("-1000000", 6)).toBe(-1);
		expect(toDecimal("-500000", 6)).toBe(-0.5);
	});

	it("should handle decimal strings", () => {
		expect(toDecimal("1.5", 6)).toBeCloseTo(0.0000015, 10);
	});
});

describe("parseHexToNumber", () => {
	it("should parse valid hex strings with 0x prefix", () => {
		expect(parseHexToNumber("0x0")).toBe(0);
		expect(parseHexToNumber("0x1")).toBe(1);
		expect(parseHexToNumber("0xa")).toBe(10);
		expect(parseHexToNumber("0xff")).toBe(255);
		expect(parseHexToNumber("0x100")).toBe(256);
	});

	it("should parse uppercase hex strings", () => {
		expect(parseHexToNumber("0xA")).toBe(10);
		expect(parseHexToNumber("0xFF")).toBe(255);
		expect(parseHexToNumber("0xDEADBEEF")).toBe(3735928559);
	});

	it("should parse large hex numbers", () => {
		expect(parseHexToNumber("0x62f3f95a000")).toBe(6800000000000);
		expect(parseHexToNumber("0xffffffffffffffff")).toBe(18446744073709551615);
	});

	it("should throw for hex without 0x prefix", () => {
		expect(() => parseHexToNumber("ff")).toThrow("rpc_invalid_hex");
		expect(() => parseHexToNumber("deadbeef")).toThrow("rpc_invalid_hex");
	});

	it("should throw for invalid hex characters", () => {
		expect(() => parseHexToNumber("0xGG")).toThrow("rpc_invalid_number");
		expect(() => parseHexToNumber("0xZZ")).toThrow("rpc_invalid_number");
	});

	it("should throw for empty or whitespace-only strings", () => {
		expect(() => parseHexToNumber("")).toThrow("rpc_invalid_hex");
		expect(() => parseHexToNumber("   ")).toThrow("rpc_invalid_hex");
	});

	it("should throw for null or undefined", () => {
		expect(() => parseHexToNumber(null as unknown as string)).toThrow("rpc_invalid_hex");
		expect(() => parseHexToNumber(undefined as unknown as string)).toThrow("rpc_invalid_hex");
	});

	it("should handle hex with leading zeros", () => {
		expect(parseHexToNumber("0x00000001")).toBe(1);
		expect(parseHexToNumber("0x000000ff")).toBe(255);
	});

	it("should trim whitespace around hex string", () => {
		expect(parseHexToNumber("  0x1  ")).toBe(1);
		expect(parseHexToNumber("\t0xff\n")).toBe(255);
	});
});

describe("normalizeTokenIds", () => {
	it("should return empty array for empty input", () => {
		expect(normalizeTokenIds([])).toEqual([]);
	});

	it("should return valid token IDs", () => {
		expect(normalizeTokenIds(["1", "2", "3"])).toEqual(["1", "2", "3"]);
	});

	it("should deduplicate token IDs", () => {
		expect(normalizeTokenIds(["1", "2", "1", "3", "2"])).toEqual(["1", "2", "3"]);
	});

	it("should trim whitespace from token IDs", () => {
		expect(normalizeTokenIds(["  1  ", "2", " 3 "])).toEqual(["1", "2", "3"]);
	});

	it("should skip empty strings", () => {
		expect(normalizeTokenIds(["1", "", "2", "  ", "3"])).toEqual(["1", "2", "3"]);
	});

	it("should skip invalid BigInt values", () => {
		expect(normalizeTokenIds(["1", "abc", "2", "xyz", "3"])).toEqual(["1", "2", "3"]);
	});

	it("should handle large BigInt values", () => {
		const largeId = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
		expect(normalizeTokenIds([largeId, "1"])).toEqual([largeId, "1"]);
	});

	it("should preserve order of first occurrence", () => {
		expect(normalizeTokenIds(["3", "1", "2", "1", "3"])).toEqual(["3", "1", "2"]);
	});

	it("should handle mixed valid and invalid IDs", () => {
		expect(normalizeTokenIds(["1", "not-a-number", "2", "3"])).toEqual(["1", "2", "3"]);
	});

	it("should handle zero as valid token ID", () => {
		expect(normalizeTokenIds(["0", "1", "0"])).toEqual(["0", "1"]);
	});

	it("should handle negative numbers as valid BigInt", () => {
		expect(normalizeTokenIds(["1", "-1", "2"])).toEqual(["1", "-1", "2"]);
	});
});
