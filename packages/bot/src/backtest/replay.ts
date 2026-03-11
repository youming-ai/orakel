import { CONFIG, getStrategyForMarket } from "../core/config.ts";
import type { MarketConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import type { Candle } from "../core/marketDataTypes.ts";
import { getActiveMarkets, getMarketById } from "../core/markets.ts";
import { fetchHistoricalKlines } from "../data/bybit.ts";
import { computeMarketDecision } from "../pipeline/compute.ts";
import {
	buildReplayRawMarketData,
	getWindowPriceToBeat,
	getWindowSettlePrice,
	groupCandlesByWindow,
	type ReplayTrade,
	resolveWinningSide,
	summarizeReplayTrades,
} from "./replayCore.ts";
import {
	applyReplayFillPricing,
	buildReplayMarketPricingContext,
	type ReplayFillOptions,
	resolveHistoricalPolyPrices,
} from "./replayPricing.ts";

const log = createLogger("backtest-replay");
const MIN_HISTORY_CANDLES = 240;

interface ReplayCliOptions {
	marketIds: string[];
	startTimeMs: number;
	endTimeMs: number;
	fillOptions: ReplayFillOptions;
}

function parseCliArgs(argv: string[]): ReplayCliOptions {
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

	const now = Date.now();
	const hours = Number(args.get("hours") ?? 72);
	const startRaw = args.get("start");
	const endRaw = args.get("end");
	const startTimeMs = startRaw ? Date.parse(startRaw) : now - hours * 60 * 60_000;
	const endTimeMs = endRaw ? Date.parse(endRaw) : now;
	const marketArg = args.get("market");
	const fillMode = args.get("fill") === "historical" ? "historical" : "fixed";
	const quoteMode = args.get("quote") === "historical" ? "historical" : "fixed";
	const quoteScope = args.get("quoteScope") === "traded" ? "traded" : "all";
	const stakeUsdc = Number(args.get("stake") ?? 1);
	const slippageBps = Number(args.get("slippageBps") ?? 10);
	const marketIds = marketArg
		? marketArg
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean)
		: getActiveMarkets().map((market) => market.id);

	if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || startTimeMs >= endTimeMs) {
		throw new Error("invalid_time_range");
	}

	return {
		marketIds,
		startTimeMs,
		endTimeMs,
		fillOptions: {
			fillMode,
			quoteMode,
			quoteScope,
			stakeUsdc: Number.isFinite(stakeUsdc) && stakeUsdc > 0 ? stakeUsdc : 1,
			slippageBps: Number.isFinite(slippageBps) && slippageBps >= 0 ? slippageBps : 10,
		},
	};
}

