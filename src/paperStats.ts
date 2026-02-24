import fs from "node:fs";
import { PAPER_INITIAL_BALANCE } from "./config.ts";
import { PERSIST_BACKEND, statements } from "./db.ts";
import type { PaperStats, PaperTradeEntry, Side } from "./types.ts";

const STATS_PATH = "./logs/paper-stats.json";

interface PersistedPaperState {
	trades: PaperTradeEntry[];
	wins: number;
	losses: number;
	totalPnl: number;
	initialBalance: number;
	currentBalance: number;
	maxDrawdown: number;
}

let state: PersistedPaperState = {
	trades: [],
	wins: 0,
	losses: 0,
	totalPnl: 0,
	initialBalance: PAPER_INITIAL_BALANCE,
	currentBalance: PAPER_INITIAL_BALANCE,
	maxDrawdown: 0,
};

try {
	if (fs.existsSync(STATS_PATH)) {
		const raw = fs.readFileSync(STATS_PATH, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			const obj = parsed as Record<string, unknown>;
			state = {
				trades: Array.isArray(obj.trades)
					? (obj.trades as PaperTradeEntry[])
					: [],
				wins: typeof obj.wins === "number" ? obj.wins : 0,
				losses: typeof obj.losses === "number" ? obj.losses : 0,
				totalPnl: typeof obj.totalPnl === "number" ? obj.totalPnl : 0,
				initialBalance:
					typeof obj.initialBalance === "number"
						? obj.initialBalance
						: PAPER_INITIAL_BALANCE,
				currentBalance:
					typeof obj.currentBalance === "number"
						? obj.currentBalance
						: PAPER_INITIAL_BALANCE +
							(typeof obj.totalPnl === "number" ? obj.totalPnl : 0),
				maxDrawdown: typeof obj.maxDrawdown === "number" ? obj.maxDrawdown : 0,
			};
		}
	}
} catch {}

function save(): void {
	if (PERSIST_BACKEND === "csv" || PERSIST_BACKEND === "dual") {
		fs.mkdirSync("./logs", { recursive: true });
		fs.writeFileSync(STATS_PATH, JSON.stringify(state, null, 2));
	}

	if (PERSIST_BACKEND === "dual" || PERSIST_BACKEND === "sqlite") {
		statements.upsertDailyStats().run({
			$date: new Date().toDateString(),
			$mode: "paper",
			$pnl: state.totalPnl,
			$trades: state.trades.length,
			$wins: state.wins,
			$losses: state.losses,
		});
	}
}

function upsertPaperTrade(trade: PaperTradeEntry): void {
	if (PERSIST_BACKEND !== "dual" && PERSIST_BACKEND !== "sqlite") return;

	statements.insertPaperTrade().run({
		$id: trade.id,
		$marketId: trade.marketId,
		$windowStartMs: trade.windowStartMs,
		$side: trade.side,
		$price: trade.price,
		$size: trade.size,
		$priceToBeat: trade.priceToBeat,
		$currentPriceAtEntry: trade.currentPriceAtEntry,
		$timestamp: trade.timestamp,
		$resolved: trade.resolved ? 1 : 0,
		$won: trade.won === null ? null : trade.won ? 1 : 0,
		$pnl: trade.pnl,
		$settlePrice: trade.settlePrice,
	});
}

export function addPaperTrade(
	entry: Omit<
		PaperTradeEntry,
		"id" | "resolved" | "won" | "pnl" | "settlePrice"
	>,
): string {
	const id = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const trade: PaperTradeEntry = {
		...entry,
		id,
		resolved: false,
		won: null,
		pnl: null,
		settlePrice: null,
	};
	state.trades.push(trade);
	state.currentBalance -= entry.size;
	upsertPaperTrade(trade);
	save();
	return id;
}

export function resolvePaperTrades(
	windowStartMs: number,
	finalPrices: Map<string, number>,
): number {
	let resolved = 0;
	for (const trade of state.trades) {
		if (trade.resolved) continue;
		if (trade.windowStartMs !== windowStartMs) continue;

		const finalPrice = finalPrices.get(trade.marketId);
		if (finalPrice === undefined || trade.priceToBeat <= 0) continue;

		const upWon = finalPrice > trade.priceToBeat;
		const downWon = finalPrice < trade.priceToBeat;
		const outcome: Side | null = upWon ? "UP" : downWon ? "DOWN" : null;

		if (outcome === null) {
			// Tie: price === PTB → treat as DOWN wins (standard Polymarket rule)
			trade.won = trade.side === "DOWN";
		} else {
			trade.won = trade.side === outcome;
		}

		trade.settlePrice = finalPrice;
		trade.resolved = true;

		if (trade.won) {
			trade.pnl = trade.size * (1 - trade.price);
			state.wins++;
		} else {
			trade.pnl = -(trade.size * trade.price);
			state.losses++;
		}

		state.currentBalance += trade.size + trade.pnl;
		const drawdown = state.initialBalance - state.currentBalance;
		if (drawdown > state.maxDrawdown) state.maxDrawdown = drawdown;
		state.totalPnl += trade.pnl;
		upsertPaperTrade(trade);
		resolved++;
	}

	if (resolved > 0) save();
	return resolved;
}

export function getPaperStats(): PaperStats {
	const pending = state.trades.filter((t) => !t.resolved).length;
	const total = state.wins + state.losses;
	return {
		totalTrades: state.trades.length,
		wins: state.wins,
		losses: state.losses,
		pending,
		winRate: total > 0 ? state.wins / total : 0,
		totalPnl: state.totalPnl,
	};
}

export function getPaperBalance(): {
	initial: number;
	current: number;
	maxDrawdown: number;
} {
	return {
		initial: state.initialBalance,
		current: state.currentBalance,
		maxDrawdown: state.maxDrawdown,
	};
}

export function canAffordTrade(size: number): boolean {
	return state.currentBalance >= size;
}

export function resetPaperBalance(initialBalance?: number): void {
	state.initialBalance = initialBalance ?? PAPER_INITIAL_BALANCE;
	state.currentBalance = state.initialBalance;
	state.maxDrawdown = 0;
	save();
}

export function getPendingPaperTrades(): PaperTradeEntry[] {
	return state.trades.filter((t) => !t.resolved);
}

export function getRecentPaperTrades(limit?: number): PaperTradeEntry[] {
	if (limit === undefined) return [...state.trades];
	return state.trades.slice(-limit);
}

export interface MarketBreakdown {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}

export function getMarketBreakdown(): Record<string, MarketBreakdown> {
	const breakdown: Record<string, MarketBreakdown> = {};
	const markets = ["BTC", "ETH", "SOL", "XRP"];

	for (const market of markets) {
		const trades = state.trades.filter((t) => t.marketId === market);
		const resolved = trades.filter((t) => t.resolved);
		const wins = resolved.filter((t) => t.won).length;
		const losses = resolved.filter((t) => !t.won).length;
		const pending = trades.filter((t) => !t.resolved).length;
		const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

		breakdown[market] = {
			wins,
			losses,
			pending,
			winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
			totalPnl,
			tradeCount: trades.length,
		};
	}

	return breakdown;
}
