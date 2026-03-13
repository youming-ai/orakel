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

// Maps marketId (e.g., "BTC-5m") to config for generating Polymarket URLs
// Matches src/core/markets.ts slugPrefix values
const MARKET_CONFIGS: Record<string, MarketConfig> = {
	"BTC-5m": { windowMinutes: 5, slugPrefix: "btc-updown-5m-", slugFormat: "timestamp" },
};

const ET_TIMEZONE = "America/New_York";

function getEtTimeParts(timestampMs: number): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
} {
	const date = new Date(timestampMs);
	const etFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: ET_TIMEZONE,
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		hour12: false,
	});
	const parts = etFormatter.formatToParts(date);
	const getPart = (type: string) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

	return {
		year: getPart("year"),
		month: getPart("month"),
		day: getPart("day"),
		hour: getPart("hour"),
		minute: getPart("minute"),
	};
}

function etToUtcTimestamp(year: number, month: number, day: number, hour: number, minute: number): number {
	const etDateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`;
	return Math.floor(new Date(etDateStr).getTime() / 1000);
}

export function getMarketCycleSlug(market: string, timestamp: string, marketSlug?: string | null): string | null {
	if (!market || !timestamp) return null;

	// If marketSlug is available (from DB), use it directly
	if (marketSlug) {
		return marketSlug;
	}

	const config = MARKET_CONFIGS[market];
	if (!config) return null;

	const timestampMs = new Date(timestamp).getTime();
	if (Number.isNaN(timestampMs)) return null;

	const etParts = getEtTimeParts(timestampMs);
	const windowMinutes = config.windowMinutes;
	const currentMinuteOfDay = etParts.hour * 60 + etParts.minute;
	const windowIndex = Math.floor(currentMinuteOfDay / windowMinutes);
	const windowStartMinuteOfDay = windowIndex * windowMinutes;
	const startHour = Math.floor(windowStartMinuteOfDay / 60);
	const startMin = windowStartMinuteOfDay % 60;
	const windowStartSec = etToUtcTimestamp(etParts.year, etParts.month, etParts.day, startHour, startMin);

	if (config.slugFormat === "timestamp") {
		return `${config.slugPrefix}${windowStartSec}`;
	}

	return null;
}

export function getPolymarketUrl(slug: string): string {
	return `https://polymarket.com/event/${slug}`;
}

export function getDisplayMode(trade: TradeRecord, paperMode: boolean): string {
	return trade.mode?.toUpperCase() || (paperMode ? "PAPER" : "LIVE");
}
