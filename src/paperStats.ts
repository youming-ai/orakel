import fs from "node:fs";
import { getAndClearSignalMetadata, performanceTracker, signalQualityModel } from "./adaptiveState.ts";
import { CONFIG, PAPER_INITIAL_BALANCE } from "./config.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("paperStats");

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

interface PaperStateRow {
	initial_balance: number;
	current_balance: number;
	max_drawdown: number;
	wins: number;
	losses: number;
	total_pnl: number;
	stopped_at: string | null;
	stop_reason: string | null;
	daily_pnl: string;
	daily_counted_trade_ids: string;
}

interface PaperTradeRow {
	id: string;
	market_id: string;
	window_start_ms: number;
	side: string;
	price: number;
	size: number;
	price_to_beat: number;
	current_price_at_entry: number | null;
	timestamp: string;
	resolved: number;
	won: number | null;
	pnl: number | null;
	settle_price: number | null;
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

let loadedFromSqlite = false;

export function initPaperStats(): void {
	if (PERSIST_BACKEND === "sqlite" || PERSIST_BACKEND === "dual") {
		try {
			const row = statements.getPaperState().get() as PaperStateRow | null;
			const tradeRows = statements.getAllPaperTrades().all() as PaperTradeRow[];
			const trades = tradeRows.map((r) => ({
				id: r.id,
				marketId: r.market_id,
				windowStartMs: r.window_start_ms,
				side: r.side as "UP" | "DOWN",
				price: r.price,
				size: r.size,
				priceToBeat: r.price_to_beat,
				currentPriceAtEntry: r.current_price_at_entry,
				timestamp: r.timestamp,
				resolved: Boolean(r.resolved),
				won: r.won === null ? null : Boolean(r.won),
				pnl: r.pnl,
				settlePrice: r.settle_price,
			}));

			if (row) {
				// Normal path: paper_state row + trades both exist
				state = {
					trades,
					wins: row.wins,
					losses: row.losses,
					totalPnl: row.total_pnl,
					initialBalance: row.initial_balance,
					currentBalance: row.current_balance,
					maxDrawdown: row.max_drawdown,
					dailyPnl: safeParseJson<DailyPnl[]>(row.daily_pnl, []),
					dailyCountedTradeIds: safeParseJson<string[]>(row.daily_counted_trade_ids, []),
					stoppedAt: row.stopped_at,
					stopReason: row.stop_reason,
				};
				loadedFromSqlite = true;
			} else if (trades.length > 0) {
				// Recovery: paper_state missing but paper_trades exist — reconstruct
				let wins = 0;
				let losses = 0;
				let totalPnl = 0;
				let currentBalance = PAPER_INITIAL_BALANCE;
				let maxDrawdown = 0;

				for (const t of trades) {
					if (t.resolved) {
						if (t.won) wins++;
						else losses++;
						const pnl = t.pnl ?? 0;
						totalPnl += pnl;
						currentBalance += pnl;
					} else {
						currentBalance -= t.size;
					}
					const drawdown = PAPER_INITIAL_BALANCE - currentBalance;
					if (drawdown > maxDrawdown) maxDrawdown = drawdown;
				}

				state = {
					trades,
					wins,
					losses,
					totalPnl,
					initialBalance: PAPER_INITIAL_BALANCE,
					currentBalance,
					maxDrawdown,
					dailyPnl: [],
					dailyCountedTradeIds: [],
					stoppedAt: null,
					stopReason: null,
				};

				// Persist the reconstructed state so this recovery is one-time
				savePaperState();
				loadedFromSqlite = true;
			}
		} catch (err) {
			log.warn("Failed to load paper state from SQLite:", err);
		}
	}

	// Fallback: load from JSON (csv mode, or first migration from JSON → SQLite)
	if (!loadedFromSqlite) {
		try {
			if (fs.existsSync(STATS_PATH)) {
				const raw = fs.readFileSync(STATS_PATH, "utf8");
				const parsed: unknown = JSON.parse(raw);
				if (parsed && typeof parsed === "object") {
					const obj = parsed as Record<string, unknown>;
					state = {
						trades: Array.isArray(obj.trades) ? (obj.trades as PaperTradeEntry[]) : [],
						wins: typeof obj.wins === "number" ? obj.wins : 0,
						losses: typeof obj.losses === "number" ? obj.losses : 0,
						totalPnl: typeof obj.totalPnl === "number" ? obj.totalPnl : 0,
						initialBalance: typeof obj.initialBalance === "number" ? obj.initialBalance : PAPER_INITIAL_BALANCE,
						currentBalance:
							typeof obj.currentBalance === "number"
								? obj.currentBalance
								: PAPER_INITIAL_BALANCE + (typeof obj.totalPnl === "number" ? obj.totalPnl : 0),
						maxDrawdown: typeof obj.maxDrawdown === "number" ? obj.maxDrawdown : 0,
						dailyPnl: Array.isArray(obj.dailyPnl) ? (obj.dailyPnl as DailyPnl[]) : [],
						dailyCountedTradeIds: Array.isArray(obj.dailyCountedTradeIds) ? (obj.dailyCountedTradeIds as string[]) : [],
						stoppedAt: typeof obj.stoppedAt === "string" ? obj.stoppedAt : null,
						stopReason: typeof obj.stopReason === "string" ? obj.stopReason : null,
					};

					// Migrate JSON data into SQLite on first run
					if (PERSIST_BACKEND === "sqlite" || PERSIST_BACKEND === "dual") {
						for (const trade of state.trades) {
							upsertPaperTrade(trade);
						}
						savePaperState();
					}
				}
			}
		} catch (err) {
			log.warn("Failed to load paper state from JSON:", err);
		}
	}

	// Initialize the Set mirror from persisted array
	dailyCountedTradeIdSet = new Set(state.dailyCountedTradeIds);
}
// Call at module scope for backward compat
initPaperStats();

// ============ Persistence ============

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function savePaperState(): void {
	statements.upsertPaperState().run({
		$initialBalance: state.initialBalance,
		$currentBalance: state.currentBalance,
		$maxDrawdown: state.maxDrawdown,
		$wins: state.wins,
		$losses: state.losses,
		$totalPnl: state.totalPnl,
		$stoppedAt: state.stoppedAt,
		$stopReason: state.stopReason,
		$dailyPnl: JSON.stringify(state.dailyPnl),
		$dailyCountedTradeIds: JSON.stringify(state.dailyCountedTradeIds),
	});
}

function save(): void {
	if (PERSIST_BACKEND === "csv" || PERSIST_BACKEND === "dual") {
		fs.mkdirSync("./logs", { recursive: true });
		fs.writeFileSync(STATS_PATH, JSON.stringify(state, null, 2));
	}

	if (PERSIST_BACKEND === "dual" || PERSIST_BACKEND === "sqlite") {
		savePaperState();

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

export function addPaperTrade(entry: Omit<PaperTradeEntry, "id" | "resolved" | "won" | "pnl" | "settlePrice">): string {
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

export function resolvePaperTrades(windowStartMs: number, finalPrices: Map<string, number>): number {
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

		const signalMeta = getAndClearSignalMetadata(trade.id);
		if (signalMeta) {
			performanceTracker.recordTrade({
				marketId: trade.marketId,
				won: trade.won ?? false,
				edge: signalMeta.edge,
				confidence: signalMeta.confidence,
				phase: signalMeta.phase,
				regime: signalMeta.regime,
				timestamp: Date.now(),
			});

			signalQualityModel.recordOutcome({
				marketId: trade.marketId,
				edge: signalMeta.edge,
				confidence: signalMeta.confidence,
				volatility15m: signalMeta.volatility15m ?? 0,
				phase: signalMeta.phase,
				regime: signalMeta.regime,
				modelUp: signalMeta.modelUp ?? 0.5,
				orderbookImbalance: signalMeta.orderbookImbalance ?? null,
				rsi: signalMeta.rsi ?? null,
				vwapSlope: signalMeta.vwapSlope ?? null,
				won: trade.won ?? false,
				pnl: trade.pnl ?? 0,
				timestamp: Date.now(),
			});
		}

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
	let todayData = state.dailyPnl.find((d) => d.date === today);
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
