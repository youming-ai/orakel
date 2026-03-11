/**
 * Bybit 数据源
 * 用于多交易所价格验证和套利检测
 */

interface BybitApiResponse<T> {
	retCode: number;
	retMsg: string;
	result: T;
}

interface BybitTickerResult {
	list: Array<{ lastPrice: string; symbol: string }>;
}

import { createTtlCache } from "../core/cache.ts";
import { createLogger } from "../core/logger.ts";
import type { Candle } from "../core/marketDataTypes.ts";

const log = createLogger("bybit");

// Bybit API 基础 URL
const BYBIT_BASE_URL = "https://api.bybit.com";

// 缓存配置
const PRICE_CACHE_TTL = 5_000; // 5秒缓存
const priceCache = new Map<string, { price: number; timestamp: number }>();

/**
 * 获取 Bybit 实时价格
 */
export async function fetchBybitPrice(symbol: string): Promise<number | null> {
	try {
		// 检查缓存
		const cached = priceCache.get(symbol);
		if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
			return cached.price;
		}

		// Bybit 使用不同的符号格式
		// Binance: BTCUSDT -> Bybit: BTCUSDT
		const bybitSymbol = symbol.toUpperCase();

		const url = new URL("/v5/market/tickers", BYBIT_BASE_URL);
		url.searchParams.set("category", "spot");
		url.searchParams.set("symbol", bybitSymbol);

		const res = await fetch(url.toString(), {
			signal: AbortSignal.timeout(5_000),
		});

		if (!res.ok) {
			log.warn(`Bybit price error: ${res.status}`);
			return null;
		}

		const data = (await res.json()) as BybitApiResponse<BybitTickerResult>;

		// 检查响应格式
		if (data.retCode !== 0 || !data.result?.list?.[0]) {
			log.warn(`Bybit price invalid response`);
			return null;
		}

		const price = parseFloat(data.result.list[0].lastPrice);

		if (!Number.isFinite(price) || price <= 0) {
			log.warn(`Bybit price invalid: ${price}`);
			return null;
		}

		// 更新缓存
		priceCache.set(symbol, { price, timestamp: Date.now() });

		return price;
	} catch (err) {
		log.error(`Bybit price fetch error:`, err instanceof Error ? err.message : String(err));
		return null;
	}
}

const INTERVAL_MAP: Record<string, string> = {
	"1m": "1",
	"3m": "3",
	"5m": "5",
	"15m": "15",
	"30m": "30",
	"1h": "60",
	"2h": "120",
	"4h": "240",
	"6h": "360",
	"12h": "720",
	"1d": "D",
	"1w": "W",
	"1M": "M",
};

function toNumber(x: unknown): number | null {
	const n = Number(x);
	return Number.isFinite(n) ? n : null;
}

interface BybitKlineResult {
	list: Array<[string, string, string, string, string, string, string]>;
}

// Cache klines for 60s — they only update once per minute
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

	const bybitInterval = INTERVAL_MAP[interval] || "1";
	const url = new URL("/v5/market/kline", BYBIT_BASE_URL);
	url.searchParams.set("category", "spot");
	url.searchParams.set("symbol", symbol.toUpperCase());
	url.searchParams.set("interval", bybitInterval);
	url.searchParams.set("limit", String(Math.min(limit, 1000)));

	const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) {
		throw new Error(`Bybit klines error: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as BybitApiResponse<BybitKlineResult>;

	if (data.retCode !== 0 || !data.result?.list) {
		throw new Error(`Bybit klines invalid response: ${data.retMsg}`);
	}

	// Bybit returns [startTime, open, high, low, close, volume, turnover]
	// Note: Bybit returns data in reverse chronological order (newest first)
	const result = data.result.list
		.slice()
		.reverse()
		.map((k) => ({
			openTime: Number(k[0]),
			open: toNumber(k[1]),
			high: toNumber(k[2]),
			low: toNumber(k[3]),
			close: toNumber(k[4]),
			volume: toNumber(k[5]),
			closeTime: Number(k[0]) + getIntervalMs(interval) - 1,
		}));

	cache.set(result);
	return result;
}

function getIntervalMs(interval: string): number {
	const unit = interval.slice(-1);
	const value = Number(interval.slice(0, -1)) || 1;
	switch (unit) {
		case "m":
			return value * 60_000;
		case "h":
			return value * 60 * 60_000;
		case "d":
			return value * 24 * 60 * 60_000;
		case "w":
			return value * 7 * 24 * 60 * 60_000;
		case "M":
			return value * 30 * 24 * 60 * 60_000;
		default:
			return 60_000;
	}
}

export async function fetchHistoricalKlines({
	symbol,
	interval,
	startTime,
	endTime,
	limit = 1000,
}: {
	symbol: string;
	interval: string;
	startTime: number;
	endTime: number;
	limit?: number;
}): Promise<Candle[]> {
	const allCandles: Candle[] = [];
	let cursor = startTime;
	const batchLimit = Math.min(Math.max(1, limit), 1000);
	const bybitInterval = INTERVAL_MAP[interval] || "1";

	while (cursor < endTime) {
		const url = new URL("/v5/market/kline", BYBIT_BASE_URL);
		url.searchParams.set("category", "spot");
		url.searchParams.set("symbol", symbol.toUpperCase());
		url.searchParams.set("interval", bybitInterval);
		url.searchParams.set("limit", String(batchLimit));
		url.searchParams.set("start", String(cursor));
		url.searchParams.set("end", String(endTime));

		const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
		if (!res.ok) {
			throw new Error(`Bybit historical klines error: ${res.status} ${await res.text()}`);
		}

		const data = (await res.json()) as BybitApiResponse<BybitKlineResult>;

		if (data.retCode !== 0 || !data.result?.list) {
			throw new Error(`Bybit historical klines invalid response: ${data.retMsg}`);
		}

		const rows = data.result.list;
		if (rows.length === 0) break;

		const batch = rows
			.slice()
			.reverse()
			.map((k) => ({
				openTime: Number(k[0]),
				open: toNumber(k[1]),
				high: toNumber(k[2]),
				low: toNumber(k[3]),
				close: toNumber(k[4]),
				volume: toNumber(k[5]),
				closeTime: Number(k[0]) + getIntervalMs(interval) - 1,
			}));

		allCandles.push(...batch);
		const lastOpenTime = batch[batch.length - 1]?.openTime;
		if (lastOpenTime === undefined) break;
		cursor = lastOpenTime + getIntervalMs(interval);
		if (rows.length < batchLimit) break;
	}

	return allCandles;
}

export async function fetchLastPrice({ symbol }: { symbol: string }): Promise<number | null> {
	return fetchBybitPrice(symbol);
}
