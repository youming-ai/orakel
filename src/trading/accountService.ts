import { CONFIG } from "../core/config.ts";
import type { RiskConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import {
	createEmptyAccountState,
	loadAccountState,
	persistTradeEntry,
	saveAccountState,
	syncAccountTradeLog,
} from "./accountPersistence.ts";
import type {
	AccountMode,
	AccountStatsResult,
	MarketBreakdown,
	PersistedAccountState,
	TradeEntry,
} from "./accountTypes.ts";

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
		this.log = createLogger(`${mode}Stats`);
		this.state = createEmptyAccountState(initialBalance);
	}

	private getRiskConfig(): RiskConfig {
		return this.mode === "paper" ? CONFIG.paperRisk : CONFIG.liveRisk;
	}

	async init(): Promise<void> {
		try {
			this.state = await loadAccountState(this.mode, this.initialBalanceDefault);
			for (const id of this.state.dailyCountedTradeIds) {
				this.dailyCountedTradeIdSet.add(id);
			}
			this.syncTradeLog();
			this.log.info(`Loaded ${this.state.trades.length} trades, balance=${this.state.currentBalance.toFixed(2)}`);
		} catch (err) {
			this.log.error("Failed to load from database, using defaults:", err);
			this.state = createEmptyAccountState(this.initialBalanceDefault);
		}
	}

	private async save(): Promise<void> {
		try {
			await saveAccountState(this.mode, this.state);
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
		if (this.state.trades.some((trade) => trade.id === id)) {
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
		void persistTradeEntry(this.mode, trade, status)
			.then(() => this.save())
			.catch((err) => {
				this.state.trades.pop();
				this.state.currentBalance += entry.size * entry.price;
				this.log.error(`Failed to persist trade ${id}, rolled back:`, err);
			});
		return id;
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
				void persistTradeEntry(this.mode, trade).catch((err) => {
					this.log.error(`Failed to persist trade ${trade.id}:`, err);
				});
			}
			resolvedCount++;
			this.log.warn(`Force-resolved stuck trade ${trade.id}`);
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
		void persistTradeEntry(this.mode, trade).catch((err) => {
			this.log.error(`Failed to persist trade ${trade.id}:`, err);
		});
		this.syncTradeLog();
	}

	private updateDailyPnl(trade: TradeEntry, pnl: number): void {
		const date = new Date().toDateString();
		const existing = this.state.dailyPnl.find((item) => item.date === date);
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
		const resolved = this.state.trades.filter((trade) => trade.resolved);
		const wins = resolved.filter((trade) => trade.won).length;
		const losses = resolved.filter((trade) => !trade.won).length;
		const total = resolved.length;
		return {
			totalTrades: total,
			wins,
			losses,
			pending: this.state.trades.filter((trade) => !trade.resolved).length,
			winRate: total === 0 ? 0 : wins / total,
			totalPnl: this.state.totalPnl,
		};
	}

	getTodayStats(): { pnl: number; trades: number; limit: number } {
		const date = new Date().toDateString();
		const today = this.state.dailyPnl.find((item) => item.date === date);
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
		return this.state.trades.filter((trade) => !trade.resolved);
	}

	getWonTrades(): TradeEntry[] {
		return this.state.trades.filter((trade) => trade.resolved && trade.won);
	}

	getMarketBreakdown(): Record<string, MarketBreakdown> {
		const marketMap = new Map<string, { wins: number; losses: number; pnl: number }>();
		for (const trade of this.state.trades) {
			if (!trade.resolved) continue;
			const aggregate = marketMap.get(trade.marketId) || { wins: 0, losses: 0, pnl: 0 };
			if (trade.won) aggregate.wins++;
			else aggregate.losses++;
			aggregate.pnl += trade.pnl ?? 0;
			marketMap.set(trade.marketId, aggregate);
		}

		const result: Record<string, MarketBreakdown> = {};
		for (const [market, aggregate] of marketMap) {
			const total = aggregate.wins + aggregate.losses;
			result[market] = {
				wins: aggregate.wins,
				losses: aggregate.losses,
				pending: 0,
				winRate: total === 0 ? 0 : aggregate.wins / total,
				totalPnl: aggregate.pnl,
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
				reason: `insufficient_balance_${effectiveBalance.toFixed(2)}_<_${maxCost.toFixed(2)}`,
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
		this.log.warn(`Stop loss triggered: ${reason}`);
		void this.save();
	}

	clearStopFlag(): void {
		this.state.stoppedAt = null;
		this.state.stopReason = null;
		void this.save();
	}

	resetData(): void {
		this.state = createEmptyAccountState(this.initialBalanceDefault);
		this.dailyCountedTradeIdSet.clear();
		this.reservedBalance = 0;
		void this.save();
		this.syncTradeLog();
		this.log.info("Data reset");
	}

	pruneTrades(maxCount: number): void {
		if (this.state.trades.length <= maxCount) return;
		this.state.trades = this.state.trades.slice(-maxCount);
		void this.save();
	}

	private syncTradeLog(): void {
		try {
			syncAccountTradeLog(this.mode, this.state);
		} catch (err) {
			this.log.warn("syncTradeLog failed:", err);
		}
	}
}
