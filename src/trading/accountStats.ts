/**
 * Unified account state manager for both paper and live trading modes.
 * Generalizes paperStats.ts: identical behavior, per-mode state isolation.
 */
import fs from "node:fs";
import { CONFIG, LIVE_INITIAL_BALANCE, PAPER_INITIAL_BALANCE } from "../core/config.ts";
import { PERSIST_BACKEND, resetLiveDbData, resetPaperDbData, statements } from "../core/db.ts";
import { createLogger } from "../core/logger.ts";
import type { AccountMode, RiskConfig, Side } from "../types.ts";

// ============ Types ============

interface DailyPnl {
	date: string;
	pnl: number;
	trades: number;
}

interface PersistedAccountState {
	trades: TradeEntry[];
	wins: number;
	losses: number;
	totalPnl: number;
	initialBalance: number;
	currentBalance: number;
	maxDrawdown: number;
	dailyPnl: DailyPnl[];
	dailyCountedTradeIds: string[];
	stoppedAt: string | null;
	stopReason: string | null;
}

interface StateRow {
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

interface TradeRow {
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

export interface TradeEntry {
	id: string;
	marketId: string;
	windowStartMs: number;
	side: Side;
	price: number;
	size: number;
	priceToBeat: number;
	currentPriceAtEntry: number | null;
	timestamp: string;
	resolved: boolean;
	won: boolean | null;
	pnl: number | null;
	settlePrice: number | null;
}

export interface AccountStatsResult {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}

export interface MarketBreakdown {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}

// ============ Helpers ============

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function tradeRowToEntry(r: TradeRow): TradeEntry {
	return {
		id: r.id,
		marketId: r.market_id,
		windowStartMs: r.window_start_ms,
		side: r.side as Side,
		price: r.price,
		size: r.size,
		priceToBeat: r.price_to_beat,
		currentPriceAtEntry: r.current_price_at_entry,
		timestamp: r.timestamp,
		resolved: Boolean(r.resolved),
		won: r.won === null ? null : Boolean(r.won),
		pnl: r.pnl,
		settlePrice: r.settle_price,
	};
}

// ============ AccountStatsManager ============

export class AccountStatsManager {
	private mode: AccountMode;
	private state: PersistedAccountState;
	private dailyCountedTradeIdSet = new Set<string>();
	private log: ReturnType<typeof createLogger>;
	private initialBalanceDefault: number;
	private loadedFromSqlite = false;

	constructor(mode: AccountMode, initialBalance: number) {
		this.mode = mode;
		this.initialBalanceDefault = initialBalance;
		this.log = createLogger(`${mode}Stats`);
		this.state = this.createEmptyState(initialBalance);
	}

	private createEmptyState(initialBalance: number): PersistedAccountState {
		return {
			trades: [],
			wins: 0,
			losses: 0,
			totalPnl: 0,
			initialBalance,
			currentBalance: initialBalance,
			maxDrawdown: 0,
			dailyPnl: [],
			dailyCountedTradeIds: [],
			stoppedAt: null,
			stopReason: null,
		};
	}

	// ---- DB statement selectors ----

	private getStateStmt() {
		return this.mode === "paper" ? statements.getPaperState() : statements.getLiveState();
	}

	private upsertStateStmt() {
		return this.mode === "paper" ? statements.upsertPaperState() : statements.upsertLiveState();
	}

	private insertTradeStmt() {
		return this.mode === "paper" ? statements.insertPaperTrade() : statements.insertLiveTrade();
	}

	private getAllTradesStmt() {
		return this.mode === "paper" ? statements.getAllPaperTrades() : statements.getAllLiveTrades();
	}

	private getRiskConfig(): RiskConfig {
		return this.mode === "paper" ? CONFIG.paperRisk : CONFIG.liveRisk;
	}

	private getStatsPath(): string {
		return this.mode === "paper" ? "./logs/paper-stats.json" : "./logs/live-stats.json";
	}

	// ---- Initialization ----

