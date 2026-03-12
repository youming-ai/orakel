import type { MarketBreakdown, PaperStats, PaperTradeEntry } from "@/contracts/http";
import { fmtTime } from "./format";

export interface ExtendedStats extends PaperStats {
	avgPnl: number;
	bestTrade: number;
	worstTrade: number;
	streak: number; // positive = win streak, negative = loss streak
	profitFactor: number; // gross wins / gross losses
}

export function buildStatsFromTrades(trades: PaperTradeEntry[]): ExtendedStats {
	let wins = 0;
	let losses = 0;
	let pending = 0;
	let totalPnl = 0;
	let bestTrade = 0;
	let worstTrade = 0;
	let grossWins = 0;
	let grossLosses = 0;
	for (const trade of trades) {
		if (!trade.resolved) {
			pending += 1;
			continue;
		}
		const pnl = trade.pnl ?? 0;
		if (trade.won) {
			wins += 1;
			grossWins += pnl;
		} else {
			losses += 1;
			grossLosses += Math.abs(pnl);
		}
		totalPnl += pnl;
		if (pnl > bestTrade) bestTrade = pnl;
		if (pnl < worstTrade) worstTrade = pnl;
	}
	const resolved = wins + losses;
	const avgPnl = resolved > 0 ? totalPnl / resolved : 0;

	// Compute current streak from most recent resolved trades
	const sortedResolved = trades.filter((t) => t.resolved).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	let streak = 0;
	if (sortedResolved.length > 0) {
		const firstWon = sortedResolved[0].won;
		for (const t of sortedResolved) {
			if (t.won === firstWon) streak++;
			else break;
		}
		if (!firstWon) streak = -streak;
	}

	return {
		totalTrades: trades.length,
		wins,
		losses,
		pending,
		winRate: resolved > 0 ? wins / resolved : 0,
		totalPnl: Number(totalPnl.toFixed(2)),
		todayPnl: Number(totalPnl.toFixed(2)),
		todayTrades: resolved,
		dailyMaxLoss: 0,
		balanceUsdc: 0,
		avgPnl: Number(avgPnl.toFixed(2)),
		bestTrade: Number(bestTrade.toFixed(2)),
		worstTrade: Number(worstTrade.toFixed(2)),
		streak,
		profitFactor: grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? 999 : 0,
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

interface PnLTimelineEntry {
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
