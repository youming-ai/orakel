import type { TradeRecord } from "@/lib/api";
import { fmtTime } from "@/lib/format";

export function fmtTimestamp(ts: string): string {
	if (!ts) return "-";
	return fmtTime(ts) || ts;
}

export function sideLabel(side: string): { text: string; isUp: boolean } {
	const up = (side ?? "").includes("UP");
	return { text: up ? "BUY UP" : "BUY DOWN", isUp: up };
}

const WINDOW_SEC = 15 * 60;

export function getMarketCycleSlug(market: string, timestamp: string): string | null {
	if (!market || !timestamp) return null;
	const tsSec = Math.floor(new Date(timestamp).getTime() / 1000);
	if (Number.isNaN(tsSec)) return null;
	const windowStart = Math.floor(tsSec / WINDOW_SEC) * WINDOW_SEC;
	return `${market.toLowerCase()}-updown-15m-${windowStart}`;
}

export function getPolymarketUrl(slug: string): string {
	return `https://polymarket.com/event/${slug}`;
}

export function getDisplayMode(trade: TradeRecord, paperMode: boolean): string {
	return trade.mode?.toUpperCase() || (paperMode ? "PAPER" : "LIVE");
}
