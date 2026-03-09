import { writeFile } from "node:fs/promises";
import type { StrategyConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import { getActiveMarkets } from "../core/markets.ts";
import { createDefaultPeriods, type MultiPeriodBacktestResult, runMultiPeriodBacktest } from "./multiPeriodBacktest.ts";
import {
	calculateCombinedScore,
	createDefaultParameterSpace,
	createUniversalStrategy,
	generateRandomParameters,
	type OptimizationResult,
} from "./strategyOptimizer.ts";

const log = createLogger("quick-optimize");

interface QuickOptimizeOptions {
	markets: string[];
	iterations: number;
	endTimeMs: number;
	outputPath: string;
}

function parseArgs(argv: string[]): QuickOptimizeOptions {
	const args = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token?.startsWith("--")) continue;
		const key = token.slice(2);
		const value = argv[i + 1];
		if (value && !value.startsWith("--")) {
			args.set(key, value);
			i++;
		}
	}

	const marketsArg = args.get("markets");
	const markets = marketsArg
		? marketsArg
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: getActiveMarkets().map((m) => m.id);

	return {
		markets,
		iterations: Math.min(200, Number(args.get("iterations") ?? 50)),
		endTimeMs: Date.now(),
		outputPath: args.get("output") ?? "optimized_strategy.json",
	};
}

async function optimizeMarket(marketId: string, iterations: number, endTimeMs: number): Promise<OptimizationResult> {
	log.info(`Optimizing ${marketId}...`);

	const space = createDefaultParameterSpace();
	const periods = createDefaultPeriods();

	const batchSize = 10;
	let bestResult: OptimizationResult | null = null;
	let bestScore = -Infinity;

	for (let batch = 0; batch < iterations / batchSize; batch++) {
		const params = generateRandomParameters(space, batchSize);

		const evaluations = await Promise.all(
			params.map(async (p) => {
				try {
					const results = await runMultiPeriodBacktest({
						marketIds: [marketId],
						periods,
						strategy: p,
						fillOptions: {
							fillMode: "fixed",
							quoteMode: "fixed",
							quoteScope: "all",
							stakeUsdc: 1,
							slippageBps: 10,
						},
						endTimeMs,
					});

					const result = results.get(marketId);
					if (!result) return null;

					const periodMap = new Map<number, MultiPeriodBacktestResult["periodResults"][number]["summary"]>();
					for (const pr of result.periodResults) {
						periodMap.set(pr.period.days, pr.summary);
					}

					const score = calculateCombinedScore(
						periodMap,
						periods.map((p) => ({ ...p, startTimeMs: endTimeMs - p.days * 24 * 60 * 60 * 1000, endTimeMs })),
					);

					return {
						params: p,
						score,
						metrics: {
							totalTrades: result.totalTrades,
							winRate: result.avgWinRate,
							pnl: result.totalPnl,
							sharpeRatio: 0,
							maxDrawdown: 0,
							profitFactor: 0,
						},
					};
				} catch (err) {
					return null;
				}
			}),
		);

		for (const eval_ of evaluations) {
			if (eval_ && eval_.score > bestScore) {
				bestScore = eval_.score;
				bestResult = eval_;
			}
		}

		if ((batch + 1) % 5 === 0) {
			log.info(`  Progress: ${(batch + 1) * batchSize}/${iterations}, Best Score: ${bestScore.toFixed(2)}`);
		}
	}

	if (!bestResult) {
		throw new Error(`Optimization failed for ${marketId}`);
	}

	return bestResult;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));

	log.info("================================================================================");
	log.info("QUICK STRATEGY OPTIMIZATION (Parallel)");
	log.info("================================================================================");
	log.info(`Markets: ${options.markets.join(", ")}`);
	log.info(`Iterations per market: ${options.iterations}`);
	log.info(`Output: ${options.outputPath}`);
	log.info("");

	const startTime = Date.now();

	// 并行优化所有市场
	const results = await Promise.all(
		options.markets.map((marketId) =>
			optimizeMarket(marketId, options.iterations, options.endTimeMs).catch((err) => {
				log.error(`Failed to optimize ${marketId}:`, err);
				return null;
			}),
		),
	);

	const optimizationResults = new Map<string, OptimizationResult>();
	for (let i = 0; i < options.markets.length; i++) {
		const result = results[i];
		const marketId = options.markets[i];
		if (result && marketId) {
			optimizationResults.set(marketId, result);
		}
	}

	const duration = (Date.now() - startTime) / 1000;

	log.info("\n================================================================================");
	log.info(`OPTIMIZATION COMPLETE (${duration.toFixed(1)}s)`);
	log.info("================================================================================");

	for (const [marketId, result] of optimizationResults) {
		log.info(`\n${marketId}:`);
		log.info(
			`  Score: ${result.score.toFixed(2)} | Win Rate: ${(result.metrics.winRate * 100).toFixed(1)}% | Trades: ${result.metrics.totalTrades}`,
		);
	}

	let universal: StrategyConfig | null = null;
	if (optimizationResults.has("BTC-15m") && optimizationResults.has("ETH-15m")) {
		const btc = optimizationResults.get("BTC-15m")!;
		const eth = optimizationResults.get("ETH-15m")!;
		universal = createUniversalStrategy(btc, eth);

		log.info("\n================================================================================");
		log.info("UNIVERSAL STRATEGY");
		log.info("================================================================================");
		log.info(JSON.stringify(universal, null, 2));
	}

	const output = {
		timestamp: new Date().toISOString(),
		duration: duration,
		optimized: Object.fromEntries(
			Array.from(optimizationResults.entries()).map(([k, v]) => [k, { score: v.score, params: v.params }]),
		),
		universal,
		recommendation: universal
			? "Replace config.json strategy.default with the universal strategy above"
			: "See individual market results",
	};

	await writeFile(options.outputPath, JSON.stringify(output, null, 2));
	log.info(`\nResults saved to: ${options.outputPath}`);

	if (universal) {
		const btcScore = optimizationResults.get("BTC-15m")?.score ?? 0;
		const ethScore = optimizationResults.get("ETH-15m")?.score ?? 0;
		const avgScore = (btcScore + ethScore) / 2;

		log.info("\n================================================================================");
		log.info("RECOMMENDATION");
		log.info("================================================================================");
		if (avgScore > 80) {
			log.info("Excellent results! Consider updating config.json with the universal strategy.");
		} else if (avgScore > 75) {
			log.info("Good results. The universal strategy is ready to use.");
		} else {
			log.info("Moderate results. Consider running more iterations for better optimization.");
		}
	}
}

void main().catch((err) => {
	log.error("Optimization failed:", err);
	process.exit(1);
});
