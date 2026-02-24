import { env } from "./env.ts";
import type { MarketConfig } from "./types.ts";

export const MARKETS: MarketConfig[] = [
	{
		id: "BTC",
		label: "Bitcoin",
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
		id: "ETH",
		label: "Ethereum",
		binanceSymbol: "ETHUSDT",
		polymarket: {
			seriesId: "10191",
			seriesSlug: "eth-up-or-down-15m",
			slugPrefix: "eth-updown-15m-",
		},
		chainlink: {
			aggregator: "0xF9680D99D6C9589e2a93a78A04A279e509205945",
			decimals: 8,
			wsSymbol: "eth",
		},
		pricePrecision: 1,
	},
	{
		id: "SOL",
		label: "Solana",
		binanceSymbol: "SOLUSDT",
		polymarket: {
			seriesId: "10423",
			seriesSlug: "sol-up-or-down-15m",
			slugPrefix: "sol-updown-15m-",
		},
		chainlink: {
			aggregator: "0x10C8264C0935b3B9870013e4003f3875af17dE23",
			decimals: 8,
			wsSymbol: "sol",
		},
		pricePrecision: 2,
	},
	{
		id: "XRP",
		label: "XRP",
		binanceSymbol: "XRPUSDT",
		polymarket: {
			seriesId: "10422",
			seriesSlug: "xrp-up-or-down-15m",
			slugPrefix: "xrp-updown-15m-",
		},
		chainlink: {
			aggregator: "0x785ba89291f676b5386652eB12b30cF361020694",
			decimals: 8,
			wsSymbol: "xrp",
		},
		pricePrecision: 4,
	},
];

export function getMarketById(id: string): MarketConfig | null {
	return MARKETS.find((m) => m.id === id) ?? null;
}

export function getActiveMarkets(): MarketConfig[] {
	const active = env.ACTIVE_MARKETS;
	if (active.length === 0) return MARKETS;
	const wanted = new Set(active.map((s) => s.toUpperCase()));
	const filtered = MARKETS.filter((m) => wanted.has(m.id));
	return filtered.length > 0 ? filtered : MARKETS;
}
