import { describe, expect, it } from "vitest";
import {
	colorForAction,
	compactMacdLabel,
	fmtEtTime,
	fmtTimeLeft,
	getBtcSession,
	padAnsi,
	stripAnsi,
} from "./terminal.ts";
import type { MacdResult, TradeDecision } from "./types.ts";

describe("stripAnsi", () => {
	it("should remove ANSI escape codes", () => {
		const input = "\x1b[32mgreen text\x1b[0m";
		expect(stripAnsi(input)).toBe("green text");
	});

	it("should handle empty string", () => {
		expect(stripAnsi("")).toBe("");
	});

	it("should handle null", () => {
		expect(stripAnsi(null)).toBe("");
	});

	it("should handle undefined", () => {
		expect(stripAnsi(undefined)).toBe("");
	});

	it("should preserve normal text without ANSI codes", () => {
		expect(stripAnsi("plain text")).toBe("plain text");
	});

	it("should remove multiple ANSI codes", () => {
		const input = "\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m";
		expect(stripAnsi(input)).toBe("red green");
	});

	it("should handle numbers", () => {
		expect(stripAnsi(123)).toBe("123");
	});

	it("should handle complex ANSI sequences", () => {
		const input = "\x1b[1;32;40mBold green on black\x1b[0m";
		expect(stripAnsi(input)).toBe("Bold green on black");
	});
});

describe("padAnsi", () => {
	it("should pad string to specified width", () => {
		const result = padAnsi("hello", 10);
		expect(stripAnsi(result)).toHaveLength(10);
	});

	it("should not pad if string is already at width", () => {
		const result = padAnsi("hello", 5);
		expect(stripAnsi(result)).toBe("hello");
	});

	it("should not pad if string exceeds width", () => {
		const result = padAnsi("hello world", 5);
		expect(stripAnsi(result)).toBe("hello world");
	});

	it("should pad ANSI-colored string correctly", () => {
		const colored = "\x1b[32mhi\x1b[0m";
		const result = padAnsi(colored, 5);
		expect(stripAnsi(result)).toHaveLength(5);
	});

	it("should handle null input", () => {
		const result = padAnsi(null, 5);
		expect(stripAnsi(result)).toHaveLength(5);
	});

	it("should handle undefined input", () => {
		const result = padAnsi(undefined, 5);
		expect(stripAnsi(result)).toHaveLength(5);
	});

	it("should pad to width 0", () => {
		const result = padAnsi("hello", 0);
		expect(stripAnsi(result)).toBe("hello");
	});

	it("should calculate visible length correctly with ANSI codes", () => {
		const colored = "\x1b[31mtest\x1b[0m";
		const result = padAnsi(colored, 10);
		expect(stripAnsi(result)).toHaveLength(10);
	});
});

describe("getBtcSession", () => {
	it("should return 'Asia' for UTC hour 0", () => {
		const date = new Date("2026-02-28T00:00:00Z");
		expect(getBtcSession(date)).toBe("Asia");
	});

	it("should return 'Asia' for UTC hour 6", () => {
		const date = new Date("2026-02-28T06:00:00Z");
		expect(getBtcSession(date)).toBe("Asia");
	});

	it("should return 'Asia/Europe overlap' for UTC hour 7", () => {
		const date = new Date("2026-02-28T07:30:00Z");
		expect(getBtcSession(date)).toBe("Asia/Europe overlap");
	});

	it("should return 'Europe' for UTC hour 10", () => {
		const date = new Date("2026-02-28T10:00:00Z");
		expect(getBtcSession(date)).toBe("Europe");
	});

	it("should return 'Europe/US overlap' for UTC hour 13", () => {
		const date = new Date("2026-02-28T13:00:00Z");
		expect(getBtcSession(date)).toBe("Europe/US overlap");
	});

	it("should return 'Europe/US overlap' for UTC hour 15", () => {
		const date = new Date("2026-02-28T15:00:00Z");
		expect(getBtcSession(date)).toBe("Europe/US overlap");
	});

	it("should return 'US' for UTC hour 18", () => {
		const date = new Date("2026-02-28T18:00:00Z");
		expect(getBtcSession(date)).toBe("US");
	});

	it("should return 'Off-hours' for UTC hour 22", () => {
		const date = new Date("2026-02-28T22:00:00Z");
		expect(getBtcSession(date)).toBe("Off-hours");
	});

	it("should return 'Off-hours' for UTC hour 23", () => {
		const date = new Date("2026-02-28T23:00:00Z");
		expect(getBtcSession(date)).toBe("Off-hours");
	});

	it("should use current date when not provided", () => {
		const result = getBtcSession();
		expect(["Asia", "Europe", "US", "Off-hours", "Asia/Europe overlap", "Europe/US overlap"]).toContain(result);
	});
});

