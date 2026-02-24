import fs from "node:fs";
import { PAPER_INITIAL_BALANCE, CONFIG } from "./config.ts";
import { PERSIST_BACKEND, statements } from "./db.ts";
import type { PaperStats, PaperTradeEntry, Side } from "./types.ts";

const STATS_PATH = "./logs/paper-stats.json";

interface DailyPnl {
	date: string;
	pnl: number;
	trades: number;
}

interface PersistedPaperState {
	trades: PaperTradeEntry[];
	wins: number;
	losses: number;
	totalPnl: number;
	initialBalance: number;
	currentBalance: number;
	maxDrawdown: number;
	dailyPnl: DailyPnl[];
	dailyCountedTradeIds: string[]; // Persisted as array, mirrored to Set for O(1) lookups
	stoppedAt: string | null;
	stopReason: string | null;
}

let state: PersistedPaperState = {
	trades: [],
	wins: 0,
	losses: 0,
	totalPnl: 0,
	initialBalance: PAPER_INITIAL_BALANCE,
	currentBalance: PAPER_INITIAL_BALANCE,
	maxDrawdown: 0,
	dailyPnl: [],
	dailyCountedTradeIds: [],
	stoppedAt: null,
	stopReason: null,
};

// O(1) lookup mirror of state.dailyCountedTradeIds
let dailyCountedTradeIdSet = new Set<string>();

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
				dailyPnl: Array.isArray(obj.dailyPnl)
					? (obj.dailyPnl as DailyPnl[])
					: [],
				dailyCountedTradeIds: Array.isArray(obj.dailyCountedTradeIds)
					? (obj.dailyCountedTradeIds as string[])
					: [],
				stoppedAt: typeof obj.stoppedAt === "string" ? obj.stoppedAt : null,
				stopReason: typeof obj.stopReason === "string" ? obj.stopReason : null,
			};
		}
	}
} catch {}
// Initialize the Set mirror from persisted array
dailyCountedTradeIdSet = new Set(state.dailyCountedTradeIds);

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
		
		// Update daily PnL tracking (with deduplication)
		updateDailyPnl(trade.id, trade.pnl);
		
		upsertPaperTrade(trade);
		resolved++;
	}

	if (resolved > 0) {
		// Check stop loss after resolving
		checkAndTriggerStopLoss();
		save();
	}
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

// ============ Stop Loss & Daily Tracking ============

function getTodayDate(): string {
	return new Date().toISOString().split("T")[0] ?? "";
}

function getTodayPnl(): DailyPnl {
	const today = getTodayDate();
	let todayData = state.dailyPnl.find(d => d.date === today);
	if (!todayData) {
		todayData = { date: today, pnl: 0, trades: 0 };
		state.dailyPnl.push(todayData);
		// Keep only last 30 days
		if (state.dailyPnl.length > 30) {
			state.dailyPnl = state.dailyPnl.slice(-30);
		}
	}
	return todayData;
}

export function getDailyPnl(): { date: string; pnl: number; trades: number }[] {
	return [...state.dailyPnl].sort((a, b) => b.date.localeCompare(a.date));
}

export function getTodayStats(): { pnl: number; trades: number; limit: number } {
	const today = getTodayPnl();
	return {
		pnl: today.pnl,
		trades: today.trades,
		limit: CONFIG.paperRisk.dailyMaxLossUsdc,
	};
}

export function isDailyLossLimitExceeded(): boolean {
	const today = getTodayPnl();
	const limit = CONFIG.paperRisk.dailyMaxLossUsdc;
	return today.pnl < -limit;
}

export function isStopped(): boolean {
	return state.stoppedAt !== null;
}

export function getStopReason(): { stoppedAt: string | null; reason: string | null } {
	return {
		stoppedAt: state.stoppedAt,
		reason: state.stopReason,
	};
}

export function checkAndTriggerStopLoss(): { triggered: boolean; reason: string | null } {
	if (state.stoppedAt) {
		return { triggered: true, reason: state.stopReason };
	}

	// Check daily loss limit
	if (isDailyLossLimitExceeded()) {
		state.stoppedAt = new Date().toISOString();
		state.stopReason = `daily_loss_limit:${(-getTodayPnl().pnl).toFixed(2)}`;
		save();
		return { triggered: true, reason: state.stopReason };
	}

	// Check max drawdown (50% of initial balance)
	const maxAllowedDrawdown = state.initialBalance * 0.5;
	if (state.maxDrawdown >= maxAllowedDrawdown) {
		state.stoppedAt = new Date().toISOString();
		state.stopReason = `max_drawdown:${state.maxDrawdown.toFixed(2)}`;
		save();
		return { triggered: true, reason: state.stopReason };
	}

	return { triggered: false, reason: null };
}

export function clearStopFlag(): void {
	state.stoppedAt = null;
	state.stopReason = null;
	save();
}

// Updated canAffordTrade with stop loss check
export function canAffordTradeWithStopCheck(size: number): { canTrade: boolean; reason: string | null } {
	// Check if stopped
	const stopCheck = checkAndTriggerStopLoss();
	if (stopCheck.triggered) {
		return { canTrade: false, reason: `trading_stopped:${stopCheck.reason}` };
	}

	// Check balance
	if (state.currentBalance < size) {
		return { canTrade: false, reason: "insufficient_balance" };
	}

	// Check daily loss limit (pre-trade)
	if (isDailyLossLimitExceeded()) {
		return { canTrade: false, reason: "daily_loss_limit_exceeded" };
	}

	return { canTrade: true, reason: null };
}

// Update daily PnL tracking in resolvePaperTrades (with deduplication)
function updateDailyPnl(tradeId: string, pnl: number): void {
	// Skip if already counted (O(1) Set lookup)
	if (dailyCountedTradeIdSet.has(tradeId)) {
		return;
	}
	
	const today = getTodayPnl();
	today.pnl += pnl;
	today.trades += 1;
	state.dailyCountedTradeIds.push(tradeId);
	dailyCountedTradeIdSet.add(tradeId);
	
	// Clean up old trade IDs (keep only last 500)
	if (state.dailyCountedTradeIds.length > 500) {
		state.dailyCountedTradeIds = state.dailyCountedTradeIds.slice(-500);
		dailyCountedTradeIdSet = new Set(state.dailyCountedTradeIds);
	}
}
