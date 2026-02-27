import type { Phase, Regime, StrategyConfig } from "./types.ts";

export interface BacktestSignal {
	timestamp: string;
	marketId: string;
	side: "UP" | "DOWN";
	phase: Phase;
	regime: Regime;
	edge: number;
	effectiveEdge: number;
	modelUp: number;
	modelDown: number;
	marketUp: number;
	marketDown: number;
	confidence: number;
	volatility15m: number;
	priceToBeat: number;
	finalPrice: number | null;
	orderbookImbalance: number | null;
	vwapSlope: number | null;
	rsi: number | null;
}

export interface BacktestResult {
	totalSignals: number;
	tradesEntered: number;
	wins: number;
	losses: number;
	winRate: number;
	totalPnl: number;
	avgPnlPerTrade: number;
	maxDrawdown: number;
	sharpeRatio: number;
	profitFactor: number;
	perMarket: Record<string, { trades: number; winRate: number; pnl: number }>;
	perRegime: Record<string, { trades: number; winRate: number; pnl: number }>;
	perPhase: Record<string, { trades: number; winRate: number; pnl: number }>;
}

export interface ABTestResult {
	strategyA: BacktestResult;
	strategyB: BacktestResult;
	winRateDiff: number;
	pnlDiff: number;
	sharpeDiff: number;
	isSignificant: boolean;
	pValue: number;
}

export interface ParameterGrid {
	edgeThresholdEarly?: number[];
	edgeThresholdMid?: number[];
	edgeThresholdLate?: number[];
	minProbEarly?: number[];
	minProbMid?: number[];
	minProbLate?: number[];
	regimeMultipliers?: {
		CHOP?: number[];
		RANGE?: number[];
		TREND_ALIGNED?: number[];
		TREND_OPPOSED?: number[];
	};
}

export interface OptimizationResult {
	bestConfig: StrategyConfig;
	bestResult: BacktestResult;
	allResults: Array<{ config: StrategyConfig; result: BacktestResult }>;
	totalCombinations: number;
}

export interface CrossValidationResult {
	foldResults: BacktestResult[];
	avgWinRate: number;
	avgPnl: number;
	avgSharpe: number;
	stdWinRate: number;
	stdPnl: number;
	isOverfit: boolean;
}

interface BucketStats {
	trades: number;
	wins: number;
	pnl: number;
}

