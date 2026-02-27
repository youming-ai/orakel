import type { PositionSizeResult, Side } from "../types.ts";

export type { PositionSizeResult } from "../types.ts";

export interface PositionSizingParams {
	winProbability: number;
	avgWinPayout: number;
	avgLossPayout: number;
	bankroll: number;
	maxSize: number;
	minSize?: number;
	kellyFraction?: number;
	confidence?: number;
	regime?: string | null;
	side?: Side;
}

const DEFAULT_MIN_SIZE = 0.5;
const DEFAULT_KELLY_FRACTION = 0.5;
const MAX_BANKROLL_RISK_PER_TRADE = 0.25;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function confidenceMultiplier(confidence: number): number {
	if (confidence >= 0.8) return 1.2;
	if (confidence >= 0.5) return 1;
	return 0.6;
}

function regimeMultiplier(regime: string | null | undefined, side: Side | undefined): number {
	if (!regime) return 1;

	if (regime === "CHOP") return 0.5;
	if (regime === "RANGE") return 0.8;
	if (regime === "TREND") return 1.1;
	if (regime === "TREND_ALIGNED") return 1.1;
	if (regime === "TREND_OPPOSED") return 0.6;

	if (regime === "TREND_UP" || regime === "TREND_DOWN") {
		if (!side) return 1.1;
		const aligned = (regime === "TREND_UP" && side === "UP") || (regime === "TREND_DOWN" && side === "DOWN");
		return aligned ? 1.1 : 0.6;
	}

	return 1;
}

export function calculateKellyPositionSize(params: PositionSizingParams): PositionSizeResult {
	const minSize = Number.isFinite(params.minSize) ? Math.max(0, Number(params.minSize)) : DEFAULT_MIN_SIZE;
	const maxSizeInput = Number(params.maxSize);
	const maxSize = Number.isFinite(maxSizeInput) ? Math.max(minSize, maxSizeInput) : minSize;
	const bankrollInput = Number(params.bankroll);
	const bankroll = Number.isFinite(bankrollInput) ? Math.max(0, bankrollInput) : 0;

	const p = Number(params.winProbability);
	const avgWinPayout = Number(params.avgWinPayout);
	const avgLossPayout = Number(params.avgLossPayout);

	if (
		!Number.isFinite(p) ||
		!Number.isFinite(avgWinPayout) ||
		!Number.isFinite(avgLossPayout) ||
		avgWinPayout <= 0 ||
		avgLossPayout <= 0
	) {
		return {
			size: 0,
			rawKelly: 0,
			adjustedKelly: 0,
			reason: "invalid_inputs",
		};
	}

	const pClamped = clamp(p, 0, 1);
	const q = 1 - pClamped;
	const b = avgWinPayout / avgLossPayout;
	const rawKelly = (b * pClamped - q) / b;

	if (!Number.isFinite(rawKelly) || rawKelly <= 0) {
		return {
			size: 0,
			rawKelly,
			adjustedKelly: 0,
			reason: "negative_edge",
		};
	}

	const kellyFraction = Number.isFinite(params.kellyFraction)
		? clamp(Number(params.kellyFraction), 0, 1)
		: DEFAULT_KELLY_FRACTION;
	const confidence = Number.isFinite(params.confidence) ? clamp(Number(params.confidence), 0, 1) : 0.5;

	const adjustedKellyRaw =
		rawKelly * kellyFraction * confidenceMultiplier(confidence) * regimeMultiplier(params.regime, params.side);
	const adjustedKelly = clamp(adjustedKellyRaw, 0, MAX_BANKROLL_RISK_PER_TRADE);
	const sizeRaw = adjustedKelly * bankroll;
	const size = clamp(sizeRaw, minSize, maxSize);

	return {
		size,
		rawKelly,
		adjustedKelly,
		reason: "kelly_sized",
	};
}
