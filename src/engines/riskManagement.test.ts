import { describe, expect, it } from "vitest";
import type { StopConfig, TakeProfitConfig, TrailingStopState } from "../types.ts";
import { calculateTakeProfit, calculateVolatilityStop, updateTrailingStop } from "./riskManagement.ts";

const DEFAULT_STOP_CONFIG: StopConfig = {
	volatilityMultiplier: 2,
	maxStopPercent: 0.05,
	minStopPercent: 0.01,
	enableVolatilityStop: true,
};

const DEFAULT_TAKE_PROFIT_CONFIG: TakeProfitConfig = {
	baseProfitPercent: 0.03,
	decayRate: 0.002,
	minProfitPercent: 0.005,
	enableTakeProfit: true,
};

function makeTrailingState(overrides: Partial<TrailingStopState> = {}): TrailingStopState {
	return {
		entryPrice: 100,
		side: "UP",
		highestPrice: 100,
		lowestPrice: 100,
		trailingPercent: 0.02,
		activated: false,
		activationPercent: 0.01,
		...overrides,
	};
}

describe("calculateVolatilityStop", () => {
	it("calculates UP stop using volatility distance", () => {
		const result = calculateVolatilityStop(100, "UP", 0.01, DEFAULT_STOP_CONFIG);

		expect(result.stopPercent).toBeCloseTo(0.02, 8);
		expect(result.stopPrice).toBeCloseTo(98, 8);
	});

	it("calculates DOWN stop using volatility distance", () => {
		const result = calculateVolatilityStop(100, "DOWN", 0.01, DEFAULT_STOP_CONFIG);

		expect(result.stopPercent).toBeCloseTo(0.02, 8);
		expect(result.stopPrice).toBeCloseTo(102, 8);
	});

	it("clamps to minimum stop percent when volatility is very low", () => {
		const result = calculateVolatilityStop(100, "UP", 0.0001, DEFAULT_STOP_CONFIG);

		expect(result.stopPercent).toBeCloseTo(0.01, 8);
		expect(result.stopPrice).toBeCloseTo(99, 8);
	});

	it("clamps to maximum stop percent when volatility is very high", () => {
		const result = calculateVolatilityStop(100, "UP", 0.05, DEFAULT_STOP_CONFIG);

		expect(result.stopPercent).toBeCloseTo(0.05, 8);
		expect(result.stopPrice).toBeCloseTo(95, 8);
	});

	it("clamps zero volatility to minimum stop percent", () => {
		const result = calculateVolatilityStop(100, "DOWN", 0, DEFAULT_STOP_CONFIG);

		expect(result.stopPercent).toBeCloseTo(0.01, 8);
		expect(result.stopPrice).toBeCloseTo(101, 8);
	});

	it("returns neutral level when volatility stop is disabled", () => {
		const result = calculateVolatilityStop(100, "UP", 0.02, {
			...DEFAULT_STOP_CONFIG,
			enableVolatilityStop: false,
		});

		expect(result.stopPercent).toBe(0);
		expect(result.stopPrice).toBe(0);
		expect(result.reason).toBe("volatility_stop_disabled");
	});

	it("returns invalid marker for non-positive entry price", () => {
		const result = calculateVolatilityStop(0, "UP", 0.02, DEFAULT_STOP_CONFIG);

		expect(result.stopPrice).toBe(0);
		expect(result.stopPercent).toBe(0);
		expect(result.reason).toBe("invalid_entry_price");
	});

	it("normalizes negative volatility multiplier to zero before clamping", () => {
		const result = calculateVolatilityStop(100, "UP", 0.02, {
			...DEFAULT_STOP_CONFIG,
			volatilityMultiplier: -2,
		});

		expect(result.stopPercent).toBeCloseTo(0.01, 8);
		expect(result.stopPrice).toBeCloseTo(99, 8);
	});

	it("uses min stop percent when max stop percent is below min", () => {
		const result = calculateVolatilityStop(100, "UP", 0.04, {
			...DEFAULT_STOP_CONFIG,
			maxStopPercent: 0.005,
			minStopPercent: 0.02,
		});

		expect(result.stopPercent).toBeCloseTo(0.02, 8);
		expect(result.stopPrice).toBeCloseTo(98, 8);
	});
});

