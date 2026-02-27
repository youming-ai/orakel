import { describe, expect, it } from "vitest";
import {
	BacktestEngine,
	type BacktestSignal,
	crossValidate,
	optimizeParameters,
	type ParameterGrid,
	runABTest,
} from "./backtest.ts";
import type { StrategyConfig } from "./types.ts";

function makeStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
	return {
		edgeThresholdEarly: 0.06,
		edgeThresholdMid: 0.08,
		edgeThresholdLate: 0.1,
		minProbEarly: 0.52,
		minProbMid: 0.55,
		minProbLate: 0.6,
		blendWeights: { vol: 0.5, ta: 0.5 },
		regimeMultipliers: {
			CHOP: 1.3,
			RANGE: 1,
			TREND_ALIGNED: 0.8,
			TREND_OPPOSED: 1.2,
		},
		...overrides,
	};
}

function makeSignal(overrides: Partial<BacktestSignal> = {}): BacktestSignal {
	return {
		timestamp: "2026-01-01T00:00:00.000Z",
		marketId: "BTC",
		side: "UP",
		phase: "MID",
		regime: "RANGE",
		edge: 0.15,
		effectiveEdge: 0.15,
		modelUp: 0.65,
		modelDown: 0.35,
		marketUp: 0.46,
		marketDown: 0.54,
		confidence: 0.7,
		volatility15m: 0.004,
		priceToBeat: 100,
		finalPrice: 101,
		orderbookImbalance: 0.1,
		vwapSlope: 0.05,
		rsi: 55,
		...overrides,
	};
}

function makeSignals(count: number, builder: (index: number) => Partial<BacktestSignal>): BacktestSignal[] {
	const signals: BacktestSignal[] = [];
	for (let index = 0; index < count; index += 1) {
		signals.push(
			makeSignal({
				timestamp: `2026-01-${String(1 + Math.floor(index / 5)).padStart(2, "0")}T00:00:00.000Z`,
				...builder(index),
			}),
		);
	}
	return signals;
}

