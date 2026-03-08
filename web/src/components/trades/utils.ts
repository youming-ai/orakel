import type { TradeRecord } from "@/contracts/http";
import { fmtTime } from "@/lib/format";

export function fmtTimestamp(ts: string): string {
	if (!ts) return "-";
	return fmtTime(ts) || ts;
}

export function sideLabel(side: string): { text: string; isUp: boolean } {
	const up = (side ?? "").includes("UP");
	return { text: up ? "BUY UP" : "BUY DOWN", isUp: up };
}

type MarketConfig = {
	windowMinutes: number;
	slugPrefix: string;
	slugFormat: "timestamp" | "descriptive";
};

// Maps marketId (e.g., "BTC-15m") to config for generating Polymarket URLs
// Matches src/core/markets.ts slugPrefix values
const MARKET_CONFIGS: Record<string, MarketConfig> = {
	"BTC-15m": { windowMinutes: 15, slugPrefix: "btc-updown-15m-", slugFormat: "timestamp" },
	"ETH-15m": { windowMinutes: 15, slugPrefix: "eth-updown-15m-", slugFormat: "timestamp" },
};

export function getMarketCycleSlug(market: string, timestamp: string, marketSlug?: string | null): string | null {
	if (!market || !timestamp) return null;

	// If marketSlug is available (from DB), use it directly
	if (marketSlug) {
		return marketSlug;
	}

	const config = MARKET_CONFIGS[market];
	if (!config) return null;

	const tsSec = Math.floor(new Date(timestamp).getTime() / 1000);
	if (Number.isNaN(tsSec)) return null;

	// For timestamp-based slugs (5m, 15m): compute window start from timestamp
	const windowSeconds = config.windowMinutes * 60;
	const windowStart = Math.floor(tsSec / windowSeconds) * windowSeconds;

	if (config.slugFormat === "timestamp") {
		return `${config.slugPrefix}${windowStart}`;
	}

	// Return null to fall back to displaying market ID only
	return null;
}

export function getPolymarketUrl(slug: string): string {
	return `https://polymarket.com/event/${slug}`;
}

export function getDisplayMode(trade: TradeRecord, paperMode: boolean): string {
	return trade.mode?.toUpperCase() || (paperMode ? "PAPER" : "LIVE");
}
