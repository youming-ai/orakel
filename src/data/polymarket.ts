import { z } from "zod";
import { createTtlCache } from "../cache.ts";
import { CONFIG } from "../config.ts";
import { createLogger } from "../logger.ts";
import type { OrderBookSummary } from "../types.ts";

type JsonRecord = Record<string, unknown>;
type GammaValue = unknown;

const log = createLogger("polymarket");

const GammaMarketEventSchema = z
	.object({
		seriesSlug: z.string().optional(),
		series: z
			.array(
				z
					.object({
						slug: z.string().optional(),
					})
					.passthrough(),
			)
			.optional(),
	})
	.passthrough();

export const GammaMarketSchema = z
	.object({
		slug: z.string(),
		question: z.string().optional(),
		title: z.string().optional(),
		endDate: z.string(),
		eventStartTime: z.string().optional(),
		outcomes: z.union([z.string(), z.array(z.string())]),
		outcomePrices: z.union([z.string(), z.array(z.coerce.number())]),
		clobTokenIds: z.union([z.string(), z.array(z.string())]),
		bestBid: z.coerce.number().optional(),
		bestAsk: z.coerce.number().optional(),
		spread: z.coerce.number().optional(),
		events: z.array(GammaMarketEventSchema).optional(),
		seriesSlug: z.string().optional(),
	})
	.passthrough();

export type GammaMarket = z.infer<typeof GammaMarketSchema>;

export function parseGammaMarket(data: unknown): GammaMarket | null {
	const result = GammaMarketSchema.safeParse(data);
	if (!result.success) {
		log.warn("Invalid Gamma market data:", z.prettifyError(result.error));
		return null;
	}
	return result.data;
}

const DEFAULT_TIMEOUT_MS = 5000;

