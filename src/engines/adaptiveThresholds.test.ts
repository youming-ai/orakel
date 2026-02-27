import { describe, expect, it } from "vitest";
import type { PerformanceSnapshot, TradeOutcome } from "./adaptiveThresholds.ts";
import { AdaptiveThresholdManager, MarketPerformanceTracker } from "./adaptiveThresholds.ts";

function makeOutcome(overrides: Partial<TradeOutcome> = {}): TradeOutcome {
	return {
		marketId: "BTC",
		won: true,
		edge: 0.1,
		confidence: 0.6,
		phase: "MID",
		regime: "RANGE",
		timestamp: 1_000,
		...overrides,
	};
}

function recordOutcomes(
	tracker: MarketPerformanceTracker,
	marketId: string,
	wins: boolean[],
	startTimestamp: number = 1_000,
): void {
	wins.forEach((won, index) => {
		tracker.recordTrade(
			makeOutcome({
				marketId,
				won,
				timestamp: startTimestamp + index,
			}),
		);
	});
}

describe("MarketPerformanceTracker", () => {
	it("returns null snapshot for unknown market", () => {
		const tracker = new MarketPerformanceTracker();
		expect(tracker.getSnapshot("BTC")).toBeNull();
	});

	it("returns null when fewer than five trades are recorded", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, false, true, true]);
		expect(tracker.getSnapshot("BTC")).toBeNull();
	});

	it("computes totals, win rate, and averages after enough trades", () => {
		const tracker = new MarketPerformanceTracker();
		tracker.recordTrade(makeOutcome({ marketId: "BTC", won: true, edge: 0.1, confidence: 0.6, timestamp: 1 }));
		tracker.recordTrade(makeOutcome({ marketId: "BTC", won: false, edge: 0.2, confidence: 0.7, timestamp: 2 }));
		tracker.recordTrade(makeOutcome({ marketId: "BTC", won: true, edge: 0.3, confidence: 0.8, timestamp: 3 }));
		tracker.recordTrade(makeOutcome({ marketId: "BTC", won: false, edge: 0.4, confidence: 0.9, timestamp: 4 }));
		tracker.recordTrade(makeOutcome({ marketId: "BTC", won: true, edge: 0.5, confidence: 1.0, timestamp: 5 }));

		const snapshot = tracker.getSnapshot("BTC");
		expect(snapshot).not.toBeNull();
		expect(snapshot?.totalTrades).toBe(5);
		expect(snapshot?.wins).toBe(3);
		expect(snapshot?.currentWinRate).toBeCloseTo(0.6, 10);
		expect(snapshot?.recentWinRate).toBeCloseTo(0.6, 10);
		expect(snapshot?.avgEdge).toBeCloseTo(0.3, 10);
		expect(snapshot?.avgConfidence).toBeCloseTo(0.8, 10);
	});

	it("tracks markets independently", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, false, true, false]);
		recordOutcomes(tracker, "ETH", [false, false, false, false, true]);

		const btc = tracker.getSnapshot("BTC");
		const eth = tracker.getSnapshot("ETH");

		expect(btc?.currentWinRate).toBeCloseTo(0.6, 10);
		expect(eth?.currentWinRate).toBeCloseTo(0.2, 10);
	});

	it("evicts oldest trades when rolling window is exceeded", () => {
		const tracker = new MarketPerformanceTracker(5);
		recordOutcomes(tracker, "BTC", [false, false, true, true, true, true, true]);

		const snapshot = tracker.getSnapshot("BTC");
		expect(snapshot?.totalTrades).toBe(5);
		expect(snapshot?.wins).toBe(5);
		expect(snapshot?.currentWinRate).toBe(1);
	});

	it("uses last ten trades for recentWinRate", () => {
		const tracker = new MarketPerformanceTracker();
		const firstTen = Array.from({ length: 10 }, () => false);
		const lastTen = Array.from({ length: 10 }, () => true);
		recordOutcomes(tracker, "BTC", [...firstTen, ...lastTen]);

		const snapshot = tracker.getSnapshot("BTC");
		expect(snapshot?.currentWinRate).toBeCloseTo(0.5, 10);
		expect(snapshot?.recentWinRate).toBeCloseTo(1, 10);
	});

	it("detects improving trend when recent beats overall by at least 0.05", () => {
		const tracker = new MarketPerformanceTracker();
		const firstTen = [false, false, false, false, false, false, true, true, true, true];
		const lastTen = [true, true, true, true, true, true, true, true, false, false];
		recordOutcomes(tracker, "BTC", [...firstTen, ...lastTen]);

		const snapshot = tracker.getSnapshot("BTC");
		expect(snapshot?.currentWinRate).toBeCloseTo(0.6, 10);
		expect(snapshot?.recentWinRate).toBeCloseTo(0.8, 10);
		expect(snapshot?.trend).toBe("improving");
	});

	it("detects declining trend when recent trails overall by at least 0.05", () => {
		const tracker = new MarketPerformanceTracker();
		const firstTen = [true, true, true, true, true, true, true, false, false, false];
		const lastTen = [true, true, true, true, true, false, false, false, false, false];
		recordOutcomes(tracker, "BTC", [...firstTen, ...lastTen]);

		const snapshot = tracker.getSnapshot("BTC");
		expect(snapshot?.currentWinRate).toBeCloseTo(0.6, 10);
		expect(snapshot?.recentWinRate).toBeCloseTo(0.5, 10);
		expect(snapshot?.trend).toBe("declining");
	});

	it("keeps trend stable when delta is below threshold", () => {
		const tracker = new MarketPerformanceTracker();
		const firstFifteen = [
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			false,
			false,
			false,
			false,
			false,
			false,
			false,
		];
		const lastTen = [true, true, true, true, true, false, false, false, false, false];
		recordOutcomes(tracker, "BTC", [...firstFifteen, ...lastTen]);

		const snapshot = tracker.getSnapshot("BTC");
		expect(snapshot?.currentWinRate).toBeCloseTo(0.52, 10);
		expect(snapshot?.recentWinRate).toBeCloseTo(0.5, 10);
		expect(snapshot?.trend).toBe("stable");
	});
});

