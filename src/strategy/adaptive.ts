import { RegimeTransitionTracker } from "../engines/regime.ts";
import type { Phase, Regime } from "../types.ts";
export interface SignalMetadata {
	edge: number;
	confidence: number;
	phase: Phase;
	regime: Regime | null;
	volatility15m?: number;
	modelUp?: number;
	orderbookImbalance?: number | null;
	rsi?: number | null;
	vwapSlope?: number | null;
}

const regimeTrackers = new Map<string, RegimeTransitionTracker>();

/** Get or create a per-market RegimeTransitionTracker. */
export function getRegimeTransitionTracker(marketId: string): RegimeTransitionTracker {
	let tracker = regimeTrackers.get(marketId);
	if (!tracker) {
		tracker = new RegimeTransitionTracker(100);
		regimeTrackers.set(marketId, tracker);
	}
	return tracker;
}
export const tradeSignalMetadata = new Map<string, SignalMetadata>();

export function storeSignalMetadata(tradeId: string, meta: SignalMetadata): void {
	tradeSignalMetadata.set(tradeId, meta);
}

export function getAndClearSignalMetadata(tradeId: string): SignalMetadata | null {
	const meta = tradeSignalMetadata.get(tradeId) ?? null;
	if (meta) {
		tradeSignalMetadata.delete(tradeId);
	}
	return meta;
}
