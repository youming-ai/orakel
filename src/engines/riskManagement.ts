import type { Side, StopConfig, StopResult, TakeProfitConfig, TrailingStopState } from "../types.ts";
import { clamp } from "../utils.ts";

export type { StopConfig, TakeProfitConfig, TrailingStopState } from "../types.ts";

export interface StopLevel extends StopResult {}

function normalizePercent(value: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(0, value);
}

function normalizePrice(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return value;
}

export function calculateVolatilityStop(
	entryPrice: number,
	side: Side,
	volatility15m: number,
	config: StopConfig,
): StopLevel {
	const normalizedEntry = normalizePrice(entryPrice);
	if (normalizedEntry <= 0) {
		return {
			stopPrice: 0,
			stopPercent: 0,
			reason: "invalid_entry_price",
		};
	}

	if (!config.enableVolatilityStop) {
		return {
			stopPrice: 0,
			stopPercent: 0,
			reason: "volatility_stop_disabled",
		};
	}

	const minStopPercent = normalizePercent(config.minStopPercent, 0.01);
	const maxStopPercent = Math.max(minStopPercent, normalizePercent(config.maxStopPercent, 0.05));
	const multiplier = normalizePercent(config.volatilityMultiplier, 2);
	const normalizedVolatility = normalizePercent(volatility15m, 0);

	const rawStopPercent = normalizedVolatility * multiplier;
	const stopPercent = clamp(rawStopPercent, minStopPercent, maxStopPercent);
	const stopDistance = normalizedEntry * stopPercent;
	const stopPrice = side === "UP" ? normalizedEntry - stopDistance : normalizedEntry + stopDistance;

	return {
		stopPrice,
		stopPercent,
		reason: `volatility_${(rawStopPercent * 100).toFixed(2)}pct_clamped_${(stopPercent * 100).toFixed(2)}pct`,
	};
}

function checkActivation(state: TrailingStopState, currentPrice: number): boolean {
	const activationPercent = normalizePercent(state.activationPercent, 0);
	if (state.side === "UP") {
		const activationPrice = state.entryPrice * (1 + activationPercent);
		return currentPrice >= activationPrice;
	}

	const activationPrice = state.entryPrice * (1 - activationPercent);
	return currentPrice <= activationPrice;
}

export function updateTrailingStop(
	state: TrailingStopState,
	currentPrice: number,
): { stopPrice: number | null; updatedState: TrailingStopState } {
	if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
		return {
			stopPrice: null,
			updatedState: state,
		};
	}

	const trailingPercent = normalizePercent(state.trailingPercent, 0);
	const highestPrice = Math.max(state.highestPrice, currentPrice);
	const lowestPrice = Math.min(state.lowestPrice, currentPrice);
	const activated = state.activated || checkActivation(state, currentPrice);

	const updatedState: TrailingStopState = {
		...state,
		highestPrice,
		lowestPrice,
		trailingPercent,
		activated,
	};

	if (!activated) {
		return {
			stopPrice: null,
			updatedState,
		};
	}

	const stopPrice =
		state.side === "UP"
			? updatedState.highestPrice * (1 - trailingPercent)
			: updatedState.lowestPrice * (1 + trailingPercent);

	return {
		stopPrice,
		updatedState,
	};
}

export function calculateTakeProfit(
	entryPrice: number,
	side: Side,
	minutesElapsed: number,
	config: TakeProfitConfig,
): { targetPrice: number; profitPercent: number } | null {
	if (!config.enableTakeProfit) {
		return null;
	}

	const normalizedEntry = normalizePrice(entryPrice);
	if (normalizedEntry <= 0) {
		return null;
	}

	const baseProfitPercent = normalizePercent(config.baseProfitPercent, 0.03);
	const minProfitPercent = normalizePercent(config.minProfitPercent, 0.005);
	const decayRate = normalizePercent(config.decayRate, 0);
	const elapsed = Number.isFinite(minutesElapsed) ? Math.max(0, minutesElapsed) : 0;

	const decayedTarget = baseProfitPercent - elapsed * decayRate;
	const profitPercent = Math.max(minProfitPercent, decayedTarget);
	const targetPrice = side === "UP" ? normalizedEntry * (1 + profitPercent) : normalizedEntry * (1 - profitPercent);

	return {
		targetPrice,
		profitPercent,
	};
}
