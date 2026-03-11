export interface TradeTracker {
	has(marketId: string, startMs: number): boolean;
	record(marketId: string, startMs: number): void;
	prune(cutoffMs: number): void;
	canTradeGlobally(maxGlobal: number): boolean;
}

export function createTradeTracker(): TradeTracker {
	const entries = new Map<string, number>();
	return {
		has(marketId: string, startMs: number): boolean {
			return entries.has(`${marketId}:${startMs}`);
		},
		record(marketId: string, startMs: number): void {
			entries.set(`${marketId}:${startMs}`, startMs);
		},
		prune(cutoffMs: number): void {
			for (const [key, startMs] of entries) {
				if (startMs < cutoffMs) entries.delete(key);
			}
		},
		canTradeGlobally(maxGlobal: number): boolean {
			return entries.size < maxGlobal;
		},
	};
}
