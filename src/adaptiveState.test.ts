import { describe, expect, it } from "vitest";
import {
	adaptiveManager,
	getAndClearSignalMetadata,
	performanceTracker,
	storeSignalMetadata,
	tradeSignalMetadata,
} from "./adaptiveState.ts";

describe("adaptiveState", () => {
	it("stores and retrieves signal metadata by trade id", () => {
		const tradeId = "paper-test-store-get";
		storeSignalMetadata(tradeId, {
			edge: 0.12,
			confidence: 0.66,
			phase: "MID",
			regime: "RANGE",
		});

		const meta = getAndClearSignalMetadata(tradeId);
		expect(meta).toEqual({
			edge: 0.12,
			confidence: 0.66,
			phase: "MID",
			regime: "RANGE",
		});
	});

	it("returns null for unknown trade id", () => {
		expect(getAndClearSignalMetadata("paper-missing-id")).toBeNull();
	});

	it("clears metadata after first retrieval", () => {
		const tradeId = "paper-test-clear";
		storeSignalMetadata(tradeId, {
			edge: 0.08,
			confidence: 0.5,
			phase: "EARLY",
			regime: null,
		});

		const firstRead = getAndClearSignalMetadata(tradeId);
		const secondRead = getAndClearSignalMetadata(tradeId);

		expect(firstRead).not.toBeNull();
		expect(secondRead).toBeNull();
	});

	it("initializes tracker and manager singletons", () => {
		const marketId = "adaptive-state-singletons";
		performanceTracker.recordTrade({
			marketId,
			won: true,
			edge: 0.1,
			confidence: 0.6,
			phase: "MID",
			regime: "RANGE",
			timestamp: Date.now(),
		});

		expect(performanceTracker).toBeDefined();
		expect(adaptiveManager).toBeDefined();
		expect(typeof adaptiveManager.getAdjustedThresholds).toBe("function");
		expect(tradeSignalMetadata instanceof Map).toBe(true);
	});
});
