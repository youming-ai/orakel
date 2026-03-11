import { createLogger } from "../core/logger.ts";
import { getActiveMarkets } from "../core/markets.ts";
import {
	createDefaultPeriods,
	formatBacktestResults,
	type MultiPeriodBacktestResult,
	runMultiPeriodBacktest,
} from "./multiPeriodBacktest.ts";
import {
	calculateCombinedScore,
	createDefaultParameterSpace,
	createUniversalStrategy,
	generateRandomParameters,
	type OptimizationResult,
} from "./strategyOptimizer.ts";

const log = createLogger("strategy-optimize-cli");

interface OptimizeCliOptions {
	markets: string[];
	iterations: number;
	endTimeMs: number;
	outputPath?: string;
}

function parseCliArgs(argv: string[]): OptimizeCliOptions {
	const args = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token?.startsWith("--")) continue;
		const key = token.slice(2);
		const value = argv[i + 1];
		if (value && !value.startsWith("--")) {
			args.set(key, value);
			i += 1;
			continue;
		}
		args.set(key, "true");
	}

	const marketsArg = args.get("markets");
	const markets = marketsArg
		? marketsArg
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: getActiveMarkets().map((m) => m.id);

	const iterations = Math.max(10, Math.min(1000, Number(args.get("iterations") ?? 100)));
	const daysAgo = Math.max(1, Number(args.get("daysAgo") ?? 0));
	const endTimeMs = daysAgo > 0 ? Date.now() - daysAgo * 24 * 60 * 60 * 1000 : Date.now();

	return {
		markets,
		iterations,
		endTimeMs,
		outputPath: args.get("output"),
	};
}

async function optimizeMarket(
	marketId: string,
	iterations: number,
	endTimeMs: number,
): Promise<OptimizationResult | null> {
	log.info(`Optimizing strategy for ${marketId}...`);

	const parameterSpace = createDefaultParameterSpace();
	const periods = createDefaultPeriods();

	let bestResult: OptimizationResult | null = null;
	let bestScore = -Infinity;

	for (let i = 0; i < iterations; i++) {
		if (i > 0 && i % 10 === 0) {
			log.info(`  Progress: ${i}/${iterations} iterations, best score: ${bestScore.toFixed(2)}`);
		}

		const params = generateRandomParameters(parameterSpace, 1)[0];
		if (!params) continue;

		try {
			const results = await runMultiPeriodBacktest({
				marketIds: [marketId],
				periods,
				strategy: params,
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
			if (!result) continue;

			const periodMap = new Map<number, MultiPeriodBacktestResult["periodResults"][number]["summary"]>();
			for (const pr of result.periodResults) {
				periodMap.set(pr.period.days, pr.summary);
			}

			const score = calculateCombinedScore(
				periodMap,
				periods.map((p) => ({ ...p, startTimeMs: endTimeMs - p.days * 24 * 60 * 60 * 1000, endTimeMs })),
			);

			if (score > bestScore) {
				bestScore = score;
				bestResult = {
					params,
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
			}
		} catch (err) {
			log.warn(`  Error in iteration ${i}:`, err instanceof Error ? err.message : String(err));
		}
	}

	if (bestResult) {
		log.info(`  Best score for ${marketId}: ${bestResult.score.toFixed(2)}`);
		log.info(
			`  Win rate: ${(bestResult.metrics.winRate * 100).toFixed(1)}%, PnL: ${bestResult.metrics.pnl.toFixed(2)} USDC`,
		);
	}

	return bestResult;
}

async function main(): Promise<void> {
	const options = parseCliArgs(process.argv.slice(2));

	log.info("=".repeat(80));
	log.info("STRATEGY OPTIMIZATION");
	log.info("=".repeat(80));
	log.info(`Markets: ${options.markets.join(", ")}`);
	log.info(`Iterations: ${options.iterations}`);
	log.info(`End time: ${new Date(options.endTimeMs).toISOString()}`);
	log.info("");

	const optimizationResults = new Map<string, OptimizationResult>();

	for (const marketId of options.markets) {
		const result = await optimizeMarket(marketId, options.iterations, options.endTimeMs);
		if (result) {
			optimizationResults.set(marketId, result);
		}
	}

	log.info(`\n${"=".repeat(80)}`);
	log.info("OPTIMIZATION COMPLETE");
	log.info("=".repeat(80));

	for (const [marketId, result] of optimizationResults) {
		log.info(`\n${marketId} Optimal Parameters:`);
		log.info(`  Score: ${result.score.toFixed(2)}`);
		log.info(`  Win Rate: ${(result.metrics.winRate * 100).toFixed(1)}%`);
		log.info(`  Total PnL: ${result.metrics.pnl.toFixed(2)} USDC`);
		log.info(`  Total Trades: ${result.metrics.totalTrades}`);
		log.info("  Parameters:");
		log.info(`    edgeThresholdEarly: ${result.params.edgeThresholdEarly}`);
		log.info(`    edgeThresholdMid: ${result.params.edgeThresholdMid}`);
		log.info(`    edgeThresholdLate: ${result.params.edgeThresholdLate}`);
		log.info(`    minProbEarly: ${result.params.minProbEarly}`);
		log.info(`    minProbMid: ${result.params.minProbMid}`);
		log.info(`    minProbLate: ${result.params.minProbLate}`);
		log.info(`    minTimeLeftMin: ${result.params.minTimeLeftMin}`);
		log.info(`    maxTimeLeftMin: ${result.params.maxTimeLeftMin}`);
		log.info(`    minVolatility15m: ${result.params.minVolatility15m}`);
		log.info(`    maxVolatility15m: ${result.params.maxVolatility15m}`);
		log.info(`    candleAggregationMinutes: ${result.params.candleAggregationMinutes}`);
		log.info(`    edgeDownBias: ${result.params.edgeDownBias}`);
	}

	if (optimizationResults.has("BTC-15m") && optimizationResults.has("ETH-15m")) {
		const btcResult = optimizationResults.get("BTC-15m");
		const ethResult = optimizationResults.get("ETH-15m");

		if (btcResult && ethResult) {
			const universalStrategy = createUniversalStrategy(btcResult, ethResult);

			log.info(`\n${"=".repeat(80)}`);
			log.info("UNIVERSAL STRATEGY (Averaged from BTC-15m and ETH-15m)");
			log.info("=".repeat(80));
			log.info(JSON.stringify(universalStrategy, null, 2));

			log.info("\nValidating universal strategy...");
			const universalResults = await runMultiPeriodBacktest({
				marketIds: ["BTC-15m", "ETH-15m"],
				periods: createDefaultPeriods(),
				strategy: universalStrategy,
				fillOptions: {
					fillMode: "fixed",
					quoteMode: "fixed",
					quoteScope: "all",
					stakeUsdc: 1,
					slippageBps: 10,
				},
				endTimeMs: options.endTimeMs,
			});

			log.info(formatBacktestResults(universalResults));
		}
	}

	if (options.outputPath) {
		const output = {
			optimized: Object.fromEntries(optimizationResults),
			universal:
				optimizationResults.has("BTC-15m") && optimizationResults.has("ETH-15m")
					? createUniversalStrategy(
							optimizationResults.get("BTC-15m") as NonNullable<ReturnType<typeof optimizationResults.get>>,
							optimizationResults.get("ETH-15m") as NonNullable<ReturnType<typeof optimizationResults.get>>,
						)
					: null,
		};
		await Bun.write(options.outputPath, JSON.stringify(output, null, 2));
		log.info(`\nResults saved to: ${options.outputPath}`);
	}
}

void main().catch((err) => {
	log.error("Optimization failed:", err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});
