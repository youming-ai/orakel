import fs from "node:fs";
import { CONFIG, LIVE_INITIAL_BALANCE, PAPER_INITIAL_BALANCE } from "../core/config.ts";
import { createLogger } from "../core/logger.ts";
import * as queries from "../db/queries.ts";
import type { AccountMode, RiskConfig, Side } from "../types.ts";

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

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export class AccountStatsManager {
	private mode: AccountMode;
	private state: PersistedAccountState;
	private dailyCountedTradeIdSet = new Set<string>();
	private log: ReturnType<typeof createLogger>;
	private initialBalanceDefault: number;
	private reservedBalance = 0;

	constructor(mode: AccountMode, initialBalance: number) {
		this.mode = mode;
		this.initialBalanceDefault = initialBalance;
		this.log = createLogger(`\${mode}Stats`);
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

	private getRiskConfig(): RiskConfig {
		return this.mode === "paper" ? CONFIG.paperRisk : CONFIG.liveRisk;
	}

	private getStatsPath(): string {
		return this.mode === "paper" ? "./logs/paper-stats.json" : "./logs/live-stats.json";
	}

	async init(): Promise<void> {
		try {
			const stateRow =
				this.mode === "paper" ? await queries.stateQueries.getPaperState() : await queries.stateQueries.getLiveState();
			const tradeRows = await queries.unifiedTradeQueries.getAllByMode(this.mode);

			if (stateRow) {
				this.state = {
					trades: tradeRows.map((r) => ({
						id: r.tradeId ?? `legacy-${r.id}`,
						marketId: r.market,
						windowStartMs: r.windowStartMs ?? 0,
						side: r.side as Side,
						price: r.price,
						size: r.amount,
						priceToBeat: r.priceToBeat ?? 0,
						currentPriceAtEntry: r.currentPriceAtEntry,
						timestamp: r.timestamp,
						resolved: Boolean(r.resolved),
						won: r.won === null ? null : Boolean(r.won),
						pnl: r.pnl,
						settlePrice: r.settlePrice,
					})),
					wins: stateRow.wins,
					losses: stateRow.losses,
					totalPnl: stateRow.totalPnl,
					initialBalance: stateRow.initialBalance,
					currentBalance: stateRow.currentBalance,
					maxDrawdown: stateRow.maxDrawdown,
					dailyPnl: safeParseJson(stateRow.dailyPnl, []),
					dailyCountedTradeIds: safeParseJson(stateRow.dailyCountedTradeIds, []),
					stoppedAt: stateRow.stoppedAt,
					stopReason: stateRow.stopReason,
				};
			}

			for (const id of this.state.dailyCountedTradeIds) {
				this.dailyCountedTradeIdSet.add(id);
			}

			this.syncTradeLog();
			this.log.info(`Loaded \${this.state.trades.length} trades, balance=\${this.state.currentBalance.toFixed(2)}`);
		} catch (err) {
			this.log.error("Failed to load from database, using defaults:", err);
			this.state = this.createEmptyState(this.initialBalanceDefault);
		}
	}

	private async save(): Promise<void> {
		try {
			if (this.mode === "paper") {
				await queries.stateQueries.upsertPaperState({
					id: 1,
					initialBalance: this.state.initialBalance,
					currentBalance: this.state.currentBalance,
					maxDrawdown: this.state.maxDrawdown,
					wins: this.state.wins,
					losses: this.state.losses,
					totalPnl: this.state.totalPnl,
					stoppedAt: this.state.stoppedAt,
					stopReason: this.state.stopReason,
					dailyPnl: JSON.stringify(this.state.dailyPnl),
					dailyCountedTradeIds: JSON.stringify(this.state.dailyCountedTradeIds),
				});
			} else {
				await queries.stateQueries.upsertLiveState({
					id: 1,
					initialBalance: this.state.initialBalance,
					currentBalance: this.state.currentBalance,
					maxDrawdown: this.state.maxDrawdown,
					wins: this.state.wins,
					losses: this.state.losses,
					totalPnl: this.state.totalPnl,
					stoppedAt: this.state.stoppedAt,
					stopReason: this.state.stopReason,
					dailyPnl: JSON.stringify(this.state.dailyPnl),
					dailyCountedTradeIds: JSON.stringify(this.state.dailyCountedTradeIds),
				});
			}
		} catch (err) {
			this.log.error("Failed to save state:", err);
		}
	}

	addTrade(
		entry: Omit<TradeEntry, "id" | "resolved" | "won" | "pnl" | "settlePrice">,
		exchangeOrderId?: string,
		status?: string,
	): string {
		const id = exchangeOrderId ?? `${this.mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		if (this.state.trades.some((t) => t.id === id)) {
			this.log.warn(`Duplicate trade id ignored: ${id}`);
			return id;
		}
		const trade: TradeEntry = {
			...entry,
			id,
			resolved: false,
			won: null,
			pnl: null,
			settlePrice: null,
		};
		this.state.trades.push(trade);
		this.state.currentBalance -= entry.size * entry.price;
		this.syncTradeLog();
		void this.persistTrade(trade, status)
			.then(() => this.save())
			.catch((err) => {
				this.state.trades.pop();
				this.state.currentBalance += entry.size * entry.price;
				this.log.error(`Failed to persist trade ${id}, rolled back:`, err);
			});
		return id;
	}

	private async persistTrade(entry: TradeEntry, status?: string): Promise<void> {
		try {
			await queries.unifiedTradeQueries.upsert({
				tradeId: entry.id,
				timestamp: entry.timestamp,
				market: entry.marketId,
				side: entry.side,
				amount: entry.size,
				price: entry.price,
				orderId: entry.id,
				status: status ?? (entry.resolved ? (entry.won ? "won" : "lost") : "open"),
				mode: this.mode,
				windowStartMs: entry.windowStartMs,
				priceToBeat: entry.priceToBeat,
				currentPriceAtEntry: entry.currentPriceAtEntry,
				resolved: entry.resolved ? 1 : 0,
				won: entry.won === null ? null : entry.won ? 1 : 0,
				pnl: entry.pnl,
				settlePrice: entry.settlePrice,
			});
		} catch (err) {
			this.log.error(`Failed to persist trade \${entry.id}:`, err);
		}
	}

	async resolveTrades(windowStartMs: number, latestPrices: Map<string, number>, marketId?: string): Promise<number> {
		let resolvedCount = 0;
		for (const trade of this.state.trades) {
			if (trade.resolved || trade.windowStartMs !== windowStartMs) continue;
			if (marketId && trade.marketId !== marketId) continue;
			const settlePrice = latestPrices.get(trade.marketId);
			if (settlePrice === undefined) continue;
			this.resolveSingle(trade, settlePrice);
			resolvedCount++;
		}
		if (resolvedCount > 0) {
			await this.save();
		}
		return resolvedCount;
	}

	async resolveExpiredTrades(
		latestPrices: Map<string, number>,
		candleWindowMinutes: number,
		marketId?: string,
	): Promise<number> {
		const now = Date.now();
		const windowMs = candleWindowMinutes * 60 * 1000;
		let resolvedCount = 0;
		for (const trade of this.state.trades) {
			if (trade.resolved) continue;
			if (marketId && trade.marketId !== marketId) continue;
			const elapsed = now - trade.windowStartMs;
			if (elapsed < windowMs * 1.5) continue;
			const settlePrice = latestPrices.get(trade.marketId);
			if (settlePrice === undefined) continue;
			this.resolveSingle(trade, settlePrice);
			resolvedCount++;
		}
		if (resolvedCount > 0) {
			await this.save();
		}
		return resolvedCount;
	}

	async forceResolveStuckTrades(maxAgeMs: number, latestPrices?: Map<string, number>): Promise<number> {
		const cutoff = Date.now() - maxAgeMs;
		let resolvedCount = 0;
		for (const trade of this.state.trades) {
			if (trade.resolved) continue;
			if (trade.windowStartMs > cutoff) continue;

			const settlePrice = latestPrices?.get(trade.marketId);
			if (settlePrice !== undefined) {
				this.resolveSingle(trade, settlePrice);
			} else {
				trade.resolved = true;
				trade.won = false;
				trade.pnl = -trade.price * trade.size;
				trade.settlePrice = 0.5;
				this.state.currentBalance += trade.size * trade.price + trade.pnl;
				if (trade.pnl > 0) this.state.wins++;
				else this.state.losses++;
				this.state.totalPnl += trade.pnl;
				this.updateDailyPnl(trade, trade.pnl);
				this.persistTrade(trade);
			}
			resolvedCount++;
			this.log.warn(`Force-resolved stuck trade \${trade.id}`);
		}
		if (resolvedCount > 0) {
			this.syncTradeLog();
			await this.save();
		}
		return resolvedCount;
	}

	private resolveSingle(trade: TradeEntry, settlePrice: number): void {
		const won = trade.side === "UP" ? settlePrice > trade.priceToBeat : settlePrice <= trade.priceToBeat;
		const pnl = won ? trade.size * (1 - trade.price) : -trade.size * trade.price;
		trade.resolved = true;
		trade.won = won;
		trade.pnl = pnl;
		trade.settlePrice = settlePrice;
		this.state.currentBalance += trade.size * trade.price + pnl;
		this.state.totalPnl += pnl;
		if (won) this.state.wins++;
		else this.state.losses++;
		const drawdown = this.state.initialBalance - this.state.currentBalance;
		if (drawdown > this.state.maxDrawdown) this.state.maxDrawdown = drawdown;
		this.updateDailyPnl(trade, pnl);
		this.persistTrade(trade);
		this.syncTradeLog();
	}

	private updateDailyPnl(trade: TradeEntry, pnl: number): void {
		const date = new Date().toDateString();
		const existing = this.state.dailyPnl.find((d) => d.date === date);
		if (existing) {
			existing.pnl += pnl;
			existing.trades++;
		} else {
			this.state.dailyPnl.push({ date, pnl, trades: 1 });
		}
		if (!this.dailyCountedTradeIdSet.has(trade.id)) {
			this.dailyCountedTradeIdSet.add(trade.id);
			this.state.dailyCountedTradeIds.push(trade.id);
		}
	}

	getBalance(): { initial: number; current: number; maxDrawdown: number; reserved: number } {
		return {
			initial: this.state.initialBalance,
			current: this.state.currentBalance,
			maxDrawdown: this.state.maxDrawdown,
			reserved: this.reservedBalance,
		};
	}

	reserveBalance(amount: number): void {
		this.reservedBalance += amount;
	}

	unreserveBalance(amount: number): void {
		this.reservedBalance = Math.max(0, this.reservedBalance - amount);
	}

	getStats(): AccountStatsResult {
		const resolved = this.state.trades.filter((t) => t.resolved);
		const wins = resolved.filter((t) => t.won).length;
		const losses = resolved.filter((t) => !t.won).length;
		const total = resolved.length;
		return {
			totalTrades: total,
			wins,
			losses,
			pending: this.state.trades.filter((t) => !t.resolved).length,
			winRate: total === 0 ? 0 : wins / total,
			totalPnl: this.state.totalPnl,
		};
	}

	getTodayStats(): { pnl: number; trades: number; limit: number } {
		const date = new Date().toDateString();
		const today = this.state.dailyPnl.find((d) => d.date === date);
		return {
			pnl: today?.pnl ?? 0,
			trades: today?.trades ?? 0,
			limit: this.getRiskConfig().dailyMaxLossUsdc,
		};
	}

	getRecentTrades(limit = 20): TradeEntry[] {
		return this.state.trades.slice(-limit).reverse();
	}

	getPendingTrades(): TradeEntry[] {
		return this.state.trades.filter((t) => !t.resolved);
	}

	getWonTrades(): TradeEntry[] {
		return this.state.trades.filter((t) => t.resolved && t.won);
	}

	getMarketBreakdown(): Record<string, MarketBreakdown> {
		const map = new Map<string, { wins: number; losses: number; pnl: number }>();
		for (const trade of this.state.trades) {
			if (!trade.resolved) continue;
			const agg = map.get(trade.marketId) || { wins: 0, losses: 0, pnl: 0 };
			if (trade.won) agg.wins++;
			else agg.losses++;
			agg.pnl += trade.pnl ?? 0;
			map.set(trade.marketId, agg);
		}
		const result: Record<string, MarketBreakdown> = {};
		for (const [market, agg] of map) {
			const total = agg.wins + agg.losses;
			result[market] = {
				wins: agg.wins,
				losses: agg.losses,
				pending: 0,
				winRate: total === 0 ? 0 : agg.wins / total,
				totalPnl: agg.pnl,
				tradeCount: total,
			};
		}
		return result;
	}

	canAffordTradeWithStopCheck(size: number): { canTrade: boolean; reason?: string } {
		const risk = this.getRiskConfig();
		const effectiveBalance = this.state.currentBalance - this.reservedBalance;
		const maxCost = size * 0.6;
		if (effectiveBalance < maxCost) {
			return {
				canTrade: false,
				reason: `insufficient_balance_\${effectiveBalance.toFixed(2)}_<_\${maxCost.toFixed(2)}`,
			};
		}
		if (this.isStopped()) {
			return { canTrade: false, reason: "stop_loss_triggered" };
		}
		if (risk.dailyMaxLossUsdc > 0) {
			const today = this.getTodayStats();
			if (today.pnl <= -risk.dailyMaxLossUsdc) {
				return { canTrade: false, reason: "daily_max_loss_reached" };
			}
		}
		return { canTrade: true };
	}

	isStopped(): boolean {
		return !!this.state.stoppedAt;
	}

	getStopReason(): { stoppedAt: string | null; reason: string | null } {
		return { stoppedAt: this.state.stoppedAt, reason: this.state.stopReason };
	}

	triggerStopLoss(reason: string): void {
		if (this.state.stoppedAt) return;
		this.state.stoppedAt = new Date().toISOString();
		this.state.stopReason = reason;
		this.log.warn(`Stop loss triggered: \${reason}`);
		this.save();
	}

	clearStopFlag(): void {
		this.state.stoppedAt = null;
		this.state.stopReason = null;
		this.save();
	}

	resetData(): void {
		this.state = this.createEmptyState(this.initialBalanceDefault);
		this.dailyCountedTradeIdSet.clear();
		this.reservedBalance = 0;
		this.save();
		this.syncTradeLog();
		this.log.info("Data reset");
	}

	pruneTrades(maxCount: number): void {
		if (this.state.trades.length <= maxCount) return;
		this.state.trades = this.state.trades.slice(-maxCount);
		this.save();
	}

	private syncTradeLog(): void {
		const path = this.getStatsPath();
		try {
			fs.mkdirSync("./logs", { recursive: true });
			fs.writeFileSync(path, JSON.stringify(this.state, null, 2));
		} catch (err) {
			this.log.warn(`syncTradeLog failed for \${path}:`, err);
		}
	}
}

export const paperAccount = new AccountStatsManager("paper", PAPER_INITIAL_BALANCE);
export const liveAccount = new AccountStatsManager("live", LIVE_INITIAL_BALANCE);

export async function initAccountStats(): Promise<void> {
	await paperAccount.init();
	await liveAccount.init();
}

export function getAccount(mode: AccountMode): AccountStatsManager {
	return mode === "paper" ? paperAccount : liveAccount;
}
