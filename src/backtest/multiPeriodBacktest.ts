import { getStrategyForMarket } from "../core/config.ts";
import type { MarketConfig, StrategyConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import type { Candle } from "../core/marketDataTypes.ts";
import { getMarketById } from "../core/markets.ts";
import { fetchHistoricalKlines } from "../data/binance.ts";
import { computeMarketDecision } from "../pipeline/compute.ts";
import {
	buildReplayRawMarketData,
	getWindowPriceToBeat,
	getWindowSettlePrice,
	groupCandlesByWindow,
	type ReplaySummary,
	type ReplayTrade,
	resolveWinningSide,
	summarizeReplayTrades,
} from "./replayCore.ts";
import {
	applyFixedFillPricing,
	applyReplayFillPricing,
	buildReplayMarketPricingContext,
	type ReplayFillOptions,
	type ReplayMarketPricingContext,
	resolveHistoricalPolyPrices,
} from "./replayPricing.ts";

const log = createLogger("multi-period-backtest");
const MIN_HISTORY_CANDLES = 240;

export interface BacktestOptions {
	marketIds: string[];
	periods: Array<{ name: string; days: number }>;
	strategy?: StrategyConfig;
	fillOptions: ReplayFillOptions;
	endTimeMs?: number;
}

export interface PeriodBacktestResult {
	period: { name: string; days: number };
	startTimeMs: number;
	endTimeMs: number;
	summary: ReplaySummary;
	trades: ReplayTrade[];
}

export interface MultiPeriodBacktestResult {
	marketId: string;
	periodResults: PeriodBacktestResult[];
	combinedScore: number;
	avgWinRate: number;
	totalTrades: number;
	totalPnl: number;
}

export async function runMultiPeriodBacktest(
	options: BacktestOptions,
): Promise<Map<string, MultiPeriodBacktestResult>> {
	const results = new Map<string, MultiPeriodBacktestResult>();
	const markets = options.marketIds.map((id) => getMarketById(id)).filter((m): m is MarketConfig => m !== null);

	if (markets.length === 0) {
		throw new Error("No valid markets specified");
	}

	const endTimeMs = options.endTimeMs ?? Date.now();

	for (const market of markets) {
		log.info(`Running multi-period backtest for ${market.id}`);
		const periodResults: PeriodBacktestResult[] = [];

		for (const period of options.periods) {
			const startTimeMs = endTimeMs - period.days * 24 * 60 * 60 * 1000;
			log.info(
				`  Period: ${period.name} (${period.days} days) - ${new Date(startTimeMs).toISOString()} to ${new Date(endTimeMs).toISOString()}`,
			);

			try {
				const candles = await fetchHistoricalKlines({
					symbol: market.binanceSymbol,
					interval: "1m",
					startTime: startTimeMs,
					endTime: endTimeMs,
				});

				if (candles.length <= MIN_HISTORY_CANDLES) {
					log.warn(`    Insufficient candles for ${market.id} ${period.name}: ${candles.length}`);
					continue;
				}

				const marketStrategy = options.strategy ?? getStrategyForMarket(market.id);
				const needsHistoricalPricing =
					options.fillOptions.quoteMode === "historical" || options.fillOptions.fillMode === "historical";
				let windowStartFilter: Set<number> | undefined;

				if (needsHistoricalPricing && options.fillOptions.quoteScope === "traded") {
					const baselineTrades = replayMarketWithStrategy({
						market,
						candles,
						strategy: marketStrategy,
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
					startTimeMs,
					endTimeMs,
					options: options.fillOptions,
					windowStartFilter,
				});

				const rawTrades = replayMarketWithStrategy({
					market,
					candles,
					strategy: marketStrategy,
					fillOptions: options.fillOptions,
					context: pricingContext,
					windowStartFilter,
				});

				let trades: ReplayTrade[];
				if (options.fillOptions.fillMode === "historical") {
					trades = await applyReplayFillPricing({
						market,
						trades: rawTrades,
						context: pricingContext,
						options: options.fillOptions,
					});
				} else {
					trades = applyFixedFillPricing(rawTrades, options.fillOptions);
				}

				const summary = summarizeReplayTrades(trades);

				periodResults.push({
					period,
					startTimeMs,
					endTimeMs,
					summary,
					trades,
				});

				log.info(
					`    Trades: ${summary.totalTrades}, WinRate: ${(summary.winRate * 100).toFixed(1)}%, PnL: ${summary.totalPnlUsdc.toFixed(2)}`,
				);
			} catch (err) {
				log.error(`    Error in period ${period.name}:`, err instanceof Error ? err.message : String(err));
			}
		}

		if (periodResults.length > 0) {
			const totalTrades = periodResults.reduce((sum, r) => sum + r.summary.totalTrades, 0);
			const totalPnl = periodResults.reduce((sum, r) => sum + r.summary.totalPnlUsdc, 0);
			const avgWinRate = periodResults.reduce((sum, r) => sum + r.summary.winRate, 0) / periodResults.length;

			results.set(market.id, {
				marketId: market.id,
				periodResults,
				combinedScore: calculateWeightedScore(periodResults),
				avgWinRate,
				totalTrades,
				totalPnl,
			});
		}
	}

	return results;
}

function replayMarketWithStrategy(params: {
	market: MarketConfig;
	candles: Candle[];
	strategy: StrategyConfig;
	fillOptions: ReplayFillOptions;
	context: ReplayMarketPricingContext;
	windowStartFilter?: Set<number>;
}): ReplayTrade[] {
	const { market, candles, strategy, fillOptions, context, windowStartFilter } = params;
	const trades: ReplayTrade[] = [];
	const windows = groupCandlesByWindow(candles, market.candleWindowMinutes);

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
				marketSlug: historicalPoly?.marketSlug ?? `backtest-${market.id}-${windowStartMs}`,
				tokens: historicalPoly?.tokens,
			});

			const mockConfig = {
				markets: [market],
				binanceBaseUrl: "https://api.binance.com",
				gammaBaseUrl: "https://gamma-api.polymarket.com",
				clobBaseUrl: "https://clob.polymarket.com",
				pollIntervalMs: 1000,
				vwapSlopeLookbackMinutes: 5,
				rsiPeriod: 14,
				rsiMaPeriod: 14,
				macdFast: 12,
				macdSlow: 26,
				macdSignal: 9,
				paperMode: true,
				polymarket: {
					marketSlug: "",
					autoSelectLatest: true,
					liveDataWsUrl: "",
					upOutcomeLabel: "Yes",
					downOutcomeLabel: "No",
				},
				chainlink: {
					polygonRpcUrls: [],
					polygonRpcUrl: "",
					polygonWssUrls: [],
					polygonWssUrl: "",
					btcUsdAggregator: "",
				},
				strategy,
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.04,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 2,
					minLiquidity: 5000,
					maxTradesPerWindow: 2,
				},
				paperRisk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.04,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 2,
					minLiquidity: 5000,
					maxTradesPerWindow: 2,
				},
				liveRisk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.04,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 2,
					minLiquidity: 5000,
					maxTradesPerWindow: 2,
				},
			};

			const result = computeMarketDecision(rawMarketData, priceToBeat, mockConfig, strategy);
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