describe("fmtEtTime", () => {
	it("should format date to ET timezone HH:MM:SS", () => {
		const date = new Date("2026-02-28T12:00:00Z");
		const result = fmtEtTime(date);
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});

	it("should use 24-hour format", () => {
		const date = new Date("2026-02-28T23:00:00Z");
		const result = fmtEtTime(date);
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});

	it("should handle midnight", () => {
		const date = new Date("2026-02-28T05:00:00Z");
		const result = fmtEtTime(date);
		expect(result).toMatch(/^00:\d{2}:\d{2}$/);
	});

	it("should use current date when not provided", () => {
		const result = fmtEtTime();
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});

	it("should return '-' on error", () => {
		const invalidDate = new Date("invalid");
		const result = fmtEtTime(invalidDate);
		expect(result).toBe("-");
	});
});

describe("fmtTimeLeft", () => {
	it("should format 5 minutes as 05:00", () => {
		expect(fmtTimeLeft(5)).toBe("05:00");
	});

	it("should format 0.5 minutes as 00:30", () => {
		expect(fmtTimeLeft(0.5)).toBe("00:30");
	});

	it("should format 1.5 minutes as 01:30", () => {
		expect(fmtTimeLeft(1.5)).toBe("01:30");
	});

	it("should format 10 minutes as 10:00", () => {
		expect(fmtTimeLeft(10)).toBe("10:00");
	});

	it("should return '00:00' for null", () => {
		expect(fmtTimeLeft(null)).toBe("00:00");
	});

	it("should return '--:--' for Infinity", () => {
		expect(fmtTimeLeft(Infinity)).toBe("--:--");
	});

	it("should return '--:--' for NaN", () => {
		expect(fmtTimeLeft(NaN)).toBe("--:--");
	});

	it("should return '00:00' for 0", () => {
		expect(fmtTimeLeft(0)).toBe("00:00");
	});

	it("should clamp negative values to 00:00", () => {
		expect(fmtTimeLeft(-1)).toBe("00:00");
	});

	it("should handle fractional seconds", () => {
		expect(fmtTimeLeft(0.1)).toBe("00:06");
	});

	it("should pad minutes and seconds with leading zeros", () => {
		expect(fmtTimeLeft(2.5)).toBe("02:30");
	});
});

describe("compactMacdLabel", () => {
	it("should return 'bearish' when hist < 0 and histDelta < 0", () => {
		const macd: MacdResult = { macd: 1, signal: 2, hist: -1, histDelta: -0.5 };
		expect(compactMacdLabel(macd)).toBe("bearish");
	});

	it("should return 'red' when hist < 0 and histDelta >= 0", () => {
		const macd: MacdResult = { macd: 1, signal: 2, hist: -1, histDelta: 0.5 };
		expect(compactMacdLabel(macd)).toBe("red");
	});

	it("should return 'red' when hist < 0 and histDelta is null", () => {
		const macd: MacdResult = { macd: 1, signal: 2, hist: -1, histDelta: null };
		expect(compactMacdLabel(macd)).toBe("red");
	});

	it("should return 'bullish' when hist > 0 and histDelta > 0", () => {
		const macd: MacdResult = { macd: 2, signal: 1, hist: 1, histDelta: 0.5 };
		expect(compactMacdLabel(macd)).toBe("bullish");
	});

	it("should return 'green' when hist > 0 and histDelta <= 0", () => {
		const macd: MacdResult = { macd: 2, signal: 1, hist: 1, histDelta: -0.5 };
		expect(compactMacdLabel(macd)).toBe("green");
	});

	it("should return 'green' when hist > 0 and histDelta is null", () => {
		const macd: MacdResult = { macd: 2, signal: 1, hist: 1, histDelta: null };
		expect(compactMacdLabel(macd)).toBe("green");
	});

	it("should return 'flat' when hist = 0", () => {
		const macd: MacdResult = { macd: 1, signal: 1, hist: 0, histDelta: 0 };
		expect(compactMacdLabel(macd)).toBe("flat");
	});

	it("should return 'flat' for null macd", () => {
		expect(compactMacdLabel(null)).toBe("flat");
	});

	it("should return 'flat' for undefined macd", () => {
		expect(compactMacdLabel(undefined)).toBe("flat");
	});
});

describe("colorForAction", () => {
	it("should return green for ENTER + UP", () => {
		const result = colorForAction("ENTER", "UP");
		expect(result).toBe("\x1b[32m");
	});

	it("should return red for ENTER + DOWN", () => {
		const result = colorForAction("ENTER", "DOWN");
		expect(result).toBe("\x1b[31m");
	});

	it("should return gray for NO_TRADE + UP", () => {
		const result = colorForAction("NO_TRADE", "UP");
		expect(result).toBe("\x1b[90m");
	});

	it("should return gray for NO_TRADE + DOWN", () => {
		const result = colorForAction("NO_TRADE", "DOWN");
		expect(result).toBe("\x1b[90m");
	});

	it("should return gray for ENTER + null side", () => {
		const result = colorForAction("ENTER", null);
		expect(result).toBe("\x1b[90m");
	});

	it("should return gray for undefined action", () => {
		const result = colorForAction(undefined, "UP");
		expect(result).toBe("\x1b[90m");
	});

	it("should return gray for undefined action and side", () => {
		const result = colorForAction(undefined, undefined);
		expect(result).toBe("\x1b[90m");
	});

	it("should return gray for null action and side", () => {
		const result = colorForAction(undefined, undefined);
		expect(result).toBe("\x1b[90m");
	});
});
