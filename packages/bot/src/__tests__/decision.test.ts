import type { RiskConfigDto, StrategyConfig } from "@orakel/shared/contracts";
import { describe, expect, it } from "vitest";
import { makeTradeDecision } from "../engine/decision.ts";

function makeStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
	return {
		edgeThresholdEarly: 0.08,
		edgeThresholdMid: 0.05,
		edgeThresholdLate: 0.03,
		phaseEarlySeconds: 180,
		phaseLateSeconds: 60,
		sigmoidScale: 5.0,
		minVolatility: 0.0001,
		maxEntryPrice: 0.92,
		minTimeLeftSeconds: 15,
		maxTimeLeftSeconds: 270,
		...overrides,
	};
}

function makeRisk(overrides: Partial<RiskConfigDto> = {}): RiskConfigDto {
	return {
		maxTradeSizeUsdc: 5,
		dailyMaxLossUsdc: 100,
		maxOpenPositions: 1,
		maxTradesPerWindow: 1,
		...overrides,
	};
}

describe("makeTradeDecision", () => {
	it("returns ENTER_UP when edge exceeds LATE threshold", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.7,
			marketProbUp: 0.55,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy(),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("ENTER_UP");
		expect(result.side).toBe("UP");
	});

	it("returns SKIP when edge below threshold", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.52,
			marketProbUp: 0.5,
			timeLeftSeconds: 200,
			phase: "EARLY",
			strategy: makeStrategy(),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("edge");
	});

	it("returns SKIP when already has position in window", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.9,
			marketProbUp: 0.5,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy(),
			risk: makeRisk(),
			hasPositionInWindow: true,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 1,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("position");
	});

	it("returns SKIP when daily loss limit reached", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.9,
			marketProbUp: 0.5,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy(),
			risk: makeRisk({ dailyMaxLossUsdc: 50 }),
			hasPositionInWindow: false,
			todayLossUsdc: 50,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("daily loss");
	});

	it("returns SKIP when market price too extreme", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.98,
			marketProbUp: 0.95,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy({ maxEntryPrice: 0.92 }),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("price");
	});

	it("returns SKIP when time outside allowed window", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.9,
			marketProbUp: 0.5,
			timeLeftSeconds: 5,
			phase: "LATE",
			strategy: makeStrategy({ minTimeLeftSeconds: 15 }),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("time");
	});
});