describe("BacktestEngine", () => {
	it("should return zeroed metrics for empty data", () => {
		const result = new BacktestEngine(makeStrategy()).run([]);

		expect(result.totalSignals).toBe(0);
		expect(result.tradesEntered).toBe(0);
		expect(result.wins).toBe(0);
		expect(result.losses).toBe(0);
		expect(result.winRate).toBe(0);
		expect(result.totalPnl).toBe(0);
		expect(result.maxDrawdown).toBe(0);
		expect(result.sharpeRatio).toBe(0);
		expect(result.profitFactor).toBe(0);
	});

	it("should ignore unsettled signals", () => {
		const signals = [makeSignal({ finalPrice: null })];
		const result = new BacktestEngine(makeStrategy()).run(signals);

		expect(result.totalSignals).toBe(1);
		expect(result.tradesEntered).toBe(0);
	});

	it("should settle one winning UP trade", () => {
		const result = new BacktestEngine(makeStrategy(), 5).run([makeSignal()]);

		expect(result.tradesEntered).toBe(1);
		expect(result.wins).toBe(1);
		expect(result.losses).toBe(0);
		expect(result.totalPnl).toBeCloseTo(2.7, 10);
		expect(result.avgPnlPerTrade).toBeCloseTo(2.7, 10);
	});

	it("should settle one losing UP trade", () => {
		const result = new BacktestEngine(makeStrategy(), 5).run([makeSignal({ finalPrice: 99 })]);

		expect(result.tradesEntered).toBe(1);
		expect(result.wins).toBe(0);
		expect(result.losses).toBe(1);
		expect(result.totalPnl).toBeCloseTo(-2.3, 10);
	});

	it("should treat DOWN tie as win", () => {
		const result = new BacktestEngine(makeStrategy(), 5).run([
			makeSignal({ side: "DOWN", modelDown: 0.7, modelUp: 0.3, finalPrice: 100 }),
		]);

		expect(result.tradesEntered).toBe(1);
		expect(result.wins).toBe(1);
		expect(result.totalPnl).toBeCloseTo(2.3, 10);
	});

	it("should block trades when edge is below threshold", () => {
		const result = new BacktestEngine(makeStrategy()).run([makeSignal({ effectiveEdge: 0.01, edge: 0.01 })]);

		expect(result.tradesEntered).toBe(0);
	});

	it("should block trades when model probability is below minimum", () => {
		const result = new BacktestEngine(makeStrategy()).run([makeSignal({ modelUp: 0.51 })]);

		expect(result.tradesEntered).toBe(0);
	});

	it("should block trades when confidence is below minConfidence", () => {
		const strategy = makeStrategy({ minConfidence: 0.8 });
		const result = new BacktestEngine(strategy).run([makeSignal({ confidence: 0.79 })]);

		expect(result.tradesEntered).toBe(0);
	});

	it("should skip configured markets", () => {
		const strategy = makeStrategy({ skipMarkets: ["BTC"] });
		const result = new BacktestEngine(strategy).run([makeSignal({ marketId: "BTC" })]);

		expect(result.tradesEntered).toBe(0);
	});

	it("should apply phase thresholds", () => {
		const signals = [
			makeSignal({ phase: "EARLY", effectiveEdge: 0.07 }),
			makeSignal({ phase: "MID", effectiveEdge: 0.07 }),
			makeSignal({ phase: "LATE", effectiveEdge: 0.07 }),
		];
		const result = new BacktestEngine(makeStrategy()).run(signals);

		expect(result.tradesEntered).toBe(1);
		expect(result.perPhase.EARLY?.trades).toBe(1);
		expect(result.perPhase.MID).toBeUndefined();
		expect(result.perPhase.LATE).toBeUndefined();
	});

	it("should apply trend-aligned multiplier", () => {
		const result = new BacktestEngine(makeStrategy()).run([
			makeSignal({ regime: "TREND_UP", side: "UP", effectiveEdge: 0.07 }),
		]);

		expect(result.tradesEntered).toBe(1);
	});

	it("should apply trend-opposed multiplier", () => {
		const result = new BacktestEngine(makeStrategy()).run([
			makeSignal({ regime: "TREND_DOWN", side: "UP", effectiveEdge: 0.07 }),
		]);

		expect(result.tradesEntered).toBe(0);
	});

	it("should apply CHOP multiplier", () => {
		const result = new BacktestEngine(makeStrategy()).run([makeSignal({ regime: "CHOP", effectiveEdge: 0.09 })]);

		expect(result.tradesEntered).toBe(0);
	});

	it("should fallback to raw edge if effective edge is non-finite", () => {
		const result = new BacktestEngine(makeStrategy()).run([makeSignal({ effectiveEdge: Number.NaN, edge: 0.12 })]);

		expect(result.tradesEntered).toBe(1);
	});

	it("should aggregate by market", () => {
		const result = new BacktestEngine(makeStrategy()).run([
			makeSignal({ marketId: "BTC", finalPrice: 101 }),
			makeSignal({ marketId: "ETH", finalPrice: 99 }),
		]);

		expect(result.perMarket.BTC?.trades).toBe(1);
		expect(result.perMarket.BTC?.winRate).toBe(1);
		expect(result.perMarket.ETH?.trades).toBe(1);
		expect(result.perMarket.ETH?.winRate).toBe(0);
	});

	it("should aggregate by regime", () => {
		const result = new BacktestEngine(makeStrategy()).run([
			makeSignal({ regime: "RANGE", finalPrice: 101 }),
			makeSignal({ regime: "TREND_UP", side: "UP", finalPrice: 101, effectiveEdge: 0.08 }),
		]);

		expect(result.perRegime.RANGE?.trades).toBe(1);
		expect(result.perRegime.TREND_UP?.trades).toBe(1);
	});

	it("should aggregate by phase", () => {
		const result = new BacktestEngine(makeStrategy()).run([
			makeSignal({ phase: "EARLY", effectiveEdge: 0.07 }),
			makeSignal({ phase: "MID", effectiveEdge: 0.09 }),
			makeSignal({ phase: "LATE", effectiveEdge: 0.12, modelUp: 0.65 }),
		]);

		expect(result.perPhase.EARLY?.trades).toBe(1);
		expect(result.perPhase.MID?.trades).toBe(1);
		expect(result.perPhase.LATE?.trades).toBe(1);
	});

	it("should compute max drawdown from running equity", () => {
		const signals = [makeSignal({ finalPrice: 101 }), makeSignal({ finalPrice: 99 }), makeSignal({ finalPrice: 99 })];
		const result = new BacktestEngine(makeStrategy(), 5).run(signals);

		expect(result.maxDrawdown).toBeCloseTo(4.6, 10);
	});

	it("should compute positive sharpe for improving daily returns", () => {
		const signals = [
			makeSignal({ timestamp: "2026-01-01T00:00:00.000Z", finalPrice: 101 }),
			makeSignal({ timestamp: "2026-01-02T00:00:00.000Z", finalPrice: 101, marketUp: 0.4 }),
			makeSignal({ timestamp: "2026-01-03T00:00:00.000Z", finalPrice: 101, marketUp: 0.35 }),
		];
		const result = new BacktestEngine(makeStrategy(), 5).run(signals);

		expect(result.sharpeRatio).toBeGreaterThan(0);
	});

	it("should compute infinite profit factor when there are no losses", () => {
		const result = new BacktestEngine(makeStrategy(), 5).run([
			makeSignal({ finalPrice: 101 }),
			makeSignal({ finalPrice: 102 }),
		]);

		expect(result.profitFactor).toBe(Number.POSITIVE_INFINITY);
	});

	it("should compute finite profit factor with wins and losses", () => {
		const result = new BacktestEngine(makeStrategy(), 5).run([
			makeSignal({ finalPrice: 101 }),
			makeSignal({ finalPrice: 99 }),
		]);

		expect(result.profitFactor).toBeCloseTo(2.7 / 2.3, 10);
	});

	it("should handle all losses", () => {
		const signals = makeSignals(5, () => ({ finalPrice: 99 }));
		const result = new BacktestEngine(makeStrategy()).run(signals);

		expect(result.wins).toBe(0);
		expect(result.losses).toBe(5);
		expect(result.winRate).toBe(0);
	});

	it("should handle all wins", () => {
		const signals = makeSignals(5, () => ({ finalPrice: 101 }));
		const result = new BacktestEngine(makeStrategy()).run(signals);

		expect(result.wins).toBe(5);
		expect(result.losses).toBe(0);
		expect(result.winRate).toBe(1);
	});
});

