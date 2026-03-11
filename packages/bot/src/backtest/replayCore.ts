import type { MarketConfig } from "../core/configTypes.ts";
import type { Candle, RawMarketData } from "../core/marketDataTypes.ts";
import type { Side } from "../trading/tradeTypes.ts";

export interface ReplayTrade {
	marketId: string;
	windowStartMs: number;
	entryTimeMs: number;
	timeLeftMin: number;
	side: Side;
	phase: string;
	strength: string | null;
	priceToBeat: number;
	settlePrice: number;
	modelUp: number;
	modelDown: number;
	volImpliedUp: number | null;
	blendSource: string;
	won: boolean;
	entryPrice?: number | null;
	entryPriceSource?: string | null;
	pnlUsdc?: number | null;
}

export interface ReplaySummary {
	totalTrades: number;
	wins: number;
	losses: number;
	winRate: number;
	totalPnlUsdc: number;
	pricedTrades: number;
	byMarket: Record<
		string,
		{
			trades: number;
			wins: number;
			losses: number;
			winRate: number;
			pnlUsdc: number;
			pricedTrades: number;
		}
	>;
}

export function groupCandlesByWindow(candles: Candle[], windowMinutes: number): Map<number, Candle[]> {
	const windowMs = windowMinutes * 60_000;
	const windows = new Map<number, Candle[]>();

	for (const candle of candles) {
		const windowStartMs = Math.floor(candle.openTime / windowMs) * windowMs;
		const bucket = windows.get(windowStartMs);
		if (bucket) {
			bucket.push(candle);
			continue;
		}
		windows.set(windowStartMs, [candle]);
	}

	return windows;
}

export function getWindowPriceToBeat(windowCandles: Candle[]): number | null {
	const first = windowCandles[0];
	if (!first) return null;
	return first.open ?? first.close ?? null;
}

export function getWindowSettlePrice(windowCandles: Candle[]): number | null {
	const last = windowCandles[windowCandles.length - 1];
	if (!last) return null;
	return last.close ?? last.open ?? null;
}

export function resolveWinningSide(priceToBeat: number, settlePrice: number): Side {
	return settlePrice > priceToBeat ? "UP" : "DOWN";
}

export function buildReplayRawMarketData(params: {
	market: MarketConfig;
	historyCandles: Candle[];
	currentPrice: number;
	timeLeftMin: number;
	windowStartMs: number;
	polyPrices?: { up: number | null; down: number | null };
	marketSlug?: string | null;
	tokens?: { upTokenId: string; downTokenId: string } | null;
}): RawMarketData {
	const { market, historyCandles, currentPrice, timeLeftMin, windowStartMs, polyPrices, marketSlug, tokens } = params;
	return {
		ok: true,
		market,
		spotPrice: currentPrice,
		currentPrice,
		lastPrice: currentPrice,
		timeLeftMin,
		marketSlug: marketSlug ?? `replay-${market.id}-${windowStartMs}`,
		marketStartMs: windowStartMs,
		candles: historyCandles,
		poly: {
			ok: true,
			tokens: tokens ?? undefined,
			prices: {
				up: polyPrices?.up ?? 0.5,
				down: polyPrices?.down ?? 0.5,
			},
			orderbook: {
				up: {
					bestBid: null,
					bestAsk: null,
					spread: null,
					bidLiquidity: null,
					askLiquidity: null,
					bidNotional: null,
					askNotional: null,
				},
				down: {
					bestBid: null,
					bestAsk: null,
					spread: null,
					bidLiquidity: null,
					askLiquidity: null,
					bidNotional: null,
					askNotional: null,
				},
			},
		},
	};
}

export function summarizeReplayTrades(trades: ReplayTrade[]): ReplaySummary {
	const byMarket: ReplaySummary["byMarket"] = {};

	for (const trade of trades) {
		const bucket = byMarket[trade.marketId] ?? {
			trades: 0,
			wins: 0,
			losses: 0,
			winRate: 0,
			pnlUsdc: 0,
			pricedTrades: 0,
		};
		bucket.trades += 1;
		if (trade.won) bucket.wins += 1;
		else bucket.losses += 1;
		if (typeof trade.pnlUsdc === "number" && Number.isFinite(trade.pnlUsdc)) {
			bucket.pnlUsdc += trade.pnlUsdc;
			bucket.pricedTrades += 1;
		}
		bucket.winRate = bucket.trades > 0 ? bucket.wins / bucket.trades : 0;
		byMarket[trade.marketId] = bucket;
	}

	const wins = trades.filter((trade) => trade.won).length;
	const losses = trades.length - wins;
	const totalPnlUsdc = trades.reduce((sum, trade) => sum + (trade.pnlUsdc ?? 0), 0);
	const pricedTrades = trades.filter(
		(trade) => typeof trade.pnlUsdc === "number" && Number.isFinite(trade.pnlUsdc),
	).length;

	return {
		totalTrades: trades.length,
		wins,
		losses,
		winRate: trades.length > 0 ? wins / trades.length : 0,
		totalPnlUsdc,
		pricedTrades,
		byMarket,
	};
}
