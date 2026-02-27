import type { Phase, Regime } from "../types.ts";
import { clamp } from "../utils.ts";

export interface SignalFeatures {
	marketId: string;
	edge: number;
	confidence: number;
	volatility15m: number;
	phase: Phase;
	regime: Regime | null;
	modelUp: number;
	orderbookImbalance: number | null;
	rsi: number | null;
	vwapSlope: number | null;
}

export interface HistoricalSignal extends SignalFeatures {
	won: boolean;
	pnl: number;
	timestamp: number;
}

export interface SignalQualityResult {
	predictedWinRate: number;
	sampleSize: number;
	avgSimilarity: number;
	confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
}

export interface GroupPerformance {
	count: number;
	winRate: number;
	avgEdge: number;
	avgPnl: number;
}

export function computeSimilarity(f1: SignalFeatures, f2: HistoricalSignal): number {
	let dist = 0;
	dist += ((f1.edge - f2.edge) * 5) ** 2;
	dist += ((f1.confidence - f2.confidence) * 2) ** 2;
	dist += ((f1.volatility15m - f2.volatility15m) * 100) ** 2;
	dist += ((f1.modelUp - f2.modelUp) * 3) ** 2;

	if (f1.rsi !== null && f2.rsi !== null) {
		dist += (((f1.rsi - f2.rsi) / 100) * 2) ** 2;
	}

	if (f1.vwapSlope !== null && f2.vwapSlope !== null) {
		dist += ((f1.vwapSlope - f2.vwapSlope) * 10) ** 2;
	}

	if (f1.phase !== f2.phase) dist += 1;
	if (f1.regime !== f2.regime) dist += 0.5;
	if (f1.marketId !== f2.marketId) dist += 0.3;

	return 1 / (1 + Math.sqrt(dist));
}

function classifyConfidence(sampleSize: number, avgSimilarity: number): SignalQualityResult["confidence"] {
	if (sampleSize >= 20 && avgSimilarity >= 0.7) return "HIGH";
	if (sampleSize >= 15 && avgSimilarity >= 0.55) return "MEDIUM";
	return "LOW";
}

export class SignalQualityModel {
	private history: HistoricalSignal[] = [];
	private marketHistory: Map<string, HistoricalSignal[]> = new Map();
	private readonly maxPerMarket: number;
	private readonly maxTotal: number;

	constructor(maxPerMarket = 500, maxTotal = 2000) {
		this.maxPerMarket = Math.max(1, maxPerMarket);
		this.maxTotal = Math.max(1, maxTotal);
	}

	recordOutcome(signal: HistoricalSignal): void {
		const historySignal: HistoricalSignal = {
			...signal,
			timestamp: Number.isFinite(signal.timestamp) ? signal.timestamp : Date.now(),
		};

		this.history.push(historySignal);

		const marketSignals = this.marketHistory.get(historySignal.marketId) ?? [];
		marketSignals.push(historySignal);
		this.marketHistory.set(historySignal.marketId, marketSignals);

		while (marketSignals.length > this.maxPerMarket) {
			const removed = marketSignals.shift();
			if (!removed) continue;
			const idx = this.history.indexOf(removed);
			if (idx >= 0) this.history.splice(idx, 1);
		}

		while (this.history.length > this.maxTotal) {
			const removed = this.history.shift();
			if (!removed) continue;
			const bucket = this.marketHistory.get(removed.marketId);
			if (!bucket) continue;
			const idx = bucket.indexOf(removed);
			if (idx >= 0) bucket.splice(idx, 1);
			if (bucket.length === 0) this.marketHistory.delete(removed.marketId);
		}
	}

	predictWinRate(features: SignalFeatures, k = 20): SignalQualityResult {
		const marketSignals = this.marketHistory.get(features.marketId) ?? [];
		const candidatePool = marketSignals.length >= 10 ? marketSignals : this.history;

		if (candidatePool.length < 10) {
			return {
				predictedWinRate: 0.5,
				sampleSize: candidatePool.length,
				avgSimilarity: 0,
				confidence: "INSUFFICIENT",
			};
		}

		const topK = Math.min(Math.max(1, Math.floor(k)), candidatePool.length);
		const neighbors = candidatePool
			.map((signal) => ({ signal, similarity: computeSimilarity(features, signal) }))
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, topK);

		let weightedWins = 0;
		let totalWeight = 0;
		let similaritySum = 0;

		for (const neighbor of neighbors) {
			const weight = neighbor.similarity ** 2;
			weightedWins += (neighbor.signal.won ? 1 : 0) * weight;
			totalWeight += weight;
			similaritySum += neighbor.similarity;
		}

		const rawWinRate = totalWeight > 0 ? weightedWins / totalWeight : 0.5;
		const avgSimilarity = neighbors.length > 0 ? similaritySum / neighbors.length : 0;

		return {
			predictedWinRate: clamp(rawWinRate, 0, 1),
			sampleSize: neighbors.length,
			avgSimilarity: clamp(avgSimilarity, 0, 1),
			confidence: classifyConfidence(neighbors.length, avgSimilarity),
		};
	}

	getPerformanceByGroup(params: { marketId?: string; regime?: Regime | null; phase?: Phase }): GroupPerformance | null {
		const filtered = this.history.filter((signal) => {
			if (params.marketId !== undefined && signal.marketId !== params.marketId) return false;
			if (params.regime !== undefined && signal.regime !== params.regime) return false;
			if (params.phase !== undefined && signal.phase !== params.phase) return false;
			return true;
		});

		if (filtered.length < 5) return null;

		const wins = filtered.reduce((sum, signal) => sum + (signal.won ? 1 : 0), 0);
		const edgeSum = filtered.reduce((sum, signal) => sum + signal.edge, 0);
		const pnlSum = filtered.reduce((sum, signal) => sum + signal.pnl, 0);

		return {
			count: filtered.length,
			winRate: wins / filtered.length,
			avgEdge: edgeSum / filtered.length,
			avgPnl: pnlSum / filtered.length,
		};
	}

	getHistorySize(): number {
		return this.history.length;
	}

	getMarketHistorySize(marketId: string): number {
		return (this.marketHistory.get(marketId) ?? []).length;
	}
}
