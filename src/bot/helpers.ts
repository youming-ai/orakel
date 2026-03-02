import { CONFIG, getConfigForTimeframe } from "../core/config.ts";
import type { MarketState } from "../pipeline/processMarket.ts";
import type { AppConfig, RiskConfig, TimeframeId } from "../types.ts";

export interface SimpleOrderTracker {
	orders: Map<string, number>;
	lastTradeMs: number;
	cooldownMs: number;
	keyFor(marketId: string, windowSlug: string): string;
	hasOrder(marketId: string, windowSlug: string): boolean;
	totalActive(): number;
	record(marketId: string, windowSlug: string): void;
	prune(): void;
	onCooldown(): boolean;
}

export function createTradeTracker() {
	return {
		markets: new Set<string>(),
		windowStartMs: 0,
		globalCount: 0,
		clear() {
			this.markets.clear();
			this.globalCount = 0;
			this.windowStartMs = 0;
		},
		setWindow(startMs: number) {
			if (this.windowStartMs !== startMs) {
				this.clear();
				this.windowStartMs = startMs;
			}
		},
		has(marketId: string, startMs: number): boolean {
			return this.markets.has(`${marketId}:${startMs}`);
		},
		record(marketId: string, startMs: number) {
			this.markets.add(`${marketId}:${startMs}`);
			this.globalCount++;
		},
		canTradeGlobally(maxGlobal: number): boolean {
			return this.globalCount < maxGlobal;
		},
	};
}

export type TradeTracker = ReturnType<typeof createTradeTracker>;

export interface TickContext {
	enabledTimeframes: TimeframeId[];
	timeframeConfigs: Map<TimeframeId, AppConfig>;
	paperRisk: RiskConfig;
	liveRisk: RiskConfig;
	clobBaseUrl: string;
	pollIntervalMs: number;
	safeModeThreshold: number;
}

export function createInitialMarketState(): MarketState {
	return {
		prevSpotPrice: null,
		prevCurrentPrice: null,
		priceToBeatState: { slug: null, value: null, setAtMs: null },
	};
}

export function createTickContext(enabledTimeframes: TimeframeId[]): TickContext {
	const timeframeConfigs = new Map<TimeframeId, AppConfig>();
	for (const tf of enabledTimeframes) {
		// Snapshot per-timeframe config once per tick to avoid mixed-config behavior.
		timeframeConfigs.set(tf, structuredClone(getConfigForTimeframe(tf)));
	}
	return {
		enabledTimeframes,
		timeframeConfigs,
		paperRisk: { ...CONFIG.paperRisk },
		liveRisk: { ...CONFIG.liveRisk },
		clobBaseUrl: CONFIG.clobBaseUrl,
		pollIntervalMs: CONFIG.pollIntervalMs,
		safeModeThreshold: Math.max(1, Number(CONFIG.strategy.safeModeThreshold ?? 3)),
	};
}

export function syncTimeframeRuntimeState(
	enabledTimeframes: TimeframeId[],
	marketIds: string[],
	states: Map<string, MarketState>,
	paperTrackers: Map<TimeframeId, TradeTracker>,
	liveTrackers: Map<TimeframeId, TradeTracker>,
	prevWindowStartMs: Map<TimeframeId, number>,
): void {
	const enabledSet = new Set<TimeframeId>(enabledTimeframes);

	for (const tf of enabledTimeframes) {
		if (!paperTrackers.has(tf)) {
			paperTrackers.set(tf, createTradeTracker());
		}
		if (!liveTrackers.has(tf)) {
			liveTrackers.set(tf, createTradeTracker());
		}
		for (const marketId of marketIds) {
			const stateKey = `${marketId}:${tf}`;
			if (!states.has(stateKey)) {
				states.set(stateKey, createInitialMarketState());
			}
		}
	}

	for (const tf of Array.from(paperTrackers.keys())) {
		if (!enabledSet.has(tf)) paperTrackers.delete(tf);
	}
	for (const tf of Array.from(liveTrackers.keys())) {
		if (!enabledSet.has(tf)) liveTrackers.delete(tf);
	}
	for (const tf of Array.from(prevWindowStartMs.keys())) {
		if (!enabledSet.has(tf)) prevWindowStartMs.delete(tf);
	}
	for (const key of Array.from(states.keys())) {
		const separatorIndex = key.lastIndexOf(":");
		if (separatorIndex < 0) continue;
		const tf = key.slice(separatorIndex + 1) as TimeframeId;
		if (!enabledSet.has(tf)) states.delete(key);
	}
}