describe("runABTest", () => {
	it("should compare two strategies on same signal set", () => {
		const strategyA = makeStrategy({ edgeThresholdMid: 0.05 });
		const strategyB = makeStrategy({ edgeThresholdMid: 0.2 });
		const signals = makeSignals(10, (index) => ({ finalPrice: index < 5 ? 101 : 99, effectiveEdge: 0.1 }));

		const result = runABTest(strategyA, strategyB, signals);

		expect(result.strategyA.tradesEntered).toBe(10);
		expect(result.strategyB.tradesEntered).toBe(0);
		expect(result.winRateDiff).toBeGreaterThan(0);
	});

	it("should produce pValue=1 for no observations", () => {
		const strategy = makeStrategy({ edgeThresholdMid: 0.5 });
		const result = runABTest(strategy, strategy, [makeSignal({ effectiveEdge: 0.1 })]);

		expect(result.pValue).toBe(1);
		expect(result.isSignificant).toBe(false);
	});

	it("should detect significant difference with strong divergence", () => {
		const strategyA = makeStrategy({ edgeThresholdMid: 0.05 });
		const strategyB = makeStrategy({ edgeThresholdMid: 0.15 });
		const signals = makeSignals(80, (index) => {
			const losing = index % 2 === 1;
			return {
				effectiveEdge: losing ? 0.2 : 0.07,
				edge: losing ? 0.2 : 0.07,
				finalPrice: losing ? 99 : 101,
			};
		});

		const result = runABTest(strategyA, strategyB, signals);

		expect(result.strategyA.tradesEntered).toBe(80);
		expect(result.strategyB.tradesEntered).toBe(40);
		expect(result.strategyB.winRate).toBe(0);
		expect(result.isSignificant).toBe(true);
		expect(result.pValue).toBeLessThan(0.05);
	});

	it("should not mark similar outcomes as significant", () => {
		const strategyA = makeStrategy({ edgeThresholdMid: 0.08 });
		const strategyB = makeStrategy({ edgeThresholdMid: 0.09 });
		const signals = makeSignals(40, (index) => ({ finalPrice: index % 2 === 0 ? 101 : 99, effectiveEdge: 0.1 }));

		const result = runABTest(strategyA, strategyB, signals);

		expect(result.isSignificant).toBe(false);
		expect(result.pValue).toBeGreaterThan(0.05);
	});

	it("should apply tradeSize override", () => {
		const strategyA = makeStrategy({ edgeThresholdMid: 0.05 });
		const strategyB = makeStrategy({ edgeThresholdMid: 0.2 });
		const signals = makeSignals(4, () => ({ finalPrice: 101, effectiveEdge: 0.1, marketUp: 0.45 }));

		const result = runABTest(strategyA, strategyB, signals, 10);

		expect(result.strategyA.totalPnl).toBeCloseTo(22, 10);
		expect(result.strategyB.totalPnl).toBe(0);
	});
});

