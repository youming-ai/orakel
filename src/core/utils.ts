import type { CandleWindowTiming } from "./marketDataTypes.ts";

export function clamp(x: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, x));
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatNumber(x: number | null | undefined, digits = 0): string {
	if (x === null || x === undefined || Number.isNaN(x)) return "-";
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(x);
}

export function formatPct(x: number | null | undefined, digits = 2): string {
	if (x === null || x === undefined || Number.isNaN(x)) return "-";
	return `${(x * 100).toFixed(digits)}%`;
}

export function getCandleWindowTiming(windowMinutes: number): CandleWindowTiming {
	const nowMs = Date.now();
	const windowMs = windowMinutes * 60_000;
	const startMs = Math.floor(nowMs / windowMs) * windowMs;
	const endMs = startMs + windowMs;
	const elapsedMs = nowMs - startMs;
	const remainingMs = endMs - nowMs;
	return {
		startMs,
		endMs,
		elapsedMs,
		remainingMs,
		elapsedMinutes: elapsedMs / 60_000,
		remainingMinutes: remainingMs / 60_000,
	};
}