const DEFAULT_TRADE_SIZE = 5;

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function stdDev(values: number[]): number {
	if (values.length < 2) return 0;
	const avg = mean(values);
	const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

function getRegimeMultiplier(config: StrategyConfig, regime: Regime, side: "UP" | "DOWN"): number {
	if (regime === "CHOP") return config.regimeMultipliers.CHOP;
	if (regime === "RANGE") return config.regimeMultipliers.RANGE;
	const aligned = (regime === "TREND_UP" && side === "UP") || (regime === "TREND_DOWN" && side === "DOWN");
	return aligned ? config.regimeMultipliers.TREND_ALIGNED : config.regimeMultipliers.TREND_OPPOSED;
}

function getEdgeThreshold(config: StrategyConfig, phase: Phase): number {
	if (phase === "EARLY") return config.edgeThresholdEarly;
	if (phase === "MID") return config.edgeThresholdMid;
	return config.edgeThresholdLate;
}

function getMinProb(config: StrategyConfig, phase: Phase): number {
	if (phase === "EARLY") return config.minProbEarly;
	if (phase === "MID") return config.minProbMid;
	return config.minProbLate;
}

function updateBucket(buckets: Record<string, BucketStats>, key: string, won: boolean, pnl: number): void {
	const current = buckets[key] ?? { trades: 0, wins: 0, pnl: 0 };
	buckets[key] = {
		trades: current.trades + 1,
		wins: current.wins + (won ? 1 : 0),
		pnl: current.pnl + pnl,
	};
}

function normalizeBuckets(
	buckets: Record<string, BucketStats>,
): Record<string, { trades: number; winRate: number; pnl: number }> {
	const output: Record<string, { trades: number; winRate: number; pnl: number }> = {};
	for (const [key, value] of Object.entries(buckets)) {
		output[key] = {
			trades: value.trades,
			winRate: value.trades > 0 ? value.wins / value.trades : 0,
			pnl: value.pnl,
		};
	}
	return output;
}

function erf(value: number): number {
	const sign = value < 0 ? -1 : 1;
	const x = Math.abs(value);
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;
	const t = 1 / (1 + p * x);
	const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
	return sign * y;
}

function chiSquaredPValueDf1(chiSquared: number): number {
	if (!Number.isFinite(chiSquared) || chiSquared <= 0) return 1;
	return 1 - erf(Math.sqrt(chiSquared / 2));
}

function cloneStrategyConfig(config: StrategyConfig): StrategyConfig {
	return {
		...config,
		blendWeights: { ...config.blendWeights },
		regimeMultipliers: { ...config.regimeMultipliers },
		skipMarkets: config.skipMarkets ? [...config.skipMarkets] : undefined,
		marketPerformance: config.marketPerformance ? { ...config.marketPerformance } : undefined,
	};
}

export class BacktestEngine {
	private readonly config: StrategyConfig;

	private readonly tradeSize: number;

	public constructor(config: StrategyConfig, tradeSize: number = DEFAULT_TRADE_SIZE) {
		this.config = cloneStrategyConfig(config);
		this.tradeSize = tradeSize;
	}

	public run(signals: BacktestSignal[], strategyConfig?: StrategyConfig): BacktestResult {
		const config = strategyConfig ? cloneStrategyConfig(strategyConfig) : this.config;
		const perMarketBuckets: Record<string, BucketStats> = {};
		const perRegimeBuckets: Record<string, BucketStats> = {};
		const perPhaseBuckets: Record<string, BucketStats> = {};
		const dailyPnl: Record<string, number> = {};

		let tradesEntered = 0;
		let wins = 0;
		let losses = 0;
		let totalPnl = 0;
		let grossProfit = 0;
		let grossLoss = 0;
		let equity = 0;
		let peakEquity = 0;
		let maxDrawdown = 0;

		for (const signal of signals) {
			if (signal.finalPrice === null || !Number.isFinite(signal.finalPrice)) continue;
			if (config.skipMarkets?.includes(signal.marketId)) continue;

			const threshold =
				getEdgeThreshold(config, signal.phase) * getRegimeMultiplier(config, signal.regime, signal.side);
			const minProb = getMinProb(config, signal.phase);
			const minConfidence = config.minConfidence ?? 0;

			const modelProb = signal.side === "UP" ? signal.modelUp : signal.modelDown;
			const buyPrice = signal.side === "UP" ? signal.marketUp : signal.marketDown;
			const edge = Number.isFinite(signal.effectiveEdge) ? signal.effectiveEdge : signal.edge;

			if (!Number.isFinite(modelProb) || !Number.isFinite(buyPrice) || !Number.isFinite(edge)) continue;
			if (edge < threshold || modelProb < minProb || signal.confidence < minConfidence) continue;

			tradesEntered += 1;
			const won =
				signal.side === "UP" ? signal.finalPrice > signal.priceToBeat : signal.finalPrice <= signal.priceToBeat;
			const pnl = won ? this.tradeSize * (1 - buyPrice) : -(this.tradeSize * buyPrice);

			if (won) {
				wins += 1;
				grossProfit += pnl;
			} else {
				losses += 1;
				grossLoss += pnl;
			}

			totalPnl += pnl;
			equity += pnl;
			if (equity > peakEquity) peakEquity = equity;
			const drawdown = peakEquity - equity;
			if (drawdown > maxDrawdown) maxDrawdown = drawdown;

			updateBucket(perMarketBuckets, signal.marketId, won, pnl);
			updateBucket(perRegimeBuckets, signal.regime, won, pnl);
			updateBucket(perPhaseBuckets, signal.phase, won, pnl);

			const day = signal.timestamp.slice(0, 10);
			dailyPnl[day] = (dailyPnl[day] ?? 0) + pnl;
		}

		const dailyReturns = Object.values(dailyPnl).map((dayPnl) => dayPnl / this.tradeSize);
		const dailyReturnStd = stdDev(dailyReturns);
		const sharpeRatio = dailyReturnStd > 0 ? (mean(dailyReturns) / dailyReturnStd) * Math.sqrt(252) : 0;
		const profitFactor =
			grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

		return {
			totalSignals: signals.length,
			tradesEntered,
			wins,
			losses,
			winRate: tradesEntered > 0 ? wins / tradesEntered : 0,
			totalPnl,
			avgPnlPerTrade: tradesEntered > 0 ? totalPnl / tradesEntered : 0,
			maxDrawdown,
			sharpeRatio,
			profitFactor,
			perMarket: normalizeBuckets(perMarketBuckets),
			perRegime: normalizeBuckets(perRegimeBuckets),
			perPhase: normalizeBuckets(perPhaseBuckets),
		};
	}
}

export function runABTest(
	strategyA: StrategyConfig,
	strategyB: StrategyConfig,
	signals: BacktestSignal[],
	tradeSize: number = DEFAULT_TRADE_SIZE,
): ABTestResult {
	const engineA = new BacktestEngine(strategyA, tradeSize);
	const engineB = new BacktestEngine(strategyB, tradeSize);
	const resultA = engineA.run(signals);
	const resultB = engineB.run(signals);

	const aWins = resultA.wins;
	const aLosses = resultA.losses;
	const bWins = resultB.wins;
	const bLosses = resultB.losses;
	const total = aWins + aLosses + bWins + bLosses;

	let chiSquared = 0;
	if (total > 0) {
		const rowA = aWins + aLosses;
		const rowB = bWins + bLosses;
		const colWins = aWins + bWins;
		const colLosses = aLosses + bLosses;
		const expected = [
			(rowA * colWins) / total,
			(rowA * colLosses) / total,
			(rowB * colWins) / total,
			(rowB * colLosses) / total,
		];
		const observed = [aWins, aLosses, bWins, bLosses];
		for (let index = 0; index < observed.length; index += 1) {
			const exp = expected[index] ?? 0;
			const obs = observed[index] ?? 0;
			if (exp > 0) {
				chiSquared += (obs - exp) ** 2 / exp;
			}
		}
	}

	const pValue = chiSquaredPValueDf1(chiSquared);
	return {
		strategyA: resultA,
		strategyB: resultB,
		winRateDiff: resultA.winRate - resultB.winRate,
		pnlDiff: resultA.totalPnl - resultB.totalPnl,
		sharpeDiff: resultA.sharpeRatio - resultB.sharpeRatio,
		isSignificant: pValue < 0.05,
		pValue,
	};
}

export function optimizeParameters(
	baseConfig: StrategyConfig,
	grid: ParameterGrid,
	signals: BacktestSignal[],
	sortBy: "sharpeRatio" | "winRate" | "totalPnl" = "sharpeRatio",
): OptimizationResult {
	const edgeThresholdEarly = grid.edgeThresholdEarly ?? [baseConfig.edgeThresholdEarly];
	const edgeThresholdMid = grid.edgeThresholdMid ?? [baseConfig.edgeThresholdMid];
	const edgeThresholdLate = grid.edgeThresholdLate ?? [baseConfig.edgeThresholdLate];
	const minProbEarly = grid.minProbEarly ?? [baseConfig.minProbEarly];
	const minProbMid = grid.minProbMid ?? [baseConfig.minProbMid];
	const minProbLate = grid.minProbLate ?? [baseConfig.minProbLate];
	const chopMultipliers = grid.regimeMultipliers?.CHOP ?? [baseConfig.regimeMultipliers.CHOP];
	const rangeMultipliers = grid.regimeMultipliers?.RANGE ?? [baseConfig.regimeMultipliers.RANGE];
	const trendAlignedMultipliers = grid.regimeMultipliers?.TREND_ALIGNED ?? [baseConfig.regimeMultipliers.TREND_ALIGNED];
	const trendOpposedMultipliers = grid.regimeMultipliers?.TREND_OPPOSED ?? [baseConfig.regimeMultipliers.TREND_OPPOSED];

	const allResults: Array<{ config: StrategyConfig; result: BacktestResult }> = [];
	for (const eEarly of edgeThresholdEarly) {
		for (const eMid of edgeThresholdMid) {
			for (const eLate of edgeThresholdLate) {
				for (const pEarly of minProbEarly) {
					for (const pMid of minProbMid) {
						for (const pLate of minProbLate) {
							for (const chop of chopMultipliers) {
								for (const range of rangeMultipliers) {
									for (const trendAligned of trendAlignedMultipliers) {
										for (const trendOpposed of trendOpposedMultipliers) {
											const config: StrategyConfig = {
												...cloneStrategyConfig(baseConfig),
												edgeThresholdEarly: eEarly,
												edgeThresholdMid: eMid,
												edgeThresholdLate: eLate,
												minProbEarly: pEarly,
												minProbMid: pMid,
												minProbLate: pLate,
												regimeMultipliers: {
													CHOP: chop,
													RANGE: range,
													TREND_ALIGNED: trendAligned,
													TREND_OPPOSED: trendOpposed,
												},
											};
											const result = new BacktestEngine(config).run(signals);
											allResults.push({ config, result });
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

	allResults.sort((left, right) => right.result[sortBy] - left.result[sortBy]);
	const best = allResults[0];
	if (best === undefined) {
		const fallbackResult = new BacktestEngine(baseConfig).run(signals);
		return {
			bestConfig: cloneStrategyConfig(baseConfig),
			bestResult: fallbackResult,
			allResults: [{ config: cloneStrategyConfig(baseConfig), result: fallbackResult }],
			totalCombinations: 1,
		};
	}

	return {
		bestConfig: best.config,
		bestResult: best.result,
		allResults,
		totalCombinations: allResults.length,
	};
}

export function crossValidate(
	config: StrategyConfig,
	signals: BacktestSignal[],
	folds: number = 5,
	tradeSize: number = DEFAULT_TRADE_SIZE,
): CrossValidationResult {
	const foldCount = Math.max(2, Math.min(folds, Math.max(2, signals.length)));
	const boundaries: number[] = [0];
	for (let index = 1; index <= foldCount; index += 1) {
		boundaries.push(Math.floor((index * signals.length) / foldCount));
	}

	const engine = new BacktestEngine(config, tradeSize);
	const foldResults: BacktestResult[] = [];
	const trainWinRates: number[] = [];

	for (let foldIndex = 1; foldIndex < foldCount; foldIndex += 1) {
		const trainEnd = boundaries[foldIndex] ?? 0;
		const testStart = boundaries[foldIndex] ?? 0;
		const testEnd = boundaries[foldIndex + 1] ?? signals.length;
		if (testEnd <= testStart) continue;

		const trainSignals = signals.slice(0, trainEnd);
		if (trainSignals.length > 0) {
			const trainResult = engine.run(trainSignals);
			trainWinRates.push(trainResult.winRate);
		}

		const testSignals = signals.slice(testStart, testEnd);
		const testResult = engine.run(testSignals);
		foldResults.push(testResult);
	}

	const winRates = foldResults.map((result) => result.winRate);
	const pnls = foldResults.map((result) => result.totalPnl);
	const sharpes = foldResults.map((result) => result.sharpeRatio);
	const avgWinRate = mean(winRates);
	const bestFoldWinRate = winRates.length > 0 ? Math.max(...winRates) : 0;
	const avgTrainWinRate = mean(trainWinRates);
	const isOverfit = bestFoldWinRate >= avgWinRate + 0.1 || avgTrainWinRate >= avgWinRate + 0.1;

	return {
		foldResults,
		avgWinRate,
		avgPnl: mean(pnls),
		avgSharpe: mean(sharpes),
		stdWinRate: stdDev(winRates),
		stdPnl: stdDev(pnls),
		isOverfit,
	};
}
