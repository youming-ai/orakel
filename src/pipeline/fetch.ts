import { CONFIG } from "../config.ts";
import { fetchKlines, fetchLastPrice } from "../data/binance.ts";
import { fetchChainlinkPrice } from "../data/chainlink.ts";
import {
	fetchClobPrice,
	fetchLiveEventsBySeriesId,
	fetchMarketBySlug,
	fetchOrderBook,
	flattenEventMarkets,
	parseGammaMarket,
	pickLatestLiveMarket,
	summarizeOrderBook,
} from "../data/polymarket.ts";
import { createLogger } from "../logger.ts";
import type {
	Candle,
	CandleWindowTiming,
	FetchMarketDataResult,
	GammaMarket,
	MarketConfig,
	OrderBookSummary,
	PolymarketSnapshot,
	PriceTick,
	StreamHandles,
} from "../types.ts";

const log = createLogger("pipeline-fetch");

const clobCircuitBreaker = {
	failures: 0,
	openUntil: 0,
	maxFailures: 5,
	cooldownMs: 60_000,
	isOpen(): boolean {
		if (this.failures < this.maxFailures) return false;
		return Date.now() < this.openUntil;
	},
	recordFailure(): void {
		this.failures++;
		if (this.failures >= this.maxFailures) {
			this.openUntil = Date.now() + this.cooldownMs;
			log.warn(`CLOB circuit breaker OPEN - ${this.failures} consecutive failures, cooldown ${this.cooldownMs}ms`);
		}
	},
	recordSuccess(): void {
		if (this.failures > 0) log.info(`CLOB circuit breaker reset after ${this.failures} failures`);
		this.failures = 0;
		this.openUntil = 0;
	},
};

const MAX_PRICE_AGE_MS = 60_000;

function parsePriceToBeat(market: GammaMarket): number | null {
	const text = String(market.question ?? market.title ?? "");
	if (!text) return null;
	const m = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
	if (!m || !m[1]) return null;
	const raw = m[1].replace(/,/g, "");
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

export function priceToBeatFromPolymarketMarket(market: GammaMarket): number | null {
	return parsePriceToBeat(market);
}

function parseJsonArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value !== "string") return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

const polymarketMarketCache: Map<string, { market: GammaMarket; fetchedAtMs: number }> = new Map();

async function resolveCurrent15mMarket(marketDef: MarketConfig): Promise<GammaMarket | null> {
	const customSlug = marketDef.id === "BTC" ? CONFIG.polymarket.marketSlug : "";
	if (customSlug) {
		const bySlug = await fetchMarketBySlug(customSlug);
		return bySlug;
	}

	if (!CONFIG.polymarket.autoSelectLatest) return null;

	const now = Date.now();
	const cached = polymarketMarketCache.get(marketDef.id);
	if (cached?.market && now - cached.fetchedAtMs < CONFIG.pollIntervalMs) {
		return cached.market;
	}

	const events = await fetchLiveEventsBySeriesId({
		seriesId: marketDef.polymarket.seriesId,
		limit: 25,
	});
	const markets = flattenEventMarkets(events);
	const picked = pickLatestLiveMarket(markets);
	if (!picked) return null;
	const parsed = parseGammaMarket(picked);
	if (!parsed) return null;
	polymarketMarketCache.set(marketDef.id, { market: parsed, fetchedAtMs: now });
	return parsed;
}