function formatPct(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function writeReport(text: string): void {
	process.stdout.write(`${text}\n`);
}

function summarizeEntryDiagnostics(trades: ReplayTrade[]): {
	avgTimeLeftMin: number;
	phaseBreakdown: string;
	blendBreakdown: string;
} {
	if (trades.length === 0) {
		return {
			avgTimeLeftMin: 0,
			phaseBreakdown: "none",
			blendBreakdown: "none",
		};
	}

	const phaseCounts = new Map<string, number>();
	const blendCounts = new Map<string, number>();
	let totalTimeLeftMin = 0;

	for (const trade of trades) {
		totalTimeLeftMin += trade.timeLeftMin;
		phaseCounts.set(trade.phase, (phaseCounts.get(trade.phase) ?? 0) + 1);
		blendCounts.set(trade.blendSource, (blendCounts.get(trade.blendSource) ?? 0) + 1);
	}

	const phaseBreakdown = [...phaseCounts.entries()]
		.sort((left, right) => right[1] - left[1])
		.map(([phase, count]) => `${phase}:${count}`)
		.join(",");
	const blendBreakdown = [...blendCounts.entries()]
		.sort((left, right) => right[1] - left[1])
		.map(([source, count]) => `${source}:${count}`)
		.join(",");

	return {
		avgTimeLeftMin: totalTimeLeftMin / trades.length,
		phaseBreakdown,
		blendBreakdown,
	};
}

async function replayMarket(params: {
	market: MarketConfig;
	candles: Candle[];
	fillOptions: ReplayFillOptions;
	context: Awaited<ReturnType<typeof buildReplayMarketPricingContext>>;
	windowStartFilter?: Set<number>;
}): Promise<ReplayTrade[]> {
	const { market, candles, fillOptions, context, windowStartFilter } = params;
	const trades: ReplayTrade[] = [];
	const windows = groupCandlesByWindow(candles, market.candleWindowMinutes);
	const strategy = getStrategyForMarket(market.id);

	for (const [windowStartMs, windowCandles] of windows) {
		if (windowStartFilter && !windowStartFilter.has(windowStartMs)) continue;
		const priceToBeat = getWindowPriceToBeat(windowCandles);
		const settlePrice = getWindowSettlePrice(windowCandles);
		if (priceToBeat === null || settlePrice === null) continue;

		let entered = false;
		for (const candle of windowCandles) {
			const candleIndex = candles.findIndex((item) => item.openTime === candle.openTime);
			if (candleIndex < MIN_HISTORY_CANDLES) continue;
			if (entered) break;

			const historyCandles = candles.slice(candleIndex - MIN_HISTORY_CANDLES, candleIndex);
			if (historyCandles.length < MIN_HISTORY_CANDLES) continue;

			const currentPrice = candle.close ?? candle.open;
			if (currentPrice === null) continue;

			const windowEndMs = windowStartMs + market.candleWindowMinutes * 60_000;
			const timeLeftMin = Math.max(0, (windowEndMs - candle.closeTime) / 60_000);
			const historicalPoly =
				fillOptions.quoteMode === "historical"
					? resolveHistoricalPolyPrices({
							market,
							windowStartMs,
							entryTimeMs: candle.closeTime,
							context,
						})
					: null;
			const rawMarketData = buildReplayRawMarketData({
				market,
				historyCandles,
				currentPrice,
				timeLeftMin,
				windowStartMs,
				polyPrices:
					historicalPoly && historicalPoly.up !== null && historicalPoly.down !== null
						? { up: historicalPoly.up, down: historicalPoly.down }
						: undefined,
				marketSlug: historicalPoly?.marketSlug,
				tokens: historicalPoly?.tokens,
			});

			const result = computeMarketDecision(rawMarketData, priceToBeat, CONFIG, strategy);
			if (result.rec.action !== "ENTER" || !result.rec.side) continue;

			const winningSide = resolveWinningSide(priceToBeat, settlePrice);
			trades.push({
				marketId: market.id,
				windowStartMs,
				entryTimeMs: candle.closeTime,
				timeLeftMin,
				side: result.rec.side,
				phase: result.rec.phase,
				strength: result.rec.strength ?? null,
				priceToBeat,
				settlePrice,
				modelUp: result.finalUp,
				modelDown: result.finalDown,
				volImpliedUp: result.volImpliedUp,
				blendSource: result.blendSource,
				won: result.rec.side === winningSide,
			});
			entered = true;
		}
	}

	return trades;
}

async function main(): Promise<void> {
	const options = parseCliArgs(process.argv.slice(2));
	const markets = options.marketIds
		.map((marketId) => getMarketById(marketId))
		.filter((market): market is MarketConfig => market !== null);

	if (markets.length === 0) {
		throw new Error("no_valid_markets");
	}

	writeReport(
		`Replay window: ${new Date(options.startTimeMs).toISOString()} -> ${new Date(options.endTimeMs).toISOString()} | quote=${options.fillOptions.quoteMode} | quoteScope=${options.fillOptions.quoteScope} | fill=${options.fillOptions.fillMode} | stake=${options.fillOptions.stakeUsdc} | slippageBps=${options.fillOptions.slippageBps}`,
	);

	const allTrades: ReplayTrade[] = [];
	for (const market of markets) {
		log.info(`Fetching historical candles for ${market.id}`);
		const candles = await fetchHistoricalKlines({
			symbol: market.spotSymbol,
			interval: "1m",
			startTime: options.startTimeMs,
			endTime: options.endTimeMs,
		});
		if (candles.length <= MIN_HISTORY_CANDLES) {
			writeReport(`${market.id}: insufficient candles (${candles.length})`);
			continue;
		}

		let windowStartFilter: Set<number> | undefined;
		if (options.fillOptions.quoteMode === "historical" && options.fillOptions.quoteScope === "traded") {
			const baselineTrades = await replayMarket({
				market,
				candles,
				fillOptions: {
					...options.fillOptions,
					quoteMode: "fixed",
				},
				context: {
					marketIndex: new Map(),
					tokenHistoryByTokenId: new Map(),
				},
			});
			windowStartFilter = new Set(baselineTrades.map((trade) => trade.windowStartMs));
		}
		const pricingContext = await buildReplayMarketPricingContext({
			market,
			startTimeMs: options.startTimeMs,
			endTimeMs: options.endTimeMs,
			options: options.fillOptions,
			windowStartFilter,
		});
		const trades = await replayMarket({
			market,
			candles,
			fillOptions: options.fillOptions,
			context: pricingContext,
			windowStartFilter,
		});
		const pricedTrades = await applyReplayFillPricing({
			market,
			trades,
			context: pricingContext,
			options: options.fillOptions,
		});
		allTrades.push(...pricedTrades);
		const totalWindows = Math.max(0, groupCandlesByWindow(candles, market.candleWindowMinutes).size);
		const diagnostics = summarizeEntryDiagnostics(pricedTrades);
		const summary = summarizeReplayTrades(pricedTrades);
		writeReport(
			`${market.id}: trades=${summary.totalTrades} wins=${summary.wins} losses=${summary.losses} winRate=${formatPct(summary.winRate)} coverage=${formatPct(totalWindows > 0 ? summary.totalTrades / totalWindows : 0)} priced=${summary.pricedTrades}/${summary.totalTrades} pnl=${summary.totalPnlUsdc.toFixed(2)} avgTimeLeft=${diagnostics.avgTimeLeftMin.toFixed(1)}m phases=${diagnostics.phaseBreakdown} blend=${diagnostics.blendBreakdown}`,
		);
	}

	const totalSummary = summarizeReplayTrades(allTrades);
	writeReport("");
	writeReport(
		`TOTAL: trades=${totalSummary.totalTrades} wins=${totalSummary.wins} losses=${totalSummary.losses} winRate=${formatPct(totalSummary.winRate)} priced=${totalSummary.pricedTrades}/${totalSummary.totalTrades} pnl=${totalSummary.totalPnlUsdc.toFixed(2)}`,
	);

	for (const [marketId, summary] of Object.entries(totalSummary.byMarket)) {
		writeReport(
			`  ${marketId}: trades=${summary.trades} wins=${summary.wins} losses=${summary.losses} winRate=${formatPct(summary.winRate)} priced=${summary.pricedTrades}/${summary.trades} pnl=${summary.pnlUsdc.toFixed(2)}`,
		);
	}
}

void main().catch((err) => {
	log.error("Replay failed", err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});