describe("updateTrailingStop", () => {
	it("tracks highest price for UP trade before activation", () => {
		const state = makeTrailingState();
		const result = updateTrailingStop(state, 100.5);

		expect(result.updatedState.highestPrice).toBeCloseTo(100.5, 8);
		expect(result.updatedState.activated).toBe(false);
		expect(result.stopPrice).toBeNull();
	});

	it("tracks lowest price for DOWN trade before activation", () => {
		const state = makeTrailingState({ side: "DOWN" });
		const result = updateTrailingStop(state, 99.7);

		expect(result.updatedState.lowestPrice).toBeCloseTo(99.7, 8);
		expect(result.updatedState.activated).toBe(false);
		expect(result.stopPrice).toBeNull();
	});

	it("activates UP trailing stop at activation threshold", () => {
		const state = makeTrailingState();
		const result = updateTrailingStop(state, 101);

		expect(result.updatedState.activated).toBe(true);
		expect(result.stopPrice).toBeCloseTo(98.98, 8);
	});

	it("activates DOWN trailing stop at activation threshold", () => {
		const state = makeTrailingState({ side: "DOWN" });
		const result = updateTrailingStop(state, 99);

		expect(result.updatedState.activated).toBe(true);
		expect(result.stopPrice).toBeCloseTo(100.98, 8);
	});

	it("does not activate UP trailing stop when threshold not met", () => {
		const state = makeTrailingState();
		const result = updateTrailingStop(state, 100.99);

		expect(result.updatedState.activated).toBe(false);
		expect(result.stopPrice).toBeNull();
	});

	it("does not activate DOWN trailing stop when threshold not met", () => {
		const state = makeTrailingState({ side: "DOWN" });
		const result = updateTrailingStop(state, 99.01);

		expect(result.updatedState.activated).toBe(false);
		expect(result.stopPrice).toBeNull();
	});

	it("moves UP trailing stop upward when a new high is made", () => {
		const state = makeTrailingState({ activated: true, highestPrice: 102 });
		const result = updateTrailingStop(state, 103);

		expect(result.updatedState.highestPrice).toBe(103);
		expect(result.stopPrice).toBeCloseTo(100.94, 8);
	});

	it("keeps UP trailing stop unchanged when price pulls back", () => {
		const state = makeTrailingState({ activated: true, highestPrice: 103 });
		const result = updateTrailingStop(state, 102);

		expect(result.updatedState.highestPrice).toBe(103);
		expect(result.stopPrice).toBeCloseTo(100.94, 8);
	});

	it("moves DOWN trailing stop downward when a new low is made", () => {
		const state = makeTrailingState({ side: "DOWN", activated: true, lowestPrice: 98 });
		const result = updateTrailingStop(state, 97);

		expect(result.updatedState.lowestPrice).toBe(97);
		expect(result.stopPrice).toBeCloseTo(98.94, 8);
	});

	it("keeps DOWN trailing stop unchanged when price rebounds", () => {
		const state = makeTrailingState({ side: "DOWN", activated: true, lowestPrice: 97 });
		const result = updateTrailingStop(state, 98);

		expect(result.updatedState.lowestPrice).toBe(97);
		expect(result.stopPrice).toBeCloseTo(98.94, 8);
	});

	it("returns original state and null stop for invalid current price", () => {
		const state = makeTrailingState({ activated: true, highestPrice: 105 });
		const result = updateTrailingStop(state, Number.NaN);

		expect(result.updatedState).toBe(state);
		expect(result.stopPrice).toBeNull();
	});

	it("normalizes negative trailing percent to zero", () => {
		const state = makeTrailingState({ activated: true, highestPrice: 102, trailingPercent: -0.1 });
		const result = updateTrailingStop(state, 102);

		expect(result.updatedState.trailingPercent).toBe(0);
		expect(result.stopPrice).toBe(102);
	});

	it("activates immediately when activation percent is zero and trade is favorable", () => {
		const state = makeTrailingState({ activationPercent: 0 });
		const result = updateTrailingStop(state, 100.1);

		expect(result.updatedState.activated).toBe(true);
		expect(result.stopPrice).toBeCloseTo(98.098, 8);
	});

	it("preserves existing activated state regardless of current move", () => {
		const state = makeTrailingState({ activated: true, highestPrice: 104 });
		const result = updateTrailingStop(state, 99);

		expect(result.updatedState.activated).toBe(true);
		expect(result.stopPrice).toBeCloseTo(101.92, 8);
	});
});