async function fetchWithTimeout(
	url: string | URL,
	options: RequestInit = {},
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		return response;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new Error(`Request timeout after ${timeoutMs}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}
}

function toNumber(x: unknown): number | null {
	const n = Number(x);
	return Number.isFinite(n) ? n : null;
}

function asRecord(x: unknown): JsonRecord | null {
	if (!x || typeof x !== "object" || Array.isArray(x)) return null;
	return x as JsonRecord;
}

// P1-1: Cache market metadata for 30s — slug/outcomes/tokens rarely change
const slugCache = new Map<string, ReturnType<typeof createTtlCache<GammaMarket>>>();

export async function fetchMarketBySlug(slug: string): Promise<GammaMarket | null> {
	let cache = slugCache.get(slug);
	if (!cache) {
		cache = createTtlCache<GammaMarket>(30_000);
		slugCache.set(slug, cache);
	}
	const cached = cache.get();
	if (cached !== undefined) return cached;

	const url = new URL("/markets", CONFIG.gammaBaseUrl);
	url.searchParams.set("slug", slug);

	const res = await fetchWithTimeout(url);
	if (!res.ok) {
		throw new Error(`Gamma markets error: ${res.status} ${await res.text()}`);
	}

	const data: unknown = await res.json();
	const market = Array.isArray(data) ? data[0] : data;
	if (!market) return null;
	const parsed = parseGammaMarket(market);
	if (!parsed) return null;

	cache.set(parsed);
	return parsed;
}

export async function fetchMarketsBySeriesSlug({
	seriesSlug,
	limit = 50,
}: {
	seriesSlug: string;
	limit?: number;
}): Promise<GammaValue[]> {
	const url = new URL("/markets", CONFIG.gammaBaseUrl);
	url.searchParams.set("seriesSlug", seriesSlug);
	url.searchParams.set("active", "true");
	url.searchParams.set("closed", "false");
	url.searchParams.set("enableOrderBook", "true");
	url.searchParams.set("limit", String(limit));

	const res = await fetchWithTimeout(url);
	if (!res.ok) {
		throw new Error(`Gamma markets(series) error: ${res.status} ${await res.text()}`);
	}

	const data: unknown = await res.json();
	return Array.isArray(data) ? data : [];
}

export async function fetchLiveEventsBySeriesId({
	seriesId,
	limit = 20,
}: {
	seriesId: string;
	limit?: number;
}): Promise<GammaValue[]> {
	const url = new URL("/events", CONFIG.gammaBaseUrl);
	url.searchParams.set("series_id", String(seriesId));
	url.searchParams.set("active", "true");
	url.searchParams.set("closed", "false");
	url.searchParams.set("limit", String(limit));

	const res = await fetchWithTimeout(url);
	if (!res.ok) {
		throw new Error(`Gamma events(series_id) error: ${res.status} ${await res.text()}`);
	}

	const data: unknown = await res.json();
	return Array.isArray(data) ? data : [];
}

export function flattenEventMarkets(events: GammaValue[]): GammaValue[] {
	const out: GammaValue[] = [];
	for (const e of Array.isArray(events) ? events : []) {
		const rec = asRecord(e);
		const markets = rec && Array.isArray(rec.markets) ? rec.markets : [];
		for (const m of markets) {
			out.push(m);
		}
	}
	return out;
}

export async function fetchActiveMarkets({
	limit = 200,
	offset = 0,
}: {
	limit?: number;
	offset?: number;
} = {}): Promise<GammaValue[]> {
	const url = new URL("/markets", CONFIG.gammaBaseUrl);
	url.searchParams.set("active", "true");
	url.searchParams.set("closed", "false");
	url.searchParams.set("enableOrderBook", "true");
	url.searchParams.set("limit", String(limit));
	url.searchParams.set("offset", String(offset));

	const res = await fetchWithTimeout(url);
	if (!res.ok) {
		throw new Error(`Gamma markets(active) error: ${res.status} ${await res.text()}`);
	}
	const data: unknown = await res.json();
	return Array.isArray(data) ? data : [];
}

function safeTimeMs(x: unknown): number | null {
	if (!x) return null;
	const t = new Date(String(x)).getTime();
	return Number.isFinite(t) ? t : null;
}

export function pickLatestLiveMarket(markets: GammaValue[], nowMs: number = Date.now()): GammaValue | null {
	if (!Array.isArray(markets) || markets.length === 0) return null;

	const enriched: Array<{ m: GammaValue; endMs: number; startMs: number | null }> = [];
	for (const mkt of markets) {
		const rec = asRecord(mkt);
		const endMs = safeTimeMs(rec?.endDate);
		if (endMs === null) continue;
		const startRaw = rec?.eventStartTime ?? rec?.startTime ?? rec?.startDate;
		const startMs = safeTimeMs(startRaw);
		enriched.push({ m: mkt, endMs, startMs });
	}

	const live = enriched
		.filter((x) => {
			const started = x.startMs === null ? true : x.startMs <= nowMs;
			return started && nowMs < x.endMs;
		})
		.sort((a, b) => a.endMs - b.endMs);

	const firstLive = live[0];
	if (firstLive) return firstLive.m;

	const upcoming = enriched.filter((x) => nowMs < x.endMs).sort((a, b) => a.endMs - b.endMs);

	const firstUpcoming = upcoming[0];
	return firstUpcoming ? firstUpcoming.m : null;
}

function marketHasSeriesSlug(market: unknown, seriesSlug: string): boolean {
	if (!market || !seriesSlug) return false;

	const marketRec = asRecord(market);
	const events = marketRec && Array.isArray(marketRec.events) ? marketRec.events : [];
	for (const e of events) {
		const eRec = asRecord(e);
		const series = eRec && Array.isArray(eRec.series) ? eRec.series : [];
		for (const s of series) {
			const sRec = asRecord(s);
			if (String(sRec?.slug ?? "").toLowerCase() === String(seriesSlug).toLowerCase()) return true;
		}
		if (String(eRec?.seriesSlug ?? "").toLowerCase() === String(seriesSlug).toLowerCase()) return true;
	}
	if (String(marketRec?.seriesSlug ?? "").toLowerCase() === String(seriesSlug).toLowerCase()) return true;
	return false;
}

export function filterBtcUpDown15mMarkets(
	markets: GammaValue[],
	{ seriesSlug, slugPrefix }: { seriesSlug?: string; slugPrefix?: string } = {},
): GammaValue[] {
	const prefix = (slugPrefix ?? "").toLowerCase();
	const wantedSeries = (seriesSlug ?? "").toLowerCase();

	return (Array.isArray(markets) ? markets : []).filter((m) => {
		const mRec = asRecord(m);
		const slug = String(mRec?.slug ?? "").toLowerCase();
		const matchesPrefix = prefix ? slug.startsWith(prefix) : false;
		const matchesSeries = wantedSeries ? marketHasSeriesSlug(m, wantedSeries) : false;
		return matchesPrefix || matchesSeries;
	});
}

// P1-1: Cache CLOB price for 3s
const clobPriceCache = new Map<string, ReturnType<typeof createTtlCache<number | null>>>();

export async function fetchClobPrice({ tokenId, side }: { tokenId: string; side: string }): Promise<number | null> {
	const cacheKey = `${tokenId}:${side}`;
	let cache = clobPriceCache.get(cacheKey);
	if (!cache) {
		cache = createTtlCache<number | null>(3_000);
		clobPriceCache.set(cacheKey, cache);
	}
	const cached = cache.get();
	if (cached !== undefined) return cached;

	const url = new URL("/price", CONFIG.clobBaseUrl);
	url.searchParams.set("token_id", tokenId);
	url.searchParams.set("side", side);

	const res = await fetchWithTimeout(url);
	if (!res.ok) {
		throw new Error(`CLOB price error: ${res.status} ${await res.text()}`);
	}
	const data: unknown = await res.json();
	const rec = asRecord(data);
	const result = toNumber(rec?.price);
	cache.set(result);
	return result;
}

// P1-1: Cache orderbook for 3s
const orderbookCache = new Map<string, ReturnType<typeof createTtlCache<GammaValue>>>();

export async function fetchOrderBook({ tokenId }: { tokenId: string }): Promise<GammaValue> {
	let cache = orderbookCache.get(tokenId);
	if (!cache) {
		cache = createTtlCache<GammaValue>(3_000);
		orderbookCache.set(tokenId, cache);
	}
	const cached = cache.get();
	if (cached !== undefined) return cached;

	const url = new URL("/book", CONFIG.clobBaseUrl);
	url.searchParams.set("token_id", tokenId);

	const res = await fetchWithTimeout(url);
	if (!res.ok) {
		throw new Error(`CLOB book error: ${res.status} ${await res.text()}`);
	}
	const result = await res.json();
	cache.set(result);
	return result;
}

export function summarizeOrderBook(book: GammaValue, depthLevels: number = 5): OrderBookSummary {
	const bookRec = asRecord(book);
	const bids = bookRec && Array.isArray(bookRec.bids) ? bookRec.bids : [];
	const asks = bookRec && Array.isArray(bookRec.asks) ? bookRec.asks : [];

	const bestBid = bids.length
		? bids.reduce<number | null>((best, lvl) => {
				const lvlRec = asRecord(lvl);
				const p = toNumber(lvlRec?.price);
				if (p === null) return best;
				if (best === null) return p;
				return Math.max(best, p);
			}, null)
		: null;

	const bestAsk = asks.length
		? asks.reduce<number | null>((best, lvl) => {
				const lvlRec = asRecord(lvl);
				const p = toNumber(lvlRec?.price);
				if (p === null) return best;
				if (best === null) return p;
				return Math.min(best, p);
			}, null)
		: null;
	const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

	const bidLiquidity = bids.slice(0, depthLevels).reduce((acc, x) => {
		const rec = asRecord(x);
		return acc + (toNumber(rec?.size) ?? 0);
	}, 0);
	const askLiquidity = asks.slice(0, depthLevels).reduce((acc, x) => {
		const rec = asRecord(x);
		return acc + (toNumber(rec?.size) ?? 0);
	}, 0);

	return {
		bestBid,
		bestAsk,
		spread,
		bidLiquidity,
		askLiquidity,
	};
}
