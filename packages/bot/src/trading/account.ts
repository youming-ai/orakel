import type { AccountStatsDto, Side } from "@orakel/shared/contracts";
import { computeBinaryPnl } from "./pnl.ts";

interface PendingTrade {
	side: Side;
	size: number;
	price: number;
	settled: boolean;
	won: boolean | null;
	pnl: number | null;
	timestamp: number;
}

const ET_TIMEZONE = "America/New_York";

function getEtDayStartMs(timestampMs: number): number {
	const date = new Date(timestampMs);
	const etFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: ET_TIMEZONE,
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: false,
	});
	const parts = etFormatter.formatToParts(date);
	const getPart = (type: string) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

	const year = getPart("year");
	const month = getPart("month");
	const day = getPart("day");

	const etDateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-04:00`;
	return new Date(etDateStr).getTime();
}

export interface AccountManager {
	recordTrade(params: { side: Side; size: number; price: number }): number;
	settleTrade(index: number, won: boolean): void;
	getStats(): AccountStatsDto;
	getTodayLossUsdc(): number;
	getPendingCount(): number;
}

export function createAccountManager(initialBalanceUsdc: number, dailyMaxLossUsdc: number): AccountManager {
	let balance = initialBalanceUsdc;
	const trades: PendingTrade[] = [];

	function computePnl(trade: PendingTrade, won: boolean): number {
		return computeBinaryPnl(trade.size, trade.price, won);
	}

	return {
		recordTrade({ side, size, price }) {
			const idx = trades.length;
			trades.push({ side, size, price, settled: false, won: null, pnl: null, timestamp: Date.now() });
			return idx;
		},

		settleTrade(index, won) {
			const trade = trades[index];
			if (!trade || trade.settled) return;
			trade.settled = true;
			trade.won = won;
			trade.pnl = computePnl(trade, won);
			balance += trade.pnl;
		},

		getStats() {
			const settled = trades.filter((t) => t.settled);
			const wins = settled.filter((t) => t.won === true).length;
			const losses = settled.filter((t) => t.won === false).length;
			const pending = trades.filter((t) => !t.settled).length;
			const totalPnl = settled.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

			const todayMs = getEtDayStartMs(Date.now());
			const todayTrades = settled.filter((t) => t.timestamp >= todayMs);
			const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

			const total = wins + losses;
			return {
				totalTrades: total,
				wins,
				losses,
				pending,
				winRate: total > 0 ? wins / total : 0,
				totalPnl,
				todayPnl,
				todayTrades: todayTrades.length,
				dailyMaxLoss: dailyMaxLossUsdc,
				balanceUsdc: balance,
			};
		},

		getTodayLossUsdc() {
			const todayMs = getEtDayStartMs(Date.now());
			return trades
				.filter((t) => t.settled && t.timestamp >= todayMs && (t.pnl ?? 0) < 0)
				.reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0);
		},

		getPendingCount() {
			return trades.filter((t) => !t.settled).length;
		},
	};
}