describe("optimizeParameters", () => {
	it("should evaluate cartesian grid combinations", () => {
		const base = makeStrategy();
		const grid: ParameterGrid = {
			edgeThresholdMid: [0.07, 0.09, 0.11],
			minProbMid: [0.55, 0.6],
			regimeMultipliers: { RANGE: [0.9, 1] },
		};
		const signals = makeSignals(10, () => ({ effectiveEdge: 0.1, finalPrice: 101 }));

		const result = optimizeParameters(base, grid, signals);

		expect(result.totalCombinations).toBe(12);
		expect(result.allResults.length).toBe(12);
	});

	it("should pick best config by totalPnl", () => {
		const base = makeStrategy();
		const grid: ParameterGrid = { edgeThresholdMid: [0.05, 0.15] };
		const signals = makeSignals(12, (index) => ({
			effectiveEdge: index < 6 ? 0.1 : 0.2,
			finalPrice: index < 6 ? 101 : 99,
		}));

		const result = optimizeParameters(base, grid, signals, "totalPnl");

		expect(result.bestConfig.edgeThresholdMid).toBe(0.05);
		expect(result.bestResult.totalPnl).toBe(result.allResults[0]?.result.totalPnl);
	});

	it("should support sorting by winRate", () => {
		const base = makeStrategy();
		const grid: ParameterGrid = { edgeThresholdMid: [0.05, 0.12] };
		const signals = makeSignals(12, (index) => ({
			effectiveEdge: index < 6 ? 0.1 : 0.14,
			finalPrice: index < 6 ? 99 : 101,
		}));

		const result = optimizeParameters(base, grid, signals, "winRate");

		expect(result.bestResult.winRate).toBe(result.allResults[0]?.result.winRate);
		expect(result.bestConfig.edgeThresholdMid).toBe(0.12);
	});

	it("should support sorting by sharpeRatio", () => {
		const base = makeStrategy();
		const grid: ParameterGrid = { edgeThresholdMid: [0.05, 0.1, 0.15] };
		const signals = makeSignals(30, (index) => ({
			effectiveEdge: index % 3 === 0 ? 0.11 : 0.16,
			finalPrice: index % 4 === 0 ? 99 : 101,
		}));

		const result = optimizeParameters(base, grid, signals, "sharpeRatio");

		expect(result.bestResult.sharpeRatio).toBe(result.allResults[0]?.result.sharpeRatio);
	});

	it("should use base config when grid is empty", () => {
		const base = makeStrategy();
		const signals = makeSignals(4, () => ({ finalPrice: 101 }));
		const result = optimizeParameters(base, {}, signals);

		expect(result.totalCombinations).toBe(1);
		expect(result.bestConfig.edgeThresholdMid).toBe(base.edgeThresholdMid);
	});

	it("should optimize regime multipliers", () => {
		const base = makeStrategy();
		const grid: ParameterGrid = {
			regimeMultipliers: {
				RANGE: [0.8, 1.1],
			},
		};
		const signals = makeSignals(10, () => ({ regime: "RANGE", effectiveEdge: 0.085, finalPrice: 101 }));

		const result = optimizeParameters(base, grid, signals, "totalPnl");

		expect(result.bestConfig.regimeMultipliers.RANGE).toBe(0.8);
	});
});

