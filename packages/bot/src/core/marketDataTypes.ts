import type { GammaMarket } from "../data/polymarket.ts";
import type { AggregatedPrice } from "../data/priceAggregator.ts";
import type { MarketConfig } from "./configTypes.ts";

export type { GammaMarket } from "../data/polymarket.ts";

export interface Candle {
	openTime: number;
	open: number | null;
	high: number | null;
	low: number | null;
	close: number | null;
	volume: number | null;
	closeTime: number;
}

export interface HaCandle {
	open: number;
	high: number;
	low: number;
	close: number;
	isGreen: boolean;
	body: number;
}

export interface CandleWindowTiming {
	startMs: number;
	endMs: number;
	elapsedMs: number;
	remainingMs: number;
	elapsedMinutes: number;
	remainingMinutes: number;
}

export interface PriceTick {
	price: number | null;
	ts?: number | null;
	updatedAt?: number | null;
	source?: string;
}

export interface OrderBookSummary {
	bestBid: number | null;
	bestAsk: number | null;
	spread: number | null;
	bidLiquidity: number | null;
	askLiquidity: number | null;
	bidNotional: number | null;
	askNotional: number | null;
}

export interface PolymarketSnapshot {
	ok: boolean;
	degraded?: boolean;
	reason?: string;
	market?: GammaMarket;
	tokens?: { upTokenId: string; downTokenId: string };
	prices?: { up: number | null; down: number | null };
	orderbook?: { up: OrderBookSummary; down: OrderBookSummary };
	outcomes?: string[];
	clobTokenIds?: string[];
	outcomePrices?: string[];
}

export interface RawMarketData {
	ok: true;
	market: MarketConfig;
	spotPrice: number;
	currentPrice: number | null;
	lastPrice: number;
	timeLeftMin: number | null;
	marketSlug: string;
	marketStartMs: number | null;
	candles: Candle[];
	poly: PolymarketSnapshot;
	aggregatedPrice?: AggregatedPrice | null;
}

export interface RawMarketDataError {
	ok: false;
	market: MarketConfig;
	error: string;
}

export type FetchMarketDataResult = RawMarketData | RawMarketDataError;
