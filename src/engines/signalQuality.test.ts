import { describe, expect, it } from "vitest";
import type { HistoricalSignal, SignalFeatures } from "./signalQuality.ts";
import { computeSimilarity, SignalQualityModel } from "./signalQuality.ts";

function makeFeatures(overrides: Partial<SignalFeatures> = {}): SignalFeatures {
	return {
		marketId: "BTC",
		edge: 0.12,
		confidence: 0.62,
		volatility15m: 0.005,
		phase: "MID",
		regime: "RANGE",
		modelUp: 0.58,
		orderbookImbalance: 0.1,
		rsi: 54,
		vwapSlope: 0.03,
		...overrides,
	};
}

function makeHistoricalSignal(overrides: Partial<HistoricalSignal> = {}): HistoricalSignal {
	return {
		...makeFeatures(),
		won: true,
		pnl: 0.3,
		timestamp: Date.now(),
		...overrides,
	};
}

describe("SignalQualityModel", () => {
	it("initializes with default constructor parameters", () => {
		const model = new SignalQualityModel();
		expect(model.getHistorySize()).toBe(0);
		expect(model.getMarketHistorySize("BTC")).toBe(0);
	});

	it("recordOutcome adds signals to history and market history", () => {
		const model = new SignalQualityModel();
		model.recordOutcome(makeHistoricalSignal({ marketId: "BTC" }));
		model.recordOutcome(makeHistoricalSignal({ marketId: "ETH" }));

		expect(model.getHistorySize()).toBe(2);
		expect(model.getMarketHistorySize("BTC")).toBe(1);
		expect(model.getMarketHistorySize("ETH")).toBe(1);
	});

	it("predictWinRate returns INSUFFICIENT when less than 10 samples exist", () => {
		const model = new SignalQualityModel();
		for (let i = 0; i < 9; i += 1) {
			model.recordOutcome(makeHistoricalSignal({ won: i % 2 === 0 }));
		}

		const result = model.predictWinRate(makeFeatures());
		expect(result.confidence).toBe("INSUFFICIENT");
		expect(result.predictedWinRate).toBe(0.5);
		expect(result.sampleSize).toBe(9);
	});

	it("predictWinRate returns valid result with enough data", () => {
		const model = new SignalQualityModel();
		for (let i = 0; i < 20; i += 1) {
			model.recordOutcome(
				makeHistoricalSignal({
					won: i < 14,
					modelUp: 0.55 + i * 0.001,
				}),
			);
		}

		const result = model.predictWinRate(makeFeatures(), 20);
		expect(result.confidence).not.toBe("INSUFFICIENT");
		expect(result.sampleSize).toBe(20);
		expect(result.avgSimilarity).toBeGreaterThan(0);
		expect(result.predictedWinRate).toBeGreaterThan(0.5);
		expect(result.predictedWinRate).toBeLessThanOrEqual(1);
	});

	it("computeSimilarity returns 1 for identical features", () => {
		const features = makeFeatures();
		const historical = makeHistoricalSignal(features);
		expect(computeSimilarity(features, historical)).toBe(1);
	});

	it("computeSimilarity returns low value for very different features", () => {
		const f1 = makeFeatures({
			edge: 0,
			confidence: 0,
			volatility15m: 0,
			phase: "EARLY",
			regime: "TREND_UP",
			modelUp: 0.01,
			rsi: 1,
			vwapSlope: -1,
		});
		const f2 = makeHistoricalSignal({
			marketId: "ETH",
			edge: 1,
			confidence: 1,
			volatility15m: 0.1,
			phase: "LATE",
			regime: "CHOP",
			modelUp: 0.99,
			rsi: 99,
			vwapSlope: 1,
		});

		expect(computeSimilarity(f1, f2)).toBeLessThan(0.1);
	});

	it("getPerformanceByGroup returns grouped metrics by market", () => {
		const model = new SignalQualityModel();
		for (let i = 0; i < 6; i += 1) {
			model.recordOutcome(makeHistoricalSignal({ marketId: "BTC", won: i < 4, edge: 0.1 + i * 0.01, pnl: 0.2 }));
		}

		const result = model.getPerformanceByGroup({ marketId: "BTC" });
		expect(result).not.toBeNull();
		expect(result?.count).toBe(6);
		expect(result?.winRate).toBeCloseTo(4 / 6, 8);
	});

	it("getPerformanceByGroup supports regime filter", () => {
		const model = new SignalQualityModel();
		for (let i = 0; i < 5; i += 1) {
			model.recordOutcome(makeHistoricalSignal({ regime: "RANGE", won: true, pnl: 0.4 }));
		}
		for (let i = 0; i < 5; i += 1) {
			model.recordOutcome(makeHistoricalSignal({ regime: "CHOP", won: false, pnl: -0.3 }));
		}

		const rangePerformance = model.getPerformanceByGroup({ regime: "RANGE" });
		const chopPerformance = model.getPerformanceByGroup({ regime: "CHOP" });
		expect(rangePerformance?.winRate).toBe(1);
		expect(chopPerformance?.winRate).toBe(0);
	});

	it("enforces per-market and total history limits", () => {
		const model = new SignalQualityModel(3, 5);
		for (let i = 0; i < 6; i += 1) {
			model.recordOutcome(makeHistoricalSignal({ marketId: "BTC", timestamp: i }));
		}
		for (let i = 6; i < 10; i += 1) {
			model.recordOutcome(makeHistoricalSignal({ marketId: "ETH", timestamp: i }));
		}

		expect(model.getMarketHistorySize("BTC")).toBeLessThanOrEqual(3);
		expect(model.getMarketHistorySize("ETH")).toBeLessThanOrEqual(3);
		expect(model.getHistorySize()).toBeLessThanOrEqual(5);
	});

	it("KNN predicts above 0.5 with mostly winning nearest neighbors", () => {
		const model = new SignalQualityModel();
		for (let i = 0; i < 20; i += 1) {
			model.recordOutcome(
				makeHistoricalSignal({
					won: true,
					edge: 0.12 + i * 0.0002,
					confidence: 0.62,
					volatility15m: 0.005,
					modelUp: 0.58,
				}),
			);
		}
		for (let i = 0; i < 5; i += 1) {
			model.recordOutcome(
				makeHistoricalSignal({
					won: false,
					edge: 0.7,
					confidence: 0.2,
					volatility15m: 0.03,
					modelUp: 0.2,
					phase: "LATE",
					regime: "CHOP",
				}),
			);
		}

		const result = model.predictWinRate(makeFeatures());
		expect(result.predictedWinRate).toBeGreaterThan(0.5);
	});
});
