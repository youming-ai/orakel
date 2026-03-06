import type { MarketConfig } from "../types.ts";
import { env } from "./env.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("markets");

export const MARKETS: MarketConfig[] = [
	{
		id: "BTC-5m",
		coin: "BTC",
		label: "Bitcoin 5m",
		candleWindowMinutes: 5,
		resolutionSource: "chainlink",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "10684",
			seriesSlug: "btc-up-or-down-5m",
			slugPrefix: "btc-updown-5m-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
	{
		id: "BTC-15m",
		coin: "BTC",
		label: "Bitcoin 15m",
		candleWindowMinutes: 15,
		resolutionSource: "chainlink",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "10192",
			seriesSlug: "btc-up-or-down-15m",
			slugPrefix: "btc-updown-15m-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
	{
		id: "BTC-1h",
		coin: "BTC",
		label: "Bitcoin 1h",
		candleWindowMinutes: 60,
		resolutionSource: "binance",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "10114",
			seriesSlug: "btc-up-or-down-hourly",
			slugPrefix: "bitcoin-up-or-down-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
	{
		id: "BTC-4h",
		coin: "BTC",
		label: "Bitcoin 4h",
		candleWindowMinutes: 240,
		resolutionSource: "chainlink",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "10331",
			seriesSlug: "btc-up-or-down-4h",
			slugPrefix: "btc-updown-4h-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
];

export function getMarketById(id: string): MarketConfig | null {
	return MARKETS.find((m) => m.id === id) ?? null;
}

export function getActiveMarkets(): MarketConfig[] {
	const active = env.ACTIVE_MARKETS;
	if (active.length === 0) return MARKETS;
	const wanted = new Set(active);
	const filtered = MARKETS.filter((m) => wanted.has(m.id));
	if (filtered.length === 0) {
		log.warn(
			`No valid ACTIVE_MARKETS=[${active.join(",")}]. Valid: ${MARKETS.map((m) => m.id).join(", ")}. Using all.`,
		);
		return MARKETS;
	}
	return filtered;
}