	init(): void {
		if (PERSIST_BACKEND === "sqlite" || PERSIST_BACKEND === "dual") {
			try {
				const row = this.getStateStmt().get() as StateRow | null;
				const tradeRows = this.getAllTradesStmt().all() as TradeRow[];
				const trades = tradeRows.map(tradeRowToEntry);

				if (row) {
					this.state = {
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
					this.loadedFromSqlite = true;
				} else if (trades.length > 0) {
					// Recovery: state row missing but trades exist — reconstruct
					let wins = 0;
					let losses = 0;
					let totalPnl = 0;
					let currentBalance = this.initialBalanceDefault;
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
						const drawdown = this.initialBalanceDefault - currentBalance;
						if (drawdown > maxDrawdown) maxDrawdown = drawdown;
					}

					this.state = {
						trades,
						wins,
						losses,
						totalPnl,
						initialBalance: this.initialBalanceDefault,
						currentBalance,
						maxDrawdown,
						dailyPnl: [],
						dailyCountedTradeIds: [],
						stoppedAt: null,
						stopReason: null,
					};
					this.saveState();
					this.loadedFromSqlite = true;
				}
			} catch (err) {
				this.log.warn(`Failed to load ${this.mode} state from SQLite:`, err);
			}
		}

		// Fallback: load from JSON (csv mode, or first migration from JSON → SQLite)
		if (!this.loadedFromSqlite) {
			const statsPath = this.getStatsPath();
			try {
				if (fs.existsSync(statsPath)) {
					const raw = fs.readFileSync(statsPath, "utf8");
					const parsed: unknown = JSON.parse(raw);
					if (parsed && typeof parsed === "object") {
						const obj = parsed as Record<string, unknown>;
						this.state = {
							trades: Array.isArray(obj.trades) ? (obj.trades as TradeEntry[]) : [],
							wins: typeof obj.wins === "number" ? obj.wins : 0,
							losses: typeof obj.losses === "number" ? obj.losses : 0,
							totalPnl: typeof obj.totalPnl === "number" ? obj.totalPnl : 0,
							initialBalance: typeof obj.initialBalance === "number" ? obj.initialBalance : this.initialBalanceDefault,
							currentBalance:
								typeof obj.currentBalance === "number"
									? obj.currentBalance
									: this.initialBalanceDefault + (typeof obj.totalPnl === "number" ? obj.totalPnl : 0),
							maxDrawdown: typeof obj.maxDrawdown === "number" ? obj.maxDrawdown : 0,
							dailyPnl: Array.isArray(obj.dailyPnl) ? (obj.dailyPnl as DailyPnl[]) : [],
							dailyCountedTradeIds: Array.isArray(obj.dailyCountedTradeIds)
								? (obj.dailyCountedTradeIds as string[])
								: [],
							stoppedAt: typeof obj.stoppedAt === "string" ? obj.stoppedAt : null,
							stopReason: typeof obj.stopReason === "string" ? obj.stopReason : null,
						};

						// Migrate JSON data into SQLite on first run
						if (PERSIST_BACKEND === "sqlite" || PERSIST_BACKEND === "dual") {
							for (const trade of this.state.trades) {
								this.upsertTrade(trade);
							}
							this.saveState();
						}
					}
				}
			} catch (err) {
				this.log.warn(`Failed to load ${this.mode} state from JSON:`, err);
			}
		}

		// Initialize the Set mirror from persisted array
		this.dailyCountedTradeIdSet = new Set(this.state.dailyCountedTradeIds);
	}

	// ---- Persistence ----

	private saveState(): void {
		this.upsertStateStmt().run({
			$initialBalance: this.state.initialBalance,
			$currentBalance: this.state.currentBalance,
			$maxDrawdown: this.state.maxDrawdown,
			$wins: this.state.wins,
			$losses: this.state.losses,
			$totalPnl: this.state.totalPnl,
			$stoppedAt: this.state.stoppedAt,
			$stopReason: this.state.stopReason,
			$dailyPnl: JSON.stringify(this.state.dailyPnl),
			$dailyCountedTradeIds: JSON.stringify(this.state.dailyCountedTradeIds),
		});
	}

	private save(): void {
		if (PERSIST_BACKEND === "csv" || PERSIST_BACKEND === "dual") {
			fs.mkdirSync("./logs", { recursive: true });
			fs.writeFileSync(this.getStatsPath(), JSON.stringify(this.state, null, 2));
		}

		if (PERSIST_BACKEND === "dual" || PERSIST_BACKEND === "sqlite") {
			this.saveState();

			statements.upsertDailyStats().run({
				$date: new Date().toDateString(),
				$mode: this.mode,
				$pnl: this.state.totalPnl,
				$trades: this.state.trades.length,
				$wins: this.state.wins,
				$losses: this.state.losses,
			});
		}
	}

