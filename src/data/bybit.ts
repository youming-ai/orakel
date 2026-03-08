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

interface BybitKlineResult {
	list: string[][];
}

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

/**
 * 获取 Bybit K线数据
 */
export async function fetchBybitKlines(params: {
	symbol: string;
	interval: string;
	limit?: number;
	startTime?: number;
	endTime?: number;
}): Promise<Candle[]> {
	try {
		const { symbol, interval, limit = 200, startTime, endTime } = params;

		// 转换时间间隔格式
		// Binance: 1m -> Bybit: 1
		const bybitInterval = interval.replace("m", "");

		const url = new URL("/v5/market/kline", BYBIT_BASE_URL);
		url.searchParams.set("category", "spot");
		url.searchParams.set("symbol", symbol.toUpperCase());
		url.searchParams.set("interval", bybitInterval);
		url.searchParams.set("limit", String(Math.min(limit, 1000)));

		if (startTime) {
			url.searchParams.set("start", String(startTime));
		}
		if (endTime) {
			url.searchParams.set("end", String(endTime));
		}

		const res = await fetch(url.toString(), {
			signal: AbortSignal.timeout(8_000),
		});

		if (!res.ok) {
			log.warn(`Bybit klines error: ${res.status}`);
			return [];
		}

		const data = (await res.json()) as BybitApiResponse<BybitKlineResult>;

		if (data.retCode !== 0 || !data.result?.list) {
			log.warn(`Bybit klines invalid response`);
			return [];
		}

		// Bybit 返回格式: [startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover]
		// 注意：Bybit 返回的是倒序的（最新的在前）
		const klines = data.result.list;

		// 转换为标准格式并反转顺序
		const candles: Candle[] = klines
			.reverse()
			.map((k) => {
				const openTime = parseInt(k[0] ?? "", 10);
				const open = parseFloat(k[1] ?? "");
				const high = parseFloat(k[2] ?? "");
				const low = parseFloat(k[3] ?? "");
				const close = parseFloat(k[4] ?? "");
				const volume = parseFloat(k[5] ?? "");

				if (
					!Number.isFinite(openTime) ||
					!Number.isFinite(open) ||
					!Number.isFinite(high) ||
					!Number.isFinite(low) ||
					!Number.isFinite(close)
				) {
					return null;
				}

				const candle: Candle = {
					openTime,
					open,
					high,
					low,
					close,
					volume: Number.isFinite(volume) ? volume : 0,
					closeTime: openTime + 60_000 - 1, // 假设1分钟K线
				};

				return candle;
			})
			.filter((c): c is Candle => c !== null);

		return candles;
	} catch (err) {
		log.error(`Bybit klines fetch error:`, err instanceof Error ? err.message : String(err));
		return [];
	}
}

/**
 * 批量获取多个交易对价格
 */
export async function fetchBybitPrices(symbols: string[]): Promise<Map<string, number>> {
	const prices = new Map<string, number>();

	// 并行获取
	const results = await Promise.all(
		symbols.map(async (symbol) => {
			const price = await fetchBybitPrice(symbol);
			return { symbol, price };
		}),
	);

	for (const { symbol, price } of results) {
		if (price !== null) {
			prices.set(symbol, price);
		}
	}

	return prices;
}

/**
 * 清除缓存
 */
export function clearBybitCache(): void {
	priceCache.clear();
	log.info("Bybit cache cleared");
}
