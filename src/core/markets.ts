import type { MarketConfig } from "./configTypes.ts";
import { env } from "./env.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("markets");

export const MARKETS: MarketConfig[] = [
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
		id: "ETH-15m",
		coin: "ETH",
		label: "Ethereum 15m",
		candleWindowMinutes: 15,
		resolutionSource: "chainlink",
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
		pricePrecision: 2,
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
