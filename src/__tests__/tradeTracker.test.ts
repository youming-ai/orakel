import { describe, expect, it } from "vitest";
import { createTradeTracker } from "../core/tradeTracker.ts";

describe("createTradeTracker", () => {
	it("has() returns false for unrecorded entries", () => {
		const tracker = createTradeTracker();
		expect(tracker.has("BTC-5m", 1000)).toBe(false);
	});

	it("has() returns true after record()", () => {
		const tracker = createTradeTracker();
		tracker.record("BTC-5m", 1000);
		expect(tracker.has("BTC-5m", 1000)).toBe(true);
		expect(tracker.has("BTC-15m", 1000)).toBe(false);
	});

	it("multiple markets with different startMs coexist without clearing", () => {
		const tracker = createTradeTracker();
		tracker.record("BTC-5m", 1000);
		tracker.record("BTC-15m", 2000);
		tracker.record("BTC-15m", 3000);
		expect(tracker.has("BTC-5m", 1000)).toBe(true);
		expect(tracker.has("BTC-15m", 2000)).toBe(true);
		expect(tracker.has("BTC-15m", 3000)).toBe(true);
	});

	it("canTradeGlobally counts all active entries", () => {
		const tracker = createTradeTracker();
		tracker.record("BTC-5m", 1000);
		tracker.record("BTC-15m", 2000);
		expect(tracker.canTradeGlobally(3)).toBe(true);
		expect(tracker.canTradeGlobally(2)).toBe(false);
		expect(tracker.canTradeGlobally(1)).toBe(false);
	});

	it("prune removes entries with startMs before cutoff", () => {
		const tracker = createTradeTracker();
		tracker.record("BTC-5m", 1000);
		tracker.record("BTC-15m", 5000);
		tracker.record("BTC-15m", 9000);
		tracker.prune(3000);
		expect(tracker.has("BTC-5m", 1000)).toBe(false);
		expect(tracker.has("BTC-15m", 5000)).toBe(true);
		expect(tracker.has("BTC-15m", 9000)).toBe(true);
		expect(tracker.canTradeGlobally(3)).toBe(true);
	});

	it("prune keeps entries at exactly the cutoff", () => {
		const tracker = createTradeTracker();
		tracker.record("BTC-5m", 3000);
		tracker.prune(3000);
		expect(tracker.has("BTC-5m", 3000)).toBe(true);
	});
});