describe("crossValidate", () => {
	it("should split chronologically in walk-forward folds", () => {
		const config = makeStrategy();
		const signals = makeSignals(20, (index) => ({ finalPrice: index < 10 ? 101 : 99, effectiveEdge: 0.1 }));

		const result = crossValidate(config, signals, 5);

		expect(result.foldResults.length).toBe(4);
		expect(result.foldResults[0]?.totalPnl).toBeGreaterThan(result.foldResults[3]?.totalPnl ?? 0);
	});

	it("should clamp folds for tiny datasets", () => {
		const config = makeStrategy();
		const signals = makeSignals(2, () => ({ finalPrice: 101, effectiveEdge: 0.1 }));
		const result = crossValidate(config, signals, 10);

		expect(result.foldResults.length).toBe(1);
	});

	it("should compute average metrics across folds", () => {
		const config = makeStrategy();
		const signals = makeSignals(15, (index) => ({ finalPrice: index % 2 === 0 ? 101 : 99, effectiveEdge: 0.1 }));
		const result = crossValidate(config, signals, 5);

		expect(result.avgWinRate).toBeGreaterThanOrEqual(0);
		expect(result.avgWinRate).toBeLessThanOrEqual(1);
		expect(Number.isFinite(result.avgPnl)).toBe(true);
		expect(Number.isFinite(result.avgSharpe)).toBe(true);
	});

	it("should compute standard deviations", () => {
		const config = makeStrategy();
		const signals = makeSignals(20, (index) => ({
			finalPrice: index % 5 === 0 ? 99 : 101,
			effectiveEdge: index % 2 === 0 ? 0.1 : 0.12,
		}));
		const result = crossValidate(config, signals, 5);

		expect(result.stdWinRate).toBeGreaterThanOrEqual(0);
		expect(result.stdPnl).toBeGreaterThanOrEqual(0);
	});

	it("should flag overfit when one fold outperforms average by 10%+", () => {
		const config = makeStrategy();
		const signals = [
			...makeSignals(8, () => ({ finalPrice: 99, effectiveEdge: 0.1 })),
			...makeSignals(4, () => ({ finalPrice: 101, effectiveEdge: 0.1 })),
			...makeSignals(8, () => ({ finalPrice: 99, effectiveEdge: 0.1 })),
		];

		const result = crossValidate(config, signals, 5);

		expect(result.isOverfit).toBe(true);
	});

	it("should not flag overfit on stable performance", () => {
		const config = makeStrategy();
		const signals = makeSignals(25, (index) => {
			const indexWithinFold = index % 5;
			return {
				finalPrice: indexWithinFold < 2 ? 101 : 99,
				effectiveEdge: 0.1,
			};
		});

		const result = crossValidate(config, signals, 5);

		expect(result.isOverfit).toBe(false);
	});

	it("should use tradeSize in fold pnl", () => {
		const config = makeStrategy();
		const signals = makeSignals(10, () => ({ finalPrice: 101, effectiveEdge: 0.1, marketUp: 0.45 }));

		const small = crossValidate(config, signals, 5, 5);
		const large = crossValidate(config, signals, 5, 10);

		expect(large.avgPnl).toBeCloseTo(small.avgPnl * 2, 10);
	});
});
