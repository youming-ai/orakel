import { CONFIG } from "../core/config.ts";
import type { RiskConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import { dailyStatsQueries } from "../db/queries.ts";
import {
	createEmptyAccountState,
	loadAccountState,
	persistTradeEntry,
	saveAccountState,
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
	private log: ReturnType<typeof createLogger>;
	private todayCache = { date: "", pnl: 0, trades: 0 };

	constructor(mode: AccountMode) {
		this.mode = mode;
		this.log = createLogger(`${mode}Stats`);
		this.state = createEmptyAccountState();
	}

	private getRiskConfig(): RiskConfig {
		return this.mode === "paper" ? CONFIG.paperRisk : CONFIG.liveRisk;
	}

	async init(): Promise<void> {
		try {
			this.state = await loadAccountState(this.mode);
			const todayRow = await dailyStatsQueries.getToday(this.mode);
			if (todayRow) {
				this.todayCache = {
					date: todayRow.date,
					pnl: todayRow.pnl,
					trades: todayRow.trades,
				};
			}
			this.log.info(`Loaded ${this.state.trades.length} trades, pnl=${this.state.totalPnl.toFixed(2)}`);
		} catch (err) {
			this.log.error("Failed to load from database, using defaults:", err);
			this.state = createEmptyAccountState();
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
		void persistTradeEntry(this.mode, trade, status)
			.then(() => this.save())
			.catch((err) => {
				this.state.trades.pop();
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
				if (trade.pnl > 0) this.state.wins++;
				else this.state.losses++;
				this.state.totalPnl += trade.pnl;
				this.persistDailyPnl(trade.pnl, trade.won);
				void persistTradeEntry(this.mode, trade).catch((err) => {
					this.log.error(`Failed to persist trade ${trade.id}:`, err);
				});
			}
			resolvedCount++;
			this.log.warn(`Force-resolved stuck trade ${trade.id}`);
		}
		if (resolvedCount > 0) {
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
		this.state.totalPnl += pnl;
		if (won) this.state.wins++;
		else this.state.losses++;
		const drawdown = -this.state.totalPnl;
		if (drawdown > this.state.maxDrawdown) this.state.maxDrawdown = drawdown;
		this.persistDailyPnl(pnl, won);
		void persistTradeEntry(this.mode, trade).catch((err) => {
			this.log.error(`Failed to persist trade ${trade.id}:`, err);
		});
	}

	private persistDailyPnl(pnl: number, won: boolean | null): void {
		const date = new Date().toDateString();
		if (this.todayCache.date !== date) {
			this.todayCache = { date, pnl: 0, trades: 0 };
		}
		this.todayCache.pnl += pnl;
		this.todayCache.trades++;

		const winsDelta = won === true ? 1 : 0;
		const lossesDelta = won === false ? 1 : 0;
		void dailyStatsQueries.upsertDaily(this.mode, date, pnl, 1, winsDelta, lossesDelta).catch((err) => {
			this.log.error("Failed to persist daily stats:", err);
		});
	}

	getMaxDrawdown(): number {
		return this.state.maxDrawdown;
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
		if (this.todayCache.date !== date) {
			this.todayCache = { date, pnl: 0, trades: 0 };
		}
		return {
			pnl: this.todayCache.pnl,
			trades: this.todayCache.trades,
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

	/**
	 * Resolve a specific trade by ID as a loss (used by stop-loss).
	 * Returns true if the trade was found and resolved, false otherwise.
	 */
	resolveTradeAsLoss(tradeId: string, reason: string): boolean {
		const trade = this.state.trades.find((t) => t.id === tradeId && !t.resolved);
		if (!trade) return false;

		const pnl = -trade.size * trade.price;
		trade.resolved = true;
		trade.won = false;
		trade.pnl = pnl;
		trade.settlePrice = null;
		this.state.totalPnl += pnl;
		this.state.losses++;
		const drawdown = -this.state.totalPnl;
		if (drawdown > this.state.maxDrawdown) this.state.maxDrawdown = drawdown;
		this.persistDailyPnl(pnl, false);
		void persistTradeEntry(this.mode, trade).catch((err) => {
			this.log.error(`Failed to persist stop-loss trade ${trade.id}:`, err);
		});
		this.log.warn(`Trade ${tradeId} resolved as loss by stop-loss: ${reason} (pnl=${pnl.toFixed(2)})`);
		void this.save();
		return true;
	}

	/**
	 * Resolve a specific trade by ID as an early win (used by take-profit).
	 * PnL = size * (sellPrice - entryPrice) instead of the full binary payout.
	 */
	resolveTradeAsEarlyWin(tradeId: string, sellPrice: number, reason: string): boolean {
		const trade = this.state.trades.find((t) => t.id === tradeId && !t.resolved);
		if (!trade) return false;

		const pnl = trade.size * (sellPrice - trade.price);
		trade.resolved = true;
		trade.won = true;
		trade.pnl = pnl;
		trade.settlePrice = null;
		this.state.totalPnl += pnl;
		this.state.wins++;
		const drawdown = -this.state.totalPnl;
		if (drawdown > this.state.maxDrawdown) this.state.maxDrawdown = drawdown;
		this.persistDailyPnl(pnl, true);
		void persistTradeEntry(this.mode, trade).catch((err) => {
			this.log.error(`Failed to persist take-profit trade ${trade.id}:`, err);
		});
		this.log.info(`Trade ${tradeId} take-profit at ${sellPrice.toFixed(4)}: ${reason} (pnl=${pnl.toFixed(2)})`);
		void this.save();
		return true;
	}

	canTradeWithStopCheck(): { canTrade: boolean; reason?: string } {
		if (this.isStopped()) {
			return { canTrade: false, reason: "stop_loss_triggered" };
		}
		const risk = this.getRiskConfig();
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
		this.state = createEmptyAccountState();
		this.todayCache = { date: "", pnl: 0, trades: 0 };
		void this.save();
		this.log.info("Data reset");
	}

	pruneTrades(maxCount: number): void {
		if (this.state.trades.length <= maxCount) return;
		this.state.trades = this.state.trades.slice(-maxCount);
		void this.save();
	}
}
