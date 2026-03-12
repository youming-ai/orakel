import { describe, expect, it } from "vitest";
import { computePhase, computeSlug, computeTimeLeftSeconds, computeWindowBounds } from "../core/clock.ts";

const WINDOW_SEC = 300;

describe("computeWindowBounds", () => {
	it("returns correct start/end for a time mid-window", () => {
		// 2026-03-12T06:52:30Z = 1773564750 (mid-window)
		const nowSec = 1773564750;
		const { startSec, endSec } = computeWindowBounds(nowSec, WINDOW_SEC);
		expect(endSec).toBe(1773564900); // ceil to next 300 boundary
		expect(startSec).toBe(1773564600); // endSec - 300
	});

	it("returns next window when exactly on boundary", () => {
		const nowSec = 1773564600; // exactly on 300 boundary
		const { startSec, endSec } = computeWindowBounds(nowSec, WINDOW_SEC);
		// On boundary = start of new window, so this IS the start
		expect(startSec).toBe(1773564600);
		expect(endSec).toBe(1773564900);
	});
});

describe("computeSlug", () => {
	it("generates correct slug from endSec", () => {
		expect(computeSlug(1773298200, "btc-updown-5m-")).toBe("btc-updown-5m-1773298200");
	});
});

describe("computeTimeLeftSeconds", () => {
	it("returns seconds until window end", () => {
		const nowMs = 1773564750_000; // 150s into window
		const endMs = 1773564900_000;
		expect(computeTimeLeftSeconds(nowMs, endMs)).toBe(150);
	});

	it("returns 0 when past window end", () => {
		const nowMs = 1773565000_000;
		const endMs = 1773564900_000;
		expect(computeTimeLeftSeconds(nowMs, endMs)).toBe(0);
	});
});

describe("computePhase", () => {
	it("returns EARLY when > phaseEarlySeconds left", () => {
		expect(computePhase(200, 180, 60)).toBe("EARLY");
	});

	it("returns MID when between early and late", () => {
		expect(computePhase(120, 180, 60)).toBe("MID");
	});

	it("returns LATE when < phaseLateSeconds left", () => {
		expect(computePhase(30, 180, 60)).toBe("LATE");
	});

	it("returns LATE when exactly at late boundary", () => {
		expect(computePhase(60, 180, 60)).toBe("LATE");
	});
});