function calculateWeightedScore(periodResults: PeriodBacktestResult[]): number {
	let totalScore = 0;
	let totalWeight = 0;

	for (const result of periodResults) {
		const { days } = result.period;
		const weight = days <= 7 ? 0.3 : days <= 30 ? 0.4 : 0.3;
		const { summary } = result;

		let score = summary.winRate * 100;
		const avgPnl = summary.totalTrades > 0 ? summary.totalPnlUsdc / summary.totalTrades : 0;
		score += avgPnl * 10;

		if (summary.winRate < 0.45) score -= 30;
		if (summary.totalPnlUsdc < 0) score -= 20;

		totalScore += score * weight;
		totalWeight += weight;
	}

	return totalWeight > 0 ? totalScore / totalWeight : 0;
}

export function formatBacktestResults(results: Map<string, MultiPeriodBacktestResult>): string {
	const lines: string[] = [];
	lines.push("=".repeat(80));
	lines.push("MULTI-PERIOD BACKTEST RESULTS");
	lines.push("=".repeat(80));

	for (const [marketId, result] of results) {
		lines.push(`\n${marketId}:`);
		lines.push(`  Combined Score: ${result.combinedScore.toFixed(2)}`);
		lines.push(`  Avg Win Rate: ${(result.avgWinRate * 100).toFixed(1)}%`);
		lines.push(`  Total Trades: ${result.totalTrades}`);
		lines.push(`  Total PnL: ${result.totalPnl.toFixed(2)} USDC`);
		lines.push("  Period Details:");

		for (const pr of result.periodResults) {
			const { summary } = pr;
			lines.push(
				`    ${pr.period.name.padEnd(6)} | Trades: ${String(summary.totalTrades).padStart(3)} | ` +
					`Wins: ${String(summary.wins).padStart(3)} | Losses: ${String(summary.losses).padStart(3)} | ` +
					`WinRate: ${(summary.winRate * 100).toFixed(1).padStart(5)}% | ` +
					`PnL: ${summary.totalPnlUsdc.toFixed(2).padStart(8)} USDC`,
			);
		}
	}

	lines.push(`\n${"=".repeat(80)}`);
	return lines.join("\n");
}

export function createDefaultPeriods(): Array<{ name: string; days: number }> {
	return [
		{ name: "7d", days: 7 },
		{ name: "30d", days: 30 },
		{ name: "180d", days: 180 },
	];
}
