import type { RiskConfigDto, StrategyConfig } from "@orakel/shared/contracts";
import { describe, expect, it } from "vitest";
import type { DecisionInput } from "./decision.ts";
import { makeTradeDecision } from "./decision.ts";

/**
 * Factory helper to create a valid base DecisionInput with sensible defaults.
 * Override any field to test specific scenarios.
 */
function makeDecisionInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
	const defaultStrategy: StrategyConfig = {
		edgeThresholdEarly: 0.02,
		edgeThresholdMid: 0.015,
		edgeThresholdLate: 0.01,
		phaseEarlySeconds: 60,
		phaseLateSeconds: 30,
		sigmoidScale: 1.0,
		minVolatility: 0.001,
		maxEntryPrice: 0.95,
		minTimeLeftSeconds: 10,
		maxTimeLeftSeconds: 290,
	};

	const defaultRisk: RiskConfigDto = {
		maxTradeSizeUsdc: 100,
		dailyMaxLossUsdc: 500,
		maxOpenPositions: 5,
		maxTradesPerWindow: 2,
	};

	return {
		modelProbUp: 0.6,
		marketProbUp: 0.5,
		timeLeftSeconds: 150,
		phase: "MID",
		strategy: defaultStrategy,
		risk: defaultRisk,
		hasPositionInWindow: false,
		todayLossUsdc: 0,
		openPositions: 0,
		tradesInWindow: 0,
		...overrides,
	};
}

