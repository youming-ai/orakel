import { createLogger } from "../core/logger.ts";
import { getActiveMarkets } from "../core/markets.ts";
import { createDefaultPeriods, formatBacktestResults, runMultiPeriodBacktest } from "./multiPeriodBacktest.ts";
import type { ReplayFillOptions } from "./replayPricing.ts";

const log = createLogger("backtest-cli");

interface BacktestCliOptions {
	markets: string[];
	periods: Array<{ name: string; days: number }>;
	strategyKey: string;
	fillOptions: ReplayFillOptions;
	endTimeMs: number;
}

function parseCliArgs(argv: string[]): BacktestCliOptions {
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

	const periodsArg = args.get("periods");
	const periods = periodsArg
		? periodsArg.split(",").map((s) => {
				const days = Number(s.trim());
				return { name: `${days}d`, days };
			})
		: createDefaultPeriods();

	const strategyKey = args.get("strategy") ?? "default";
	const daysAgo = Math.max(0, Number(args.get("daysAgo") ?? 0));
	const endTimeMs = daysAgo > 0 ? Date.now() - daysAgo * 24 * 60 * 60 * 1000 : Date.now();

	const stakeUsdc = Number(args.get("stake") ?? 1);
	const slippageBps = Number(args.get("slippageBps") ?? 10);

	return {
		markets,
		periods,
		strategyKey,
		fillOptions: {
			fillMode: (args.get("fillMode") as "fixed" | "historical") ?? "fixed",
			quoteMode: (args.get("quoteMode") as "fixed" | "historical") ?? "fixed",
			quoteScope: (args.get("quoteScope") as "all" | "traded") ?? "all",
			stakeUsdc: Number.isFinite(stakeUsdc) && stakeUsdc > 0 ? stakeUsdc : 1,
			slippageBps: Number.isFinite(slippageBps) && slippageBps >= 0 ? slippageBps : 10,
		},
		endTimeMs,
	};
}

async function main(): Promise<void> {
	const options = parseCliArgs(process.argv.slice(2));

	log.info("=".repeat(80));
	log.info("MULTI-PERIOD BACKTEST");
	log.info("=".repeat(80));
	log.info(`Markets: ${options.markets.join(", ")}`);
	log.info(`Periods: ${options.periods.map((p) => p.name).join(", ")}`);
	log.info(`Strategy: ${options.strategyKey}`);
	log.info(`End time: ${new Date(options.endTimeMs).toISOString()}`);
	log.info("");

	const results = await runMultiPeriodBacktest({
		marketIds: options.markets,
		periods: options.periods,
		strategy: await loadStrategyFromConfig(options.strategyKey),
		fillOptions: options.fillOptions,
		endTimeMs: options.endTimeMs,
	});

	log.info(formatBacktestResults(results));
}

async function loadStrategyFromConfig(key: string) {
	const config = await import("../core/config.ts");
	const { getStrategyForMarket } = config;

	if (key === "universal") {
		return {
			edgeThresholdEarly: 0.04,
			edgeThresholdMid: 0.065,
			edgeThresholdLate: 0.09,
			minProbEarly: 0.55,
			minProbMid: 0.58,
			minProbLate: 0.62,
			maxGlobalTradesPerWindow: 2,
			skipMarkets: [],
			minTimeLeftMin: 3,
			maxTimeLeftMin: 11.5,
			minVolatility15m: 0.00175,
			maxVolatility15m: 0.03,
			candleAggregationMinutes: 2,
			minPriceToBeatMovePct: 0.001,
			minExpectedEdge: 0.05,
			maxEntryPrice: 0.58,
			edgeDownBias: 0.02,
		};
	}

	return getStrategyForMarket(key === "default" ? "BTC-15m" : key);
}

void main().catch((err) => {
	log.error("Backtest failed:", err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});
