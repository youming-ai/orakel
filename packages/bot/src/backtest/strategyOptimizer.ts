import type { StrategyConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import type { ReplaySummary } from "./replayCore.ts";

const log = createLogger("strategy-optimizer");

export interface StrategyParameterSpace {
	edgeThresholdEarly: { min: number; max: number; step: number };
	edgeThresholdMid: { min: number; max: number; step: number };
	edgeThresholdLate: { min: number; max: number; step: number };
	minProbEarly: { min: number; max: number; step: number };
	minProbMid: { min: number; max: number; step: number };
	minProbLate: { min: number; max: number; step: number };
	minTimeLeftMin: { min: number; max: number; step: number };
	maxTimeLeftMin: { min: number; max: number; step: number };
	minVolatility15m: { min: number; max: number; step: number };
	maxVolatility15m: { min: number; max: number; step: number };
	candleAggregationMinutes: number[];
	minPriceToBeatMovePct: { min: number; max: number; step: number };
	minExpectedEdge: { min: number; max: number; step: number };
	maxEntryPrice: { min: number; max: number; step: number };
	edgeDownBias: { min: number; max: number; step: number };
}

export interface OptimizationResult {
	params: StrategyConfig;
	score: number;
	metrics: {
		totalTrades: number;
		winRate: number;
		pnl: number;
		sharpeRatio: number;
		maxDrawdown: number;
		profitFactor: number;
	};
}

export interface BacktestPeriod {
	name: string;
	days: number;
	startTimeMs: number;
	endTimeMs: number;
}

export function createDefaultParameterSpace(): StrategyParameterSpace {
	return {
		edgeThresholdEarly: { min: 0.03, max: 0.06, step: 0.005 },
		edgeThresholdMid: { min: 0.05, max: 0.1, step: 0.005 },
		edgeThresholdLate: { min: 0.07, max: 0.12, step: 0.005 },

		minProbEarly: { min: 0.52, max: 0.58, step: 0.01 },
		minProbMid: { min: 0.55, max: 0.62, step: 0.01 },
		minProbLate: { min: 0.58, max: 0.67, step: 0.01 },

		minTimeLeftMin: { min: 2, max: 5, step: 0.5 },
		maxTimeLeftMin: { min: 7, max: 13, step: 0.5 },

		minVolatility15m: { min: 0.001, max: 0.0025, step: 0.0002 },
		maxVolatility15m: { min: 0.025, max: 0.035, step: 0.002 },

		candleAggregationMinutes: [1, 2, 3],

		minPriceToBeatMovePct: { min: 0.0005, max: 0.0015, step: 0.0002 },

		minExpectedEdge: { min: 0.04, max: 0.07, step: 0.005 },

		maxEntryPrice: { min: 0.55, max: 0.6, step: 0.01 },

		edgeDownBias: { min: 0.01, max: 0.03, step: 0.005 },
	};
}

export function* generateParameterCombinations(space: StrategyParameterSpace): Generator<StrategyConfig> {
	const ranges = {
		edgeThresholdEarly: generateRange(space.edgeThresholdEarly),
		edgeThresholdMid: generateRange(space.edgeThresholdMid),
		edgeThresholdLate: generateRange(space.edgeThresholdLate),
		minProbEarly: generateRange(space.minProbEarly),
		minProbMid: generateRange(space.minProbMid),
		minProbLate: generateRange(space.minProbLate),
		minTimeLeftMin: generateRange(space.minTimeLeftMin),
		maxTimeLeftMin: generateRange(space.maxTimeLeftMin),
		minVolatility15m: generateRange(space.minVolatility15m),
		maxVolatility15m: generateRange(space.maxVolatility15m),
		candleAggregationMinutes: space.candleAggregationMinutes,
		minPriceToBeatMovePct: generateRange(space.minPriceToBeatMovePct),
		minExpectedEdge: generateRange(space.minExpectedEdge),
		maxEntryPrice: generateRange(space.maxEntryPrice),
		edgeDownBias: generateRange(space.edgeDownBias),
	};

	const maxCombinations = 1000;
	let count = 0;

	for (const edgeEarly of ranges.edgeThresholdEarly) {
		for (const edgeMid of ranges.edgeThresholdMid) {
			for (const edgeLate of ranges.edgeThresholdLate) {
				for (const probEarly of ranges.minProbEarly) {
					for (const probMid of ranges.minProbMid) {
						for (const probLate of ranges.minProbLate) {
							for (const minTime of ranges.minTimeLeftMin) {
								for (const maxTime of ranges.maxTimeLeftMin) {
									if (minTime >= maxTime) continue;

									for (const minVol of ranges.minVolatility15m) {
										for (const maxVol of ranges.maxVolatility15m) {
											if (minVol >= maxVol) continue;

											for (const agg of ranges.candleAggregationMinutes) {
												for (const ptbMove of ranges.minPriceToBeatMovePct) {
													for (const minEdge of ranges.minExpectedEdge) {
														for (const maxEntry of ranges.maxEntryPrice) {
															for (const bias of ranges.edgeDownBias) {
																count++;
																if (count > maxCombinations) {
																	log.warn(`Parameter space too large, limiting to ${maxCombinations} combinations`);
																	return;
																}

																yield {
																	edgeThresholdEarly: edgeEarly,
																	edgeThresholdMid: edgeMid,
																	edgeThresholdLate: edgeLate,
																	minProbEarly: probEarly,
																	minProbMid: probMid,
																	minProbLate: probLate,
																	maxGlobalTradesPerWindow: 2,
																	skipMarkets: [],
																	minTimeLeftMin: minTime,
																	maxTimeLeftMin: maxTime,
																	minVolatility15m: minVol,
																	maxVolatility15m: maxVol,
																	candleAggregationMinutes: agg,
																	minPriceToBeatMovePct: ptbMove,
																	minExpectedEdge: minEdge,
																	maxEntryPrice: maxEntry,
																	edgeDownBias: bias,
																};
															}
														}
													}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
}

export function generateRandomParameters(space: StrategyParameterSpace, count: number): StrategyConfig[] {
	const configs: StrategyConfig[] = [];

	for (let i = 0; i < count; i++) {
		const minTimeLeft = randomInRange(space.minTimeLeftMin.min, space.minTimeLeftMin.max);
		const maxTimeLeft = randomInRange(Math.max(minTimeLeft + 1, space.maxTimeLeftMin.min), space.maxTimeLeftMin.max);

		const minVol = randomInRange(space.minVolatility15m.min, space.minVolatility15m.max);
		const maxVol = randomInRange(Math.max(minVol + 0.001, space.maxVolatility15m.min), space.maxVolatility15m.max);

		configs.push({
			edgeThresholdEarly: randomInRange(space.edgeThresholdEarly.min, space.edgeThresholdEarly.max),
			edgeThresholdMid: randomInRange(space.edgeThresholdMid.min, space.edgeThresholdMid.max),
			edgeThresholdLate: randomInRange(space.edgeThresholdLate.min, space.edgeThresholdLate.max),
			minProbEarly: randomInRange(space.minProbEarly.min, space.minProbEarly.max),
			minProbMid: randomInRange(space.minProbMid.min, space.minProbMid.max),
			minProbLate: randomInRange(space.minProbLate.min, space.minProbLate.max),
			maxGlobalTradesPerWindow: 2,
			skipMarkets: [],
			minTimeLeftMin: minTimeLeft,
			maxTimeLeftMin: maxTimeLeft,
			minVolatility15m: minVol,
			maxVolatility15m: maxVol,
			candleAggregationMinutes: randomPick(space.candleAggregationMinutes),
			minPriceToBeatMovePct: randomInRange(space.minPriceToBeatMovePct.min, space.minPriceToBeatMovePct.max),
			minExpectedEdge: randomInRange(space.minExpectedEdge.min, space.minExpectedEdge.max),
			maxEntryPrice: randomInRange(space.maxEntryPrice.min, space.maxEntryPrice.max),
			edgeDownBias: randomInRange(space.edgeDownBias.min, space.edgeDownBias.max),
		});
	}

	return configs;
}

export function calculateStrategyScore(summary: ReplaySummary, periodDays: number): number {
	const { totalTrades, winRate, totalPnlUsdc } = summary;

	const minTrades = Math.max(5, periodDays / 7);
	if (totalTrades < minTrades) {
		return -1000;
	}

	let score = winRate * 100;

	const avgPnl = totalPnlUsdc / totalTrades;
	score += avgPnl * 10;

	const expectedTrades = periodDays * 2;
	const tradeRatio = totalTrades / expectedTrades;
	if (tradeRatio > 0.3 && tradeRatio < 2) {
		score += 5;
	}

	if (winRate < 0.45) {
		score -= 30;
	}

	if (totalPnlUsdc < 0) {
		score -= 20;
	}

	return score;
}

export function calculateCombinedScore(results: Map<number, ReplaySummary>, periods: BacktestPeriod[]): number {
	let totalScore = 0;
	let totalWeight = 0;

	for (const period of periods) {
		const summary = results.get(period.days);
		if (!summary) continue;

		const weight = period.days <= 7 ? 0.3 : period.days <= 30 ? 0.4 : 0.3;
		const score = calculateStrategyScore(summary, period.days);

		totalScore += score * weight;
		totalWeight += weight;
	}

	return totalWeight > 0 ? totalScore / totalWeight : -Infinity;
}

/**
 * 辅助函数: 生成范围内的数值数组
 */
function generateRange(range: { min: number; max: number; step: number }): number[] {
	const values: number[] = [];
	for (let v = range.min; v <= range.max; v += range.step) {
		values.push(Math.round(v * 10000) / 10000); // 避免浮点误差
	}
	return values;
}

function randomInRange(min: number, max: number): number {
	return Math.round((min + Math.random() * (max - min)) * 10000) / 10000;
}

function randomPick<T>(arr: T[]): T {
	const item = arr[Math.floor(Math.random() * arr.length)];
	if (item === undefined) {
		throw new Error("Cannot pick from empty array");
	}
	return item;
}

export function createUniversalStrategy(btcResult: OptimizationResult, ethResult: OptimizationResult): StrategyConfig {
	const avg = (a: number, b: number): number => Math.round(((a + b) / 2) * 10000) / 10000;

	return {
		edgeThresholdEarly: avg(btcResult.params.edgeThresholdEarly, ethResult.params.edgeThresholdEarly),
		edgeThresholdMid: avg(btcResult.params.edgeThresholdMid, ethResult.params.edgeThresholdMid),
		edgeThresholdLate: avg(btcResult.params.edgeThresholdLate, ethResult.params.edgeThresholdLate),
		minProbEarly: avg(btcResult.params.minProbEarly, ethResult.params.minProbEarly),
		minProbMid: avg(btcResult.params.minProbMid, ethResult.params.minProbMid),
		minProbLate: avg(btcResult.params.minProbLate, ethResult.params.minProbLate),
		maxGlobalTradesPerWindow: 2,
		skipMarkets: [],
		minTimeLeftMin: avg(btcResult.params.minTimeLeftMin ?? 3, ethResult.params.minTimeLeftMin ?? 3),
		maxTimeLeftMin: avg(btcResult.params.maxTimeLeftMin ?? 11.5, ethResult.params.maxTimeLeftMin ?? 11.5),
		minVolatility15m: avg(btcResult.params.minVolatility15m ?? 0.0016, ethResult.params.minVolatility15m ?? 0.0019),
		maxVolatility15m: avg(btcResult.params.maxVolatility15m ?? 0.03, ethResult.params.maxVolatility15m ?? 0.03),
		candleAggregationMinutes: btcResult.params.candleAggregationMinutes ?? 2,
		minPriceToBeatMovePct: avg(
			btcResult.params.minPriceToBeatMovePct ?? 0.0008,
			ethResult.params.minPriceToBeatMovePct ?? 0.0012,
		),
		minExpectedEdge: avg(btcResult.params.minExpectedEdge ?? 0.05, ethResult.params.minExpectedEdge ?? 0.05),
		maxEntryPrice: avg(btcResult.params.maxEntryPrice ?? 0.58, ethResult.params.maxEntryPrice ?? 0.58),
		edgeDownBias: avg(btcResult.params.edgeDownBias ?? 0.02, ethResult.params.edgeDownBias ?? 0.02),
	};
}
