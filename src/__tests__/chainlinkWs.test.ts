import { describe, expect, it } from "vitest";
import { hexToSignedBigInt } from "./chainlinkWs.ts";

const TWO_255 = 1n << 255n;
const MAX_POSITIVE_INT256 = TWO_255 - 1n;

describe("hexToSignedBigInt", () => {
	it.each([
		["0x0", 0n],
		["0x1", 1n],
		["0xa", 10n],
		["0x62f3f95a000", 6800000000000n],
		["0x100000000000000000000000000000000000000000000000000", 1n << 200n],
		["0x4000000000000000000000000000000000000000000000000000000000000000", 1n << 254n],
		["0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", MAX_POSITIVE_INT256],
	])("should convert positive int256 hex %s", (hex, expected) => {
		expect(hexToSignedBigInt(hex)).toBe(expected);
	});

	it.each([
		["0x8000000000000000000000000000000000000000000000000000000000000000", -TWO_255],
		["0x8000000000000000000000000000000000000000000000000000000000000001", -TWO_255 + 1n],
		["0xc000000000000000000000000000000000000000000000000000000000000000", -(1n << 254n)],
		["0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", -1n],
		["0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe", -2n],
	])("should convert two's complement negative int256 hex %s", (hex, expected) => {
		expect(hexToSignedBigInt(hex)).toBe(expected);
	});

	it("should parse uppercase hex with leading zeros", () => {
		const result = hexToSignedBigInt("0x000000000000000000000000000000000000000000000000000000000000000F");
		expect(result).toBe(15n);
	});

	it("should treat 2^255 boundary as the first negative value", () => {
		const result = hexToSignedBigInt("0x8000000000000000000000000000000000000000000000000000000000000000");
		expect(result).toBe(-(1n << 255n));
	});

	it("should throw for hex input without 0x prefix", () => {
		expect(() => hexToSignedBigInt("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")).toThrow();
	});
});
