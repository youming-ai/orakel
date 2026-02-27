import { AdaptiveThresholdManager, MarketPerformanceTracker } from "./engines/adaptiveThresholds.ts";
import { RegimeTransitionTracker } from "./engines/regime.ts";
import { SignalQualityModel } from "./engines/signalQuality.ts";
import type { Phase, Regime } from "./types.ts";

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

export const performanceTracker = new MarketPerformanceTracker(50);
export const adaptiveManager = new AdaptiveThresholdManager(performanceTracker);
export const signalQualityModel = new SignalQualityModel(500, 2000);
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
