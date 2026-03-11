/**
 * Coinbase Exchange API 数据源
 * 用于多交易所价格验证和套利检测
 */

interface CoinbaseTickerResponse {
	trade_id: number;
	price: string;
	size: string;
	time: string;
}

interface CoinbaseCandleResponse extends Array<number> {
	0: number; // time (unix timestamp)
	1: number; // low
	2: number; // high
	3: number; // open
	4: number; // close
	5: number; // volume
}

import { createTtlCache } from "../core/cache.ts";
import { createLogger } from "../core/logger.ts";
import type { Candle } from "../core/marketDataTypes.ts";

const log = createLogger("coinbase");

// Coinbase API 基础 URL
const COINBASE_BASE_URL = "https://api.exchange.coinbase.com";

// 缓存配置
const PRICE_CACHE_TTL = 5_000; // 5秒缓存
const priceCache = new Map<string, { price: number; timestamp: number }>();

/**
 * 将 Binance 格式符号转换为 Coinbase 格式
 * BTCUSDT -> BTC-USD
 * ETHUSDT -> ETH-USD
 */
function binanceToCoinbaseSymbol(binanceSymbol: string): string {
	const symbol = binanceSymbol.toUpperCase();

	// 移除 USDT 后缀并添加 -USD
	if (symbol.endsWith("USDT")) {
		return `${symbol.slice(0, -4)}-USD`;
	}

	// 如果已经是 Coinbase 格式，直接返回
	if (symbol.includes("-")) {
		return symbol;
	}

	// 默认假设是 USDT 对
	return `${symbol}-USD`;
}

/**
 * 获取 Coinbase 实时价格
 */
export async function fetchCoinbasePrice(symbol: string): Promise<number | null> {
	try {
		// 检查缓存
		const cached = priceCache.get(symbol);
		if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
			return cached.price;
		}

		const coinbaseSymbol = binanceToCoinbaseSymbol(symbol);
		const url = new URL(`/products/${coinbaseSymbol}/ticker`, COINBASE_BASE_URL);

		const res = await fetch(url.toString(), {
			signal: AbortSignal.timeout(5_000),
		});

		if (!res.ok) {
			log.warn(`Coinbase price error: ${res.status}`);
			return null;
		}

		const data = (await res.json()) as CoinbaseTickerResponse;

		// 检查响应格式
		if (!data.price) {
			log.warn(`Coinbase price invalid response`);
			return null;
		}

		const price = parseFloat(data.price);

		if (!Number.isFinite(price) || price <= 0) {
			log.warn(`Coinbase price invalid: ${price}`);
			return null;
		}

		// 更新缓存
		priceCache.set(symbol, { price, timestamp: Date.now() });

		return price;
	} catch (err) {
		log.error(`Coinbase price fetch error:`, err instanceof Error ? err.message : String(err));
		return null;
	}
}

/**
 * 将 Binance 时间间隔转换为 Coinbase 粒度（秒）
 * 1m -> 60, 5m -> 300, 15m -> 900, 1h -> 3600, 1d -> 86400
 */
const INTERVAL_TO_GRANULARITY: Record<string, number> = {
	"1m": 60,
	"3m": 180,
	"5m": 300,
	"15m": 900,
	"30m": 1_800,
	"1h": 3_600,
	"2h": 7_200,
	"4h": 14_400,
	"6h": 21_600,
	"12h": 43_200,
	"1d": 86_400,
	"1w": 604_800,
	"1M": 2_592_000,
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

	const granularity = INTERVAL_TO_GRANULARITY[interval] || 60;
	const coinbaseSymbol = binanceToCoinbaseSymbol(symbol);
	const url = new URL(`/products/${coinbaseSymbol}/candles`, COINBASE_BASE_URL);
	url.searchParams.set("granularity", String(granularity));
	url.searchParams.set("limit", String(Math.min(limit, 300))); // Coinbase max is 300

	const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) {
		throw new Error(`Coinbase klines error: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as CoinbaseCandleResponse[];

	if (!Array.isArray(data) || data.length === 0) {
		throw new Error(`Coinbase klines invalid response`);
	}

	// Coinbase returns [time, low, high, open, close, volume]
	// Note: Coinbase returns data in reverse chronological order (newest first)
	const result = data
		.slice()
		.reverse()
		.map((k) => ({
			openTime: Number(k[0]) * 1_000, // Convert to milliseconds
			open: toNumber(k[3]),
			high: toNumber(k[2]),
			low: toNumber(k[1]),
			close: toNumber(k[4]),
			volume: toNumber(k[5]),
			closeTime: Number(k[0]) * 1_000 + getIntervalMs(interval) - 1,
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
	const batchLimit = Math.min(Math.max(1, limit), 300); // Coinbase max is 300
	const granularity = INTERVAL_TO_GRANULARITY[interval] || 60;
	const coinbaseSymbol = binanceToCoinbaseSymbol(symbol);

	while (cursor < endTime) {
		const url = new URL(`/products/${coinbaseSymbol}/candles`, COINBASE_BASE_URL);
		url.searchParams.set("granularity", String(granularity));
		url.searchParams.set("start", String(Math.floor(cursor / 1_000))); // Convert to seconds
		url.searchParams.set("end", String(Math.floor(endTime / 1_000))); // Convert to seconds

		const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
		if (!res.ok) {
			throw new Error(`Coinbase historical klines error: ${res.status} ${await res.text()}`);
		}

		const data = (await res.json()) as CoinbaseCandleResponse[];

		if (!Array.isArray(data) || data.length === 0) {
			break;
		}

		const batch = data
			.slice()
			.reverse()
			.map((k) => ({
				openTime: Number(k[0]) * 1_000, // Convert to milliseconds
				open: toNumber(k[3]),
				high: toNumber(k[2]),
				low: toNumber(k[1]),
				close: toNumber(k[4]),
				volume: toNumber(k[5]),
				closeTime: Number(k[0]) * 1_000 + getIntervalMs(interval) - 1,
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
	return fetchCoinbasePrice(symbol);
}
