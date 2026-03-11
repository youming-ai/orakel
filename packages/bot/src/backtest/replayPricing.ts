import type { MarketConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import {
	type ClobPriceHistoryPoint,
	fetchClobPriceHistory,
	fetchHistoricalMarketsBySeriesSlug,
	type GammaMarket,
	parseOutcomeTokenIds,
} from "../data/polymarket.ts";
import type { ReplayTrade } from "./replayCore.ts";

const log = createLogger("backtest-replay-pricing");

export interface ReplayFillOptions {
	fillMode: "fixed" | "historical";
	quoteMode: "fixed" | "historical";
	quoteScope: "all" | "traded";
	stakeUsdc: number;
	slippageBps: number;
}

export interface ReplayMarketPricingContext {
	marketIndex: Map<number, GammaMarket>;
	tokenHistoryByTokenId: Map<string, ClobPriceHistoryPoint[]>;
}

function getWindowEndMs(windowStartMs: number, windowMinutes: number): number {
	return windowStartMs + windowMinutes * 60_000;
}

function normalizeWindowEndMs(endMs: number, windowMinutes: number): number {
	const windowMs = windowMinutes * 60_000;
	return Math.round(endMs / windowMs) * windowMs;
}

function pickHistoricalEntryPrice(points: ClobPriceHistoryPoint[], entryTimeMs: number): number | null {
	if (points.length === 0) return null;
	const entryTimeSec = Math.floor(entryTimeMs / 1000);

	let lastBeforeOrAt: ClobPriceHistoryPoint | null = null;
	for (const point of points) {
		if (point.timestampSec <= entryTimeSec) {
			lastBeforeOrAt = point;
			continue;
		}
		break;
	}
	if (lastBeforeOrAt) return lastBeforeOrAt.price;

	const firstAfter = points[0];
	return firstAfter ? firstAfter.price : null;
}

async function mapWithConcurrency<T, R>(
	items: T[],
	worker: (item: T, index: number) => Promise<R>,
	concurrency: number,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;

	const runWorker = async (): Promise<void> => {
		while (cursor < items.length) {
			const currentIndex = cursor;
			cursor += 1;
			results[currentIndex] = await worker(items[currentIndex] as T, currentIndex);
		}
	};

	const workers = Array.from({ length: Math.max(1, concurrency) }, () => runWorker());
	await Promise.all(workers);
	return results;
}

export function computeBinaryPnlUsdc(params: {
	entryPrice: number;
	won: boolean;
	stakeUsdc: number;
	slippageBps: number;
}): { effectiveEntryPrice: number; pnlUsdc: number } | null {
	const { entryPrice, won, stakeUsdc, slippageBps } = params;
	if (
		!Number.isFinite(entryPrice) ||
		entryPrice <= 0 ||
		entryPrice >= 1 ||
		!Number.isFinite(stakeUsdc) ||
		stakeUsdc <= 0
	) {
		return null;
	}

	const effectiveEntryPrice = Math.min(0.999, Math.max(0.001, entryPrice * (1 + slippageBps / 10_000)));
	const shares = stakeUsdc / effectiveEntryPrice;
	const pnlUsdc = won ? shares * (1 - effectiveEntryPrice) : -stakeUsdc;

	return { effectiveEntryPrice, pnlUsdc };
}

function buildHistoricalMarketIndex(markets: GammaMarket[], windowMinutes: number): Map<number, GammaMarket> {
	const index = new Map<number, GammaMarket>();
	for (const market of markets) {
		const endMs = new Date(market.endDate).getTime();
		if (!Number.isFinite(endMs)) continue;
		index.set(normalizeWindowEndMs(endMs, windowMinutes), market);
	}
	return index;
}

async function buildTokenHistoryMap(params: {
	market: MarketConfig;
	historicalMarkets: GammaMarket[];
}): Promise<Map<string, ClobPriceHistoryPoint[]>> {
	const { market, historicalMarkets } = params;
	const tokenRanges = new Map<string, { startTimeSec: number; endTimeSec: number }>();

	for (const historicalMarket of historicalMarkets) {
		const tokenIds = parseOutcomeTokenIds(historicalMarket);
		const marketEndMs = new Date(historicalMarket.endDate).getTime();
		if (!Number.isFinite(marketEndMs)) continue;
		const marketStartMs = marketEndMs - market.candleWindowMinutes * 60_000;
		const range = {
			startTimeSec: Math.floor(marketStartMs / 1000),
			endTimeSec: Math.floor(marketEndMs / 1000),
		};

		if (tokenIds.upTokenId) tokenRanges.set(tokenIds.upTokenId, range);
		if (tokenIds.downTokenId) tokenRanges.set(tokenIds.downTokenId, range);
	}

	const tokenIds = [...tokenRanges.keys()];
	const histories = await mapWithConcurrency(
		tokenIds,
		async (tokenId, index) => {
			if (index > 0 && index % 100 === 0) {
				log.info(`Historical quote pricing progress for ${market.id}: ${index}/${tokenIds.length}`);
			}
			const range = tokenRanges.get(tokenId);
			if (!range) return { tokenId, history: [] };
			const history = await fetchClobPriceHistory({
				tokenId,
				startTimeSec: range.startTimeSec,
				endTimeSec: range.endTimeSec,
				fidelityMinutes: market.candleWindowMinutes >= 60 ? 5 : 1,
			});
			return { tokenId, history };
		},
		4,
	);

	return new Map(histories.map((entry) => [entry.tokenId, entry.history]));
}

export async function buildReplayMarketPricingContext(params: {
	market: MarketConfig;
	startTimeMs: number;
	endTimeMs: number;
	options: ReplayFillOptions;
	windowStartFilter?: Set<number>;
}): Promise<ReplayMarketPricingContext> {
	const { market, startTimeMs, endTimeMs, options, windowStartFilter } = params;
	const needsHistoricalData = options.fillMode === "historical" || options.quoteMode === "historical";
	if (!needsHistoricalData) {
		return {
			marketIndex: new Map<number, GammaMarket>(),
			tokenHistoryByTokenId: new Map<string, ClobPriceHistoryPoint[]>(),
		};
	}

	const historicalMarkets = await fetchHistoricalMarketsBySeriesSlug({
		seriesId: market.polymarket.seriesId,
		startTimeMs,
		endTimeMs,
	});
	const scopedMarkets =
		windowStartFilter && windowStartFilter.size > 0
			? historicalMarkets.filter((historicalMarket) => {
					const endMs = new Date(historicalMarket.endDate).getTime();
					if (!Number.isFinite(endMs)) return false;
					const windowStartMs =
						normalizeWindowEndMs(endMs, market.candleWindowMinutes) - market.candleWindowMinutes * 60_000;
					return windowStartFilter.has(windowStartMs);
				})
			: historicalMarkets;
	const marketIndex = buildHistoricalMarketIndex(scopedMarkets, market.candleWindowMinutes);
	const tokenHistoryByTokenId = await buildTokenHistoryMap({ market, historicalMarkets: scopedMarkets });

	return {
		marketIndex,
		tokenHistoryByTokenId,
	};
}

export function resolveHistoricalPolyPrices(params: {
	market: MarketConfig;
	windowStartMs: number;
	entryTimeMs: number;
	context: ReplayMarketPricingContext;
}): {
	up: number | null;
	down: number | null;
	marketSlug: string | null;
	tokens: { upTokenId: string; downTokenId: string } | null;
} {
	const { market, windowStartMs, entryTimeMs, context } = params;
	const windowEndMs = getWindowEndMs(windowStartMs, market.candleWindowMinutes);
	const historicalMarket = context.marketIndex.get(normalizeWindowEndMs(windowEndMs, market.candleWindowMinutes));
	if (!historicalMarket) {
		return {
			up: null,
			down: null,
			marketSlug: null,
			tokens: null,
		};
	}

	const tokenIds = parseOutcomeTokenIds(historicalMarket);
	const upHistory = tokenIds.upTokenId ? (context.tokenHistoryByTokenId.get(tokenIds.upTokenId) ?? []) : [];
	const downHistory = tokenIds.downTokenId ? (context.tokenHistoryByTokenId.get(tokenIds.downTokenId) ?? []) : [];
	const up = pickHistoricalEntryPrice(upHistory, entryTimeMs);
	const down = pickHistoricalEntryPrice(downHistory, entryTimeMs);

	return {
		up,
		down,
		marketSlug: historicalMarket.slug,
		tokens:
			tokenIds.upTokenId && tokenIds.downTokenId
				? { upTokenId: tokenIds.upTokenId, downTokenId: tokenIds.downTokenId }
				: null,
	};
}

async function enrichTradeWithHistoricalFill(params: {
	trade: ReplayTrade;
	market: MarketConfig;
	context: ReplayMarketPricingContext;
	options: ReplayFillOptions;
}): Promise<ReplayTrade> {
	const { trade, market, context, options } = params;
	const windowEndMs = getWindowEndMs(trade.windowStartMs, market.candleWindowMinutes);
	const historicalMarket = context.marketIndex.get(normalizeWindowEndMs(windowEndMs, market.candleWindowMinutes));
	if (!historicalMarket) {
		return applyFixedFillPricing([trade], options)[0] ?? trade;
	}

	const tokenIds = parseOutcomeTokenIds(historicalMarket);
	const tokenId = trade.side === "UP" ? tokenIds.upTokenId : tokenIds.downTokenId;
	if (!tokenId) {
		return applyFixedFillPricing([trade], options)[0] ?? trade;
	}

	const history = context.tokenHistoryByTokenId.get(tokenId) ?? [];
	const entryPrice = pickHistoricalEntryPrice(history, trade.entryTimeMs);
	if (entryPrice === null) {
		return applyFixedFillPricing([trade], options)[0] ?? trade;
	}

	const priced = computeBinaryPnlUsdc({
		entryPrice,
		won: trade.won,
		stakeUsdc: options.stakeUsdc,
		slippageBps: options.slippageBps,
	});
	if (!priced) {
		return applyFixedFillPricing([trade], options)[0] ?? trade;
	}

	return {
		...trade,
		entryPrice: priced.effectiveEntryPrice,
		entryPriceSource: "clob_history",
		pnlUsdc: priced.pnlUsdc,
	};
}

export function applyFixedFillPricing(trades: ReplayTrade[], options: ReplayFillOptions): ReplayTrade[] {
	return trades.map((trade) => {
		const priced = computeBinaryPnlUsdc({
			entryPrice: 0.5,
			won: trade.won,
			stakeUsdc: options.stakeUsdc,
			slippageBps: options.slippageBps,
		});
		return {
			...trade,
			entryPrice: priced?.effectiveEntryPrice ?? 0.5,
			entryPriceSource: "fixed_even",
			pnlUsdc: priced?.pnlUsdc ?? null,
		};
	});
}

export async function applyReplayFillPricing(params: {
	market: MarketConfig;
	trades: ReplayTrade[];
	context: ReplayMarketPricingContext;
	options: ReplayFillOptions;
}): Promise<ReplayTrade[]> {
	const { market, trades, context, options } = params;
	if (trades.length === 0) return trades;
	if (options.fillMode === "fixed") return applyFixedFillPricing(trades, options);

	const enriched: ReplayTrade[] = [];
	for (let i = 0; i < trades.length; i += 1) {
		if (i > 0 && i % 100 === 0) {
			log.info(`Historical fill pricing progress for ${market.id}: ${i}/${trades.length}`);
		}
		enriched.push(
			await enrichTradeWithHistoricalFill({
				trade: trades[i] as ReplayTrade,
				market,
				context,
				options,
			}),
		);
	}

	return enriched;
}