async function fetchPolymarketSnapshot(marketDef: MarketConfig): Promise<PolymarketSnapshot> {
	const market = await resolveCurrent15mMarket(marketDef);
	if (!market) return { ok: false, reason: "market_not_found" };

	const outcomes = parseJsonArray(market.outcomes);
	const outcomePrices = parseJsonArray(market.outcomePrices);
	const clobTokenIds = parseJsonArray(market.clobTokenIds);

	let upTokenId: string | null = null;
	let downTokenId: string | null = null;
	for (let i = 0; i < outcomes.length; i += 1) {
		const label = String(outcomes[i] ?? "").toLowerCase();
		const tokenRaw = clobTokenIds[i];
		const tokenId = tokenRaw ? String(tokenRaw) : null;
		if (!tokenId) continue;
		if (label === CONFIG.polymarket.upOutcomeLabel.toLowerCase()) upTokenId = tokenId;
		if (label === CONFIG.polymarket.downOutcomeLabel.toLowerCase()) downTokenId = tokenId;
	}

	const upIndex = outcomes.findIndex(
		(x) => String(x ?? "").toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase(),
	);
	const downIndex = outcomes.findIndex(
		(x) => String(x ?? "").toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase(),
	);
	const gammaYes = upIndex >= 0 ? Number(outcomePrices[upIndex]) : null;
	const gammaNo = downIndex >= 0 ? Number(outcomePrices[downIndex]) : null;

	if (!upTokenId || !downTokenId) {
		return {
			ok: false,
			reason: "missing_token_ids",
			market,
			outcomes: outcomes.map((x) => String(x)),
			clobTokenIds: clobTokenIds.map((x) => String(x)),
			outcomePrices: outcomePrices.map((x) => String(x)),
		};
	}

	let upBuy: number | null = null;
	let downBuy: number | null = null;
	let upBookSummary: OrderBookSummary = {
		bestBid: null,
		bestAsk: null,
		spread: null,
		bidLiquidity: null,
		askLiquidity: null,
	};
	let downBookSummary: OrderBookSummary = {
		bestBid: null,
		bestAsk: null,
		spread: null,
		bidLiquidity: null,
		askLiquidity: null,
	};

	if (clobCircuitBreaker.isOpen()) {
		log.warn(
			`CLOB fetch skipped for ${marketDef.id} - circuit breaker open until ${new Date(clobCircuitBreaker.openUntil).toISOString()}`,
		);
		upBookSummary = {
			bestBid: Number(market.bestBid) || null,
			bestAsk: Number(market.bestAsk) || null,
			spread: Number(market.spread) || null,
			bidLiquidity: null,
			askLiquidity: null,
		};
		downBookSummary = {
			bestBid: null,
			bestAsk: null,
			spread: Number(market.spread) || null,
			bidLiquidity: null,
			askLiquidity: null,
		};
	} else {
		try {
			const [yesBuy, noBuy, upBook, downBook] = await Promise.all([
				fetchClobPrice({ tokenId: upTokenId, side: "buy" }),
				fetchClobPrice({ tokenId: downTokenId, side: "buy" }),
				fetchOrderBook({ tokenId: upTokenId }),
				fetchOrderBook({ tokenId: downTokenId }),
			]);
			upBuy = yesBuy;
			downBuy = noBuy;
			upBookSummary = summarizeOrderBook(upBook);
			downBookSummary = summarizeOrderBook(downBook);
			clobCircuitBreaker.recordSuccess();
		} catch (err) {
			clobCircuitBreaker.recordFailure();
			log.warn(`CLOB fetch failed for ${marketDef.id}:`, err);
			upBookSummary = {
				bestBid: Number(market.bestBid) || null,
				bestAsk: Number(market.bestAsk) || null,
				spread: Number(market.spread) || null,
				bidLiquidity: null,
				askLiquidity: null,
			};
			downBookSummary = {
				bestBid: null,
				bestAsk: null,
				spread: Number(market.spread) || null,
				bidLiquidity: null,
				askLiquidity: null,
			};
		}
	}

	return {
		ok: true,
		market,
		tokens: { upTokenId, downTokenId },
		prices: { up: upBuy ?? gammaYes, down: downBuy ?? gammaNo },
		orderbook: { up: upBookSummary, down: downBookSummary },
	};
}

export async function fetchMarketData(
	market: MarketConfig,
	timing: CandleWindowTiming,
	streams: StreamHandles,
): Promise<FetchMarketDataResult> {
	try {
		const wsTick = streams.binance.getLast(market.binanceSymbol);
		const wsPrice = wsTick?.price ?? null;

		const polyWsTick = streams.polymarket.getLast(market.chainlink.wsSymbol);
		const polyWsPrice = polyWsTick?.price ?? null;

		const chainlinkWsTick: PriceTick = streams.chainlink.get(market.id)?.getLast?.() ?? {
			price: null,
			updatedAt: null,
			source: "chainlink_ws",
		};
		const chainlinkWsPrice = chainlinkWsTick?.price ?? null;

		const chainlinkPromise: Promise<PriceTick> =
			polyWsPrice !== null
				? Promise.resolve({
						price: polyWsPrice,
						updatedAt: polyWsTick?.updatedAt ?? null,
						source: "polymarket_ws",
					})
				: chainlinkWsPrice !== null
					? Promise.resolve({
							price: chainlinkWsPrice,
							updatedAt: chainlinkWsTick?.updatedAt ?? null,
							source: "chainlink_ws",
						})
					: fetchChainlinkPrice({
							aggregator: market.chainlink.aggregator,
							decimals: market.chainlink.decimals,
						});

		const [klines1mRaw, lastPriceRaw, chainlink, poly] = await Promise.all([
			fetchKlines({ symbol: market.binanceSymbol, interval: "1m", limit: 240 }),
			fetchLastPrice({ symbol: market.binanceSymbol }),
			chainlinkPromise,
			fetchPolymarketSnapshot(market),
		]);

		const settlementMs = poly.ok && poly.market?.endDate ? new Date(String(poly.market.endDate)).getTime() : null;
		const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;
		const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;
		const lastPrice = Number(lastPriceRaw);
		const spotPrice = wsPrice ?? lastPrice;
		const currentPrice = chainlink?.price ?? null;
		const priceUpdatedAt = chainlink?.updatedAt ?? null;
		if (priceUpdatedAt !== null && Date.now() - priceUpdatedAt > MAX_PRICE_AGE_MS) {
			log.warn(`Stale price for ${market.id}: ${(Date.now() - priceUpdatedAt) / 1000}s old — skipping`);
			return { ok: false, market, error: `stale_price_${(Date.now() - priceUpdatedAt) / 1000}s` };
		}
		const marketSlug = poly.ok ? String(poly.market?.slug ?? "") : "";
		const marketStartMs =
			poly.ok && poly.market?.eventStartTime ? new Date(String(poly.market.eventStartTime)).getTime() : null;

		const candles = klines1mRaw as Candle[];
		return {
			ok: true,
			market,
			spotPrice,
			currentPrice,
			lastPrice,
			timeLeftMin,
			marketSlug,
			marketStartMs,
			candles,
			poly,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, market, error: message };
	}
}