describe("makeTradeDecision", () => {
	describe("Position in window check", () => {
		it("should return SKIP with reason 'already has position in window' when hasPositionInWindow is true", () => {
			const input = makeDecisionInput({ hasPositionInWindow: true });
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toBe("already has position in window");
		});
	});

	describe("Daily loss limit check", () => {
		it("should return SKIP with reason 'daily loss limit reached' when todayLossUsdc >= dailyMaxLossUsdc", () => {
			const input = makeDecisionInput({
				todayLossUsdc: 500,
				risk: { ...makeDecisionInput().risk, dailyMaxLossUsdc: 500 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toBe("daily loss limit reached");
		});

		it("should return SKIP when todayLossUsdc exceeds dailyMaxLossUsdc", () => {
			const input = makeDecisionInput({
				todayLossUsdc: 600,
				risk: { ...makeDecisionInput().risk, dailyMaxLossUsdc: 500 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.reason).toBe("daily loss limit reached");
		});
	});

	describe("Max open positions check", () => {
		it("should return SKIP with reason 'max open positions reached' when openPositions >= maxOpenPositions", () => {
			const input = makeDecisionInput({
				openPositions: 5,
				risk: { ...makeDecisionInput().risk, maxOpenPositions: 5 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toBe("max open positions reached");
		});

		it("should return SKIP when openPositions exceeds maxOpenPositions", () => {
			const input = makeDecisionInput({
				openPositions: 6,
				risk: { ...makeDecisionInput().risk, maxOpenPositions: 5 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.reason).toBe("max open positions reached");
		});
	});

	describe("Max trades per window check", () => {
		it("should return SKIP with reason 'max trades per window reached' when tradesInWindow >= maxTradesPerWindow", () => {
			const input = makeDecisionInput({
				tradesInWindow: 2,
				risk: { ...makeDecisionInput().risk, maxTradesPerWindow: 2 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toBe("max trades per window reached");
		});

		it("should return SKIP when tradesInWindow exceeds maxTradesPerWindow", () => {
			const input = makeDecisionInput({
				tradesInWindow: 3,
				risk: { ...makeDecisionInput().risk, maxTradesPerWindow: 2 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.reason).toBe("max trades per window reached");
		});
	});

	describe("Time bounds checks", () => {
		it("should return SKIP with reason 'time: too close to window end' when timeLeftSeconds < minTimeLeftSeconds", () => {
			const input = makeDecisionInput({
				timeLeftSeconds: 5,
				strategy: { ...makeDecisionInput().strategy, minTimeLeftSeconds: 10 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toBe("time: too close to window end");
		});

		it("should return SKIP with reason 'time: too far from window end' when timeLeftSeconds > maxTimeLeftSeconds", () => {
			const input = makeDecisionInput({
				timeLeftSeconds: 300,
				strategy: { ...makeDecisionInput().strategy, maxTimeLeftSeconds: 290 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toBe("time: too far from window end");
		});

		it("should pass time bounds check when timeLeftSeconds is within range", () => {
			const input = makeDecisionInput({
				timeLeftSeconds: 150,
				strategy: { ...makeDecisionInput().strategy, minTimeLeftSeconds: 10, maxTimeLeftSeconds: 290 },
			});
			const result = makeTradeDecision(input);

			// Should not fail on time bounds, but may fail on other checks
			if (result.reason) {
				expect(result.reason).not.toContain("time:");
			}
		});
	});

	describe("Price too extreme check", () => {
		it("should return SKIP with price reason when entryPrice > maxEntryPrice for UP side", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.98, // High prob UP
				marketProbUp: 0.97, // Market also high, so entryPrice = 0.97
				strategy: { ...makeDecisionInput().strategy, maxEntryPrice: 0.95 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toContain("price too extreme");
			expect(result.reason).toContain("0.97");
			expect(result.reason).toContain("0.95");
		});

		it("should return SKIP with price reason when entryPrice > maxEntryPrice for DOWN side", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.02, // Low prob UP (high prob DOWN)
				marketProbUp: 0.03, // Market also low, so entryPrice = 1 - 0.03 = 0.97
				strategy: { ...makeDecisionInput().strategy, maxEntryPrice: 0.95 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toContain("price too extreme");
		});
	});

	describe("Edge threshold checks by phase", () => {
		it("should return SKIP with edge reason in EARLY phase when bestEdge < edgeThresholdEarly", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.52,
				marketProbUp: 0.5,
				phase: "EARLY",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdEarly: 0.05 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toContain("edge");
			expect(result.reason).toContain("EARLY");
		});

		it("should return SKIP with edge reason in MID phase when bestEdge < edgeThresholdMid", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.52,
				marketProbUp: 0.5,
				phase: "MID",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdMid: 0.05 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toContain("edge");
			expect(result.reason).toContain("MID");
		});

		it("should return SKIP with edge reason in LATE phase when bestEdge < edgeThresholdLate", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.52,
				marketProbUp: 0.5,
				phase: "LATE",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdLate: 0.05 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.side).toBeNull();
			expect(result.reason).toContain("edge");
			expect(result.reason).toContain("LATE");
		});
	});

	describe("Successful ENTER_UP decision", () => {
		it("should return ENTER_UP when all conditions pass and modelProbUp > marketProbUp (UP edge)", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.65,
				marketProbUp: 0.5,
				timeLeftSeconds: 150,
				phase: "MID",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdMid: 0.01 },
				hasPositionInWindow: false,
				todayLossUsdc: 0,
				openPositions: 0,
				tradesInWindow: 0,
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("ENTER_UP");
			expect(result.side).toBe("UP");
			expect(result.reason).toBeNull();
			expect(result.edge).toBeGreaterThan(0);
		});

		it("should calculate correct edge for ENTER_UP", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.65,
				marketProbUp: 0.5,
				timeLeftSeconds: 150,
				phase: "MID",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdMid: 0.01 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("ENTER_UP");
			expect(result.edge).toBeCloseTo(0.15, 4); // 0.65 - 0.5 = 0.15
		});
	});

	describe("Successful ENTER_DOWN decision", () => {
		it("should return ENTER_DOWN when all conditions pass and modelProbUp < marketProbUp (DOWN edge)", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.35,
				marketProbUp: 0.5,
				timeLeftSeconds: 150,
				phase: "MID",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdMid: 0.01 },
				hasPositionInWindow: false,
				todayLossUsdc: 0,
				openPositions: 0,
				tradesInWindow: 0,
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("ENTER_DOWN");
			expect(result.side).toBe("DOWN");
			expect(result.reason).toBeNull();
			expect(result.edge).toBeGreaterThan(0);
		});

		it("should calculate correct edge for ENTER_DOWN", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.35,
				marketProbUp: 0.5,
				timeLeftSeconds: 150,
				phase: "MID",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdMid: 0.01 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("ENTER_DOWN");
			expect(result.edge).toBeCloseTo(0.15, 4); // 0.5 - 0.35 = 0.15
		});
	});

	describe("Edge case: equal probabilities", () => {
		it("should return ENTER_UP when modelProbUp equals marketProbUp (edge = 0, but UP is chosen by tie-break)", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.5,
				marketProbUp: 0.5,
				timeLeftSeconds: 150,
				phase: "MID",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdMid: 0 },
			});
			const result = makeTradeDecision(input);

			// When edgeUp === edgeDown, bestSide is "UP" (tie-break in computeEdge)
			expect(result.decision).toBe("ENTER_UP");
			expect(result.side).toBe("UP");
			expect(result.edge).toBeCloseTo(0, 4);
		});
	});

	describe("Check ordering: time bounds before position check", () => {
		it("should check time bounds before position in window", () => {
			const input = makeDecisionInput({
				timeLeftSeconds: 5,
				hasPositionInWindow: true,
				strategy: { ...makeDecisionInput().strategy, minTimeLeftSeconds: 10 },
			});
			const result = makeTradeDecision(input);

			// Time bounds are checked first, so should fail on time, not position
			expect(result.reason).toBe("time: too close to window end");
		});
	});

	describe("Check ordering: position/risk checks before price/edge checks", () => {
		it("should check position in window before price extreme", () => {
			const input = makeDecisionInput({
				hasPositionInWindow: true,
				modelProbUp: 0.98,
				marketProbUp: 0.97,
				strategy: { ...makeDecisionInput().strategy, maxEntryPrice: 0.95 },
			});
			const result = makeTradeDecision(input);

			// Position check comes before price check
			expect(result.reason).toBe("already has position in window");
		});

		it("should check daily loss limit before price extreme", () => {
			const input = makeDecisionInput({
				todayLossUsdc: 500,
				modelProbUp: 0.98,
				marketProbUp: 0.97,
				risk: { ...makeDecisionInput().risk, dailyMaxLossUsdc: 500 },
				strategy: { ...makeDecisionInput().strategy, maxEntryPrice: 0.95 },
			});
			const result = makeTradeDecision(input);

			// Daily loss check comes before price check
			expect(result.reason).toBe("daily loss limit reached");
		});
	});

	describe("Edge is always returned in result", () => {
		it("should return edge even when decision is SKIP", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.65,
				marketProbUp: 0.5,
				hasPositionInWindow: true,
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("SKIP");
			expect(result.edge).toBeCloseTo(0.15, 4); // Still computed
		});

		it("should return edge when decision is ENTER_UP", () => {
			const input = makeDecisionInput({
				modelProbUp: 0.65,
				marketProbUp: 0.5,
				timeLeftSeconds: 150,
				phase: "MID",
				strategy: { ...makeDecisionInput().strategy, edgeThresholdMid: 0.01 },
			});
			const result = makeTradeDecision(input);

			expect(result.decision).toBe("ENTER_UP");
			expect(result.edge).toBeCloseTo(0.15, 4);
		});
	});
});