	private upsertTrade(trade: TradeEntry): void {
		if (PERSIST_BACKEND !== "dual" && PERSIST_BACKEND !== "sqlite") return;

		this.insertTradeStmt().run({
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

	/**
	 * Sync settlement outcome back to the general `trades` log table.
	 * Paper trades match on order_id = trade.id (same value passed to logTrade).
	 * Live trades: the trades table uses the exchange orderId, not our generated id,
	 * so this is a best-effort update — reconciler handles live settlement separately.
	 */
	private syncTradeLog(trade: TradeEntry): void {
		if (PERSIST_BACKEND !== "dual" && PERSIST_BACKEND !== "sqlite") return;
		try {
			statements.updateTradeSettlement().run({
				$orderId: trade.id,
				$mode: this.mode,
				$pnl: trade.pnl,
				$won: trade.won === null ? null : trade.won ? 1 : 0,
				$status: trade.won ? "settled_won" : "settled_lost",
			});
		} catch {
			// Best-effort: trades table row may not exist or orderId may not match
		}
	}

	// ---- Trade Lifecycle ----

	addTrade(entry: Omit<TradeEntry, "id" | "resolved" | "won" | "pnl" | "settlePrice">): string {
		const id = `${this.mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const trade: TradeEntry = {
			...entry,
			id,
			resolved: false,
			won: null,
			pnl: null,
			settlePrice: null,
		};
		this.state.trades.push(trade);
		this.state.currentBalance -= entry.size;
		try {
			this.upsertTrade(trade);
			this.save();
		} catch (err) {
			// Rollback in-memory state on DB write failure
			this.state.trades.pop();
			this.state.currentBalance += entry.size;
			throw err;
		}
		return id;
	}

	resolveTrades(windowStartMs: number, finalPrices: Map<string, number>): number {
		let resolved = 0;
		for (const trade of this.state.trades) {
			if (trade.resolved) continue;
			if (trade.windowStartMs !== windowStartMs) continue;

			const finalPrice = finalPrices.get(trade.marketId);
			if (finalPrice === undefined || trade.priceToBeat <= 0) continue;

			// Unified settlement rule: price <= PTB → DOWN wins (standard Polymarket rule)
			const upWon = finalPrice > trade.priceToBeat;
			const downWon = finalPrice <= trade.priceToBeat;
			trade.won = trade.side === "UP" ? upWon : downWon;

			trade.settlePrice = finalPrice;
			trade.resolved = true;

			if (trade.won) {
				trade.pnl = trade.size * (1 - trade.price);
				this.state.wins++;
			} else {
				trade.pnl = -(trade.size * trade.price);
				this.state.losses++;
			}

			this.state.currentBalance += trade.size + trade.pnl;
			const drawdown = this.state.initialBalance - this.state.currentBalance;
			if (drawdown > this.state.maxDrawdown) this.state.maxDrawdown = drawdown;
			this.state.totalPnl += trade.pnl;

			// Update daily PnL tracking (with deduplication)
			this.updateDailyPnl(trade.id, trade.pnl);

			this.upsertTrade(trade);
			this.syncTradeLog(trade);
			resolved++;
		}

		if (resolved > 0) {
			this.checkAndTriggerStopLoss();
			this.save();
		}
		return resolved;
	}

	// ---- Queries ----

	getStats(): AccountStatsResult {
		const pending = this.state.trades.filter((t) => !t.resolved).length;
		const total = this.state.wins + this.state.losses;
		return {
			totalTrades: this.state.trades.length,
			wins: this.state.wins,
			losses: this.state.losses,
			pending,
			winRate: total > 0 ? this.state.wins / total : 0,
			totalPnl: this.state.totalPnl,
		};
	}

	getBalance(): { initial: number; current: number; maxDrawdown: number } {
		return {
			initial: this.state.initialBalance,
			current: this.state.currentBalance,
			maxDrawdown: this.state.maxDrawdown,
		};
	}

	canAffordTrade(size: number): boolean {
		return this.state.currentBalance >= size;
	}

	canAffordTradeWithStopCheck(size: number): { canTrade: boolean; reason: string | null } {
		const stopCheck = this.checkAndTriggerStopLoss();
		if (stopCheck.triggered) {
			return { canTrade: false, reason: `trading_stopped:${stopCheck.reason}` };
		}
		if (this.state.currentBalance < size) {
			return { canTrade: false, reason: "insufficient_balance" };
		}
		if (this.isDailyLossLimitExceeded()) {
			return { canTrade: false, reason: "daily_loss_limit_exceeded" };
		}
		return { canTrade: true, reason: null };
	}

	getPendingTrades(): TradeEntry[] {
		return this.state.trades.filter((t) => !t.resolved);
	}

	getRecentTrades(limit?: number): TradeEntry[] {
		if (limit === undefined) return [...this.state.trades];
		return this.state.trades.slice(-limit);
	}

	getMarketBreakdown(): Record<string, MarketBreakdown> {
		const breakdown: Record<string, MarketBreakdown> = {};
		const markets = ["BTC", "ETH", "SOL", "XRP"];

		for (const market of markets) {
			const trades = this.state.trades.filter((t) => t.marketId === market);
			const resolvedTrades = trades.filter((t) => t.resolved);
			const wins = resolvedTrades.filter((t) => t.won).length;
			const losses = resolvedTrades.filter((t) => !t.won).length;
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

	// ---- Stop Loss & Daily Tracking ----

	private getTodayDate(): string {
		return new Date().toISOString().split("T")[0] ?? "";
	}

	private getTodayPnlEntry(): DailyPnl {
		const today = this.getTodayDate();
		let todayData = this.state.dailyPnl.find((d) => d.date === today);
		if (!todayData) {
			todayData = { date: today, pnl: 0, trades: 0 };
			this.state.dailyPnl.push(todayData);
			if (this.state.dailyPnl.length > 30) {
				this.state.dailyPnl = this.state.dailyPnl.slice(-30);
			}
		}
		return todayData;
	}

	getDailyPnl(): { date: string; pnl: number; trades: number }[] {
		return [...this.state.dailyPnl].sort((a, b) => b.date.localeCompare(a.date));
	}

	getTodayStats(): { pnl: number; trades: number; limit: number } {
		const today = this.getTodayPnlEntry();
		return {
			pnl: today.pnl,
			trades: today.trades,
			limit: this.getRiskConfig().dailyMaxLossUsdc,
		};
	}

	isDailyLossLimitExceeded(): boolean {
		const today = this.getTodayPnlEntry();
		const limit = this.getRiskConfig().dailyMaxLossUsdc;
		return today.pnl < -limit;
	}

	isStopped(): boolean {
		return this.state.stoppedAt !== null;
	}

	getStopReason(): { stoppedAt: string | null; reason: string | null } {
		return {
			stoppedAt: this.state.stoppedAt,
			reason: this.state.stopReason,
		};
	}

	checkAndTriggerStopLoss(): { triggered: boolean; reason: string | null } {
		if (this.state.stoppedAt) {
			return { triggered: true, reason: this.state.stopReason };
		}

		// Check daily loss limit
		if (this.isDailyLossLimitExceeded()) {
			this.state.stoppedAt = new Date().toISOString();
			this.state.stopReason = `daily_loss_limit:${(-this.getTodayPnlEntry().pnl).toFixed(2)}`;
			this.save();
			return { triggered: true, reason: this.state.stopReason };
		}

		// Check max drawdown (50% of initial balance)
		const maxAllowedDrawdown = this.state.initialBalance * 0.5;
		if (this.state.maxDrawdown >= maxAllowedDrawdown) {
			this.state.stoppedAt = new Date().toISOString();
			this.state.stopReason = `max_drawdown:${this.state.maxDrawdown.toFixed(2)}`;
			this.save();
			return { triggered: true, reason: this.state.stopReason };
		}

		return { triggered: false, reason: null };
	}

	clearStopFlag(): void {
		this.state.stoppedAt = null;
		this.state.stopReason = null;
		this.save();
	}

	private updateDailyPnl(tradeId: string, pnl: number): void {
		if (this.dailyCountedTradeIdSet.has(tradeId)) {
			return;
		}

		const today = this.getTodayPnlEntry();
		today.pnl += pnl;
		today.trades += 1;
		this.state.dailyCountedTradeIds.push(tradeId);
		this.dailyCountedTradeIdSet.add(tradeId);

		if (this.state.dailyCountedTradeIds.length > 500) {
			this.state.dailyCountedTradeIds = this.state.dailyCountedTradeIds.slice(-500);
			this.dailyCountedTradeIdSet = new Set(this.state.dailyCountedTradeIds);
		}
	}

	// ---- Reset ----

	resetData(): void {
		this.log.info(`Resetting all ${this.mode} trading data`);
		if (this.mode === "paper") {
			resetPaperDbData();
		} else {
			resetLiveDbData();
		}
		this.state = this.createEmptyState(this.initialBalanceDefault);
		this.dailyCountedTradeIdSet = new Set();
		this.log.info(`${this.mode} trading data reset complete`);
	}

	resetBalance(initialBalance?: number): void {
		this.state.initialBalance = initialBalance ?? this.initialBalanceDefault;
		this.state.currentBalance = this.state.initialBalance;
		this.state.maxDrawdown = 0;
		this.save();
	}
}

// ============ Singleton Instances ============

export const paperAccount = new AccountStatsManager("paper", PAPER_INITIAL_BALANCE);
export const liveAccount = new AccountStatsManager("live", LIVE_INITIAL_BALANCE);

export function initAccountStats(): void {
	paperAccount.init();
	liveAccount.init();
}

// Helper to get account by mode
export function getAccount(mode: AccountMode): AccountStatsManager {
	return mode === "paper" ? paperAccount : liveAccount;
}
