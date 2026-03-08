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

import { createLogger } from "../core/logger.ts";

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
