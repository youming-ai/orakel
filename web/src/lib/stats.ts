import type { MarketBreakdown, PaperStats, PaperTradeEntry, TradeRecord } from "./api";
import { fmtTime } from "./format";

export function liveTradesAsPaper(trades: TradeRecord[]): PaperTradeEntry[] {
	if (!Array.isArray(trades)) return [];
	return trades.map((t) => ({
		id: t.orderId,
		marketId: t.market,
		windowStartMs: new Date(t.timestamp).getTime(),
		side: (t.side.includes("UP") ? "UP" : "DOWN") as "UP" | "DOWN",
		price: Number.parseFloat(t.price) || 0,
		size: Number.parseFloat(t.amount) || 0,
		priceToBeat: 0,
		currentPriceAtEntry: null,
		timestamp: t.timestamp,
		resolved: t.status === "settled" || t.status === "won" || t.status === "lost" || t.won !== null,
		won: t.won === null ? null : Boolean(t.won),
		pnl: t.pnl,
		settlePrice: null,
	}));
}

export function buildStatsFromTrades(trades: PaperTradeEntry[]): PaperStats {
	let wins = 0;
	let losses = 0;
	let pending = 0;
	let totalPnl = 0;
	for (const trade of trades) {
		if (!trade.resolved) {
			pending += 1;
			continue;
		}
		if (trade.won) wins += 1;
		else losses += 1;
		totalPnl += trade.pnl ?? 0;
	}
	const resolved = wins + losses;
	return {
		totalTrades: trades.length,
		wins,
		losses,
		pending,
		winRate: resolved > 0 ? wins / resolved : 0,
		totalPnl: Number(totalPnl.toFixed(2)),
	};
}

export function buildMarketFromTrades(trades: PaperTradeEntry[]): Record<string, MarketBreakdown> {
	const marketMap = new Map<string, MarketBreakdown>();
	for (const trade of trades) {
		const current = marketMap.get(trade.marketId) ?? {
			wins: 0,
			losses: 0,
			pending: 0,
			winRate: 0,
			totalPnl: 0,
			tradeCount: 0,
		};
		current.tradeCount += 1;
		if (!trade.resolved) current.pending += 1;
		else if (trade.won) current.wins += 1;
		else current.losses += 1;
		current.totalPnl += trade.pnl ?? 0;
		marketMap.set(trade.marketId, current);
	}

	const result: Record<string, MarketBreakdown> = {};
	for (const [market, item] of marketMap.entries()) {
		const resolved = item.wins + item.losses;
		result[market] = {
			...item,
			winRate: resolved > 0 ? item.wins / resolved : 0,
			totalPnl: Number(item.totalPnl.toFixed(2)),
		};
	}
	return result;
}

export interface PnLTimelineEntry {
	ts: string;
	time: string;
	market: string;
	side: string;
	pnl: number;
	cumulative: number;
}

export function buildPnlTimeline(trades: PaperTradeEntry[]): PnLTimelineEntry[] {
	const resolved = trades
		.filter((t) => t.resolved && t.pnl !== null)
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

	let running = 0;
	return resolved.map((trade) => {
		running += trade.pnl ?? 0;
		return {
			ts: trade.timestamp,
			time: fmtTime(trade.timestamp),
			market: trade.marketId,
			side: trade.side,
			pnl: trade.pnl ?? 0,
			cumulative: Number(running.toFixed(2)),
		};
	});
}
