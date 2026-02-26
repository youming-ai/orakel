import { createTtlCache } from "../cache.ts";
import { CONFIG } from "../config.ts";
import type { Candle } from "../types.ts";

function toNumber(x: unknown): number | null {
	const n = Number(x);
	return Number.isFinite(n) ? n : null;
}

// P1-1: Cache klines for 60s — they only update once per minute
const klinesCache = new Map<string, ReturnType<typeof createTtlCache<Candle[]>>>();

export async function fetchKlines({
	symbol,
	interval,
	limit,
}: {
	symbol: string;
	interval: string;
	limit: number;
}): Promise<Candle[]> {
	const key = `${symbol}:${interval}:${limit}`;
	let cache = klinesCache.get(key);
	if (!cache) {
		cache = createTtlCache<Candle[]>(60_000);
		klinesCache.set(key, cache);
	}
	const cached = cache.get();
	if (cached) return cached;

	const url = new URL("/api/v3/klines", CONFIG.binanceBaseUrl);
	url.searchParams.set("symbol", String(symbol || ""));
	url.searchParams.set("interval", interval);
	url.searchParams.set("limit", String(limit));

	const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) {
		throw new Error(`Binance klines error: ${res.status} ${await res.text()}`);
	}
	const data: unknown = await res.json();
	const rows = Array.isArray(data) ? data : [];

	const result = rows.map((k) => {
		const row = Array.isArray(k) ? k : [];
		return {
			openTime: Number(row[0]),
			open: toNumber(row[1]),
			high: toNumber(row[2]),
			low: toNumber(row[3]),
			close: toNumber(row[4]),
			volume: toNumber(row[5]),
			closeTime: Number(row[6]),
		};
	});

	cache.set(result);
	return result;
}

export async function fetchLastPrice({ symbol }: { symbol: string }): Promise<number | null> {
	const url = new URL("/api/v3/ticker/price", CONFIG.binanceBaseUrl);
	url.searchParams.set("symbol", String(symbol || ""));
	const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) {
		throw new Error(`Binance last price error: ${res.status} ${await res.text()}`);
	}
	const data: unknown = await res.json();
	const price = data && typeof data === "object" && "price" in data ? data.price : null;
	return toNumber(price);
}