describe("calculateTakeProfit", () => {
	it("returns null when take-profit is disabled", () => {
		const result = calculateTakeProfit(100, "UP", 5, {
			...DEFAULT_TAKE_PROFIT_CONFIG,
			enableTakeProfit: false,
		});

		expect(result).toBeNull();
	});

	it("calculates initial UP target with zero elapsed minutes", () => {
		const result = calculateTakeProfit(100, "UP", 0, DEFAULT_TAKE_PROFIT_CONFIG);

		expect(result).not.toBeNull();
		expect(result?.profitPercent).toBeCloseTo(0.03, 8);
		expect(result?.targetPrice).toBeCloseTo(103, 8);
	});

	it("calculates initial DOWN target with zero elapsed minutes", () => {
		const result = calculateTakeProfit(100, "DOWN", 0, DEFAULT_TAKE_PROFIT_CONFIG);

		expect(result).not.toBeNull();
		expect(result?.profitPercent).toBeCloseTo(0.03, 8);
		expect(result?.targetPrice).toBeCloseTo(97, 8);
	});

	it("decays target over time before reaching floor", () => {
		const result = calculateTakeProfit(100, "UP", 5, DEFAULT_TAKE_PROFIT_CONFIG);

		expect(result?.profitPercent).toBeCloseTo(0.02, 8);
		expect(result?.targetPrice).toBeCloseTo(102, 8);
	});

	it("clamps target to minimum profit floor after long elapsed time", () => {
		const result = calculateTakeProfit(100, "UP", 60, DEFAULT_TAKE_PROFIT_CONFIG);

		expect(result?.profitPercent).toBeCloseTo(0.005, 8);
		expect(result?.targetPrice).toBeCloseTo(100.5, 8);
	});

	it("clamps negative elapsed minutes to zero", () => {
		const result = calculateTakeProfit(100, "UP", -10, DEFAULT_TAKE_PROFIT_CONFIG);

		expect(result?.profitPercent).toBeCloseTo(0.03, 8);
		expect(result?.targetPrice).toBeCloseTo(103, 8);
	});

	it("treats negative decay rate as zero", () => {
		const result = calculateTakeProfit(100, "UP", 10, {
			...DEFAULT_TAKE_PROFIT_CONFIG,
			decayRate: -0.002,
		});

		expect(result?.profitPercent).toBeCloseTo(0.03, 8);
		expect(result?.targetPrice).toBeCloseTo(103, 8);
	});

	it("uses minimum profit when base profit is negative", () => {
		const result = calculateTakeProfit(100, "UP", 0, {
			...DEFAULT_TAKE_PROFIT_CONFIG,
			baseProfitPercent: -0.01,
			minProfitPercent: 0.006,
		});

		expect(result?.profitPercent).toBeCloseTo(0.006, 8);
		expect(result?.targetPrice).toBeCloseTo(100.6, 8);
	});

	it("returns null for invalid entry price", () => {
		const result = calculateTakeProfit(0, "UP", 5, DEFAULT_TAKE_PROFIT_CONFIG);

		expect(result).toBeNull();
	});
});
