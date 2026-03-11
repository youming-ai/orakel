/**
 * Binance 数据源
 * 用于多交易所价格验证和套利检测
 */

interface BinanceTickerResponse {
	symbol: string;
	price: string;
}

interface BinanceKlineResponse extends Array<unknown> {
	0: number; // openTime
	1: string; // open
	2: string; // high
	3: string; // low
	4: string; // close
	5: string; // volume
	6: number; // closeTime
	7: string; // quoteAssetVolume
	8: number; // numberOfTrades
	9: string; // takerBuyBaseAssetVolume
	10: string; // takerBuyQuoteAssetVolume
	11: string; // ignore
}

import { createTtlCache } from "../core/cache.ts";
import { createLogger } from "../core/logger.ts";
import type { Candle } from "../core/marketDataTypes.ts";

const log = createLogger("binance");

// Binance API 基础 URL
const BINANCE_BASE_URL = "https://api.binance.com";

// 缓存配置
const PRICE_CACHE_TTL = 5_000; // 5秒缓存
const priceCache = new Map<string, { price: number; timestamp: number }>();

/**
 * 获取 Binance 实时价格
 */
export async function fetchBinancePrice(symbol: string): Promise<number | null> {
	try {
		// 检查缓存
		const cached = priceCache.get(symbol);
		if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
			return cached.price;
		}

		// Binance 使用大写符号格式
		const binanceSymbol = symbol.toUpperCase();

		const url = new URL("/api/v3/ticker/price", BINANCE_BASE_URL);
		url.searchParams.set("symbol", binanceSymbol);

		const res = await fetch(url.toString(), {
			signal: AbortSignal.timeout(5_000),
		});

		if (!res.ok) {
			log.warn(`Binance price error: ${res.status}`);
			return null;
		}

		const data = (await res.json()) as BinanceTickerResponse;

		const price = parseFloat(data.price);

		if (!Number.isFinite(price) || price <= 0) {
			log.warn(`Binance price invalid: ${price}`);
			return null;
		}

		// 更新缓存
		priceCache.set(symbol, { price, timestamp: Date.now() });

		return price;
	} catch (err) {
		log.error(`Binance price fetch error:`, err instanceof Error ? err.message : String(err));
		return null;
	}
}

const INTERVAL_MAP: Record<string, string> = {
	"1m": "1m",
	"3m": "3m",
	"5m": "5m",
	"15m": "15m",
	"30m": "30m",
	"1h": "1h",
	"2h": "2h",
	"4h": "4h",
	"6h": "6h",
	"8h": "8h",
	"12h": "12h",
	"1d": "1d",
	"3d": "3d",
	"1w": "1w",
	"1M": "1M",
};

function toNumber(x: unknown): number | null {
	const n = Number(x);
	return Number.isFinite(n) ? n : null;
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

	const binanceInterval = INTERVAL_MAP[interval] || "1m";
	const url = new URL("/api/v3/klines", BINANCE_BASE_URL);
	url.searchParams.set("symbol", symbol.toUpperCase());
	url.searchParams.set("interval", binanceInterval);
	url.searchParams.set("limit", String(Math.min(limit, 1000)));

	const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) {
		throw new Error(`Binance klines error: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as BinanceKlineResponse[];

	if (!Array.isArray(data) || data.length === 0) {
		throw new Error(`Binance klines invalid response`);
	}

	// Binance returns data in chronological order (oldest first)
	// No need to reverse like Bybit
	const result = data.map((k) => ({
		openTime: k[0],
		open: toNumber(k[1]),
		high: toNumber(k[2]),
		low: toNumber(k[3]),
		close: toNumber(k[4]),
		volume: toNumber(k[5]),
		closeTime: k[6],
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
	const binanceInterval = INTERVAL_MAP[interval] || "1m";

	while (cursor < endTime) {
		const url = new URL("/api/v3/klines", BINANCE_BASE_URL);
		url.searchParams.set("symbol", symbol.toUpperCase());
		url.searchParams.set("interval", binanceInterval);
		url.searchParams.set("startTime", String(cursor));
		url.searchParams.set("endTime", String(endTime));
		url.searchParams.set("limit", String(batchLimit));

		const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
		if (!res.ok) {
			throw new Error(`Binance historical klines error: ${res.status} ${await res.text()}`);
		}

		const data = (await res.json()) as BinanceKlineResponse[];

		if (!Array.isArray(data) || data.length === 0) break;

		const batch = data.map((k) => ({
			openTime: k[0],
			open: toNumber(k[1]),
			high: toNumber(k[2]),
			low: toNumber(k[3]),
			close: toNumber(k[4]),
			volume: toNumber(k[5]),
			closeTime: k[6],
		}));

		allCandles.push(...batch);
		const lastOpenTime = batch[batch.length - 1]?.openTime;
		if (lastOpenTime === undefined) break;
		cursor = lastOpenTime + getIntervalMs(interval);
		if (data.length < batchLimit) break;
	}

	return allCandles;
}

export async function fetchLastPrice({ symbol }: { symbol: string }): Promise<number | null> {
	return fetchBinancePrice(symbol);
}