class StubTracker extends MarketPerformanceTracker {
	private readonly stubSnapshot: PerformanceSnapshot;

	constructor(stubSnapshot: PerformanceSnapshot) {
		super();
		this.stubSnapshot = stubSnapshot;
	}

	getSnapshot(): PerformanceSnapshot {
		return this.stubSnapshot;
	}
}

describe("AdaptiveThresholdManager", () => {
	it("tightens thresholds heavily when win rate is below 0.45", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, false, false, false, false, false, false]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.15, 10);
		expect(adjusted.minProb).toBeCloseTo(0.6, 10);
		expect(adjusted.minConfidence).toBeCloseTo(0.6, 10);
	});

	it("tightens mildly when win rate is in 0.45-0.50 band", () => {
		const tracker = new StubTracker({
			totalTrades: 20,
			wins: 9,
			currentWinRate: 0.45,
			recentWinRate: 0.49,
			trend: "stable",
			avgEdge: 0.1,
			avgConfidence: 0.6,
		});
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.12, 10);
		expect(adjusted.minProb).toBeCloseTo(0.57, 10);
		expect(adjusted.minConfidence).toBeCloseTo(0.5, 10);
	});

	it("keeps thresholds unchanged in 0.50-0.55 band", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, true, false, false, false, false, false, true]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.1, 10);
		expect(adjusted.minProb).toBeCloseTo(0.55, 10);
		expect(adjusted.minConfidence).toBeCloseTo(0.5, 10);
	});

	it("loosens slightly in 0.55-0.60 band", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, true, true, false, false, false, false]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.09, 10);
	});

	it("loosens more when win rate is above 0.60", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, true, true, true, false, false, false]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.08, 10);
	});

	it("applies declining trend multiplier", () => {
		const tracker = new MarketPerformanceTracker();
		const firstTen = [true, true, true, true, true, true, true, false, false, false];
		const lastTen = [true, true, true, true, true, false, false, false, false, false];
		recordOutcomes(tracker, "BTC", [...firstTen, ...lastTen]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.11, 10);
	});

	it("applies improving trend multiplier", () => {
		const tracker = new MarketPerformanceTracker();
		const firstTen = [true, true, true, true, false, false, false, false, false, false];
		const lastTen = [true, true, true, true, true, true, false, false, false, false];
		recordOutcomes(tracker, "BTC", [...firstTen, ...lastTen]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.0855, 10);
	});

	it("applies CHOP regime multiplier", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, true, false, false, false, false, false, true]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "CHOP",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.12, 10);
	});

	it("applies LATE phase multiplier", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, true, false, false, false, false, false, true]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "LATE",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.11, 10);
	});

	it("applies compound multipliers and clamps edge threshold upper bound", () => {
		const tracker = new MarketPerformanceTracker();
		const firstTen = [true, true, true, true, true, true, false, false, false, false];
		const lastTen = [true, true, true, true, false, false, false, false, false, false];
		recordOutcomes(tracker, "BTC", [...firstTen, ...lastTen]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.12,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "LATE",
			regime: "CHOP",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.25, 10);
		expect(adjusted.minProb).toBeCloseTo(0.6, 10);
		expect(adjusted.minConfidence).toBeCloseTo(0.6, 10);
	});

	it("clamps edge threshold lower bound", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, true, true, true, false, false, false]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.03,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.03, 10);
	});

	it("clamps minProb and minConfidence upper bounds", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, false, false, false, false, false, false]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.68,
			baseMinConfidence: 0.75,
			phase: "MID",
			regime: "RANGE",
		});

		expect(adjusted.minProb).toBeCloseTo(0.7, 10);
		expect(adjusted.minConfidence).toBeCloseTo(0.8, 10);
	});

	it("uses neutral defaults when there is insufficient performance data", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, false, true, false]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "LATE",
			regime: "CHOP",
		});

		expect(adjusted.edgeThreshold).toBeCloseTo(0.132, 10);
		expect(adjusted.minProb).toBeCloseTo(0.55, 10);
		expect(adjusted.minConfidence).toBeCloseTo(0.5, 10);
	});

	it("includes formatted reason string with win rate, trend, regime, and phase", () => {
		const tracker = new MarketPerformanceTracker();
		recordOutcomes(tracker, "BTC", [true, true, true, true, false, false, false, false, false, false]);
		const manager = new AdaptiveThresholdManager(tracker);

		const adjusted = manager.getAdjustedThresholds({
			marketId: "BTC",
			baseEdgeThreshold: 0.1,
			baseMinProb: 0.55,
			baseMinConfidence: 0.5,
			phase: "MID",
			regime: "CHOP",
		});

		expect(adjusted.reason).toBe("wr=0.40_trend=stable_regime=CHOP_phase=MID");
	});
});
