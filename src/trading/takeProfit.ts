/**
 * Take-profit monitor for binary option positions.
 * Checks if the Polymarket token price has risen above entry + threshold,
 * and triggers early exit to lock in gains.
 */

import { createLogger } from "../core/logger.ts";
import type { TradeEntry } from "./accountTypes.ts";

const log = createLogger("take-profit");

export interface TakeProfitConfig {
	/** Gain percentage to trigger take-profit (0.15 = 15% gain on token price) */
	takeProfitPercent: number;
	/** Check interval (ms) */
	checkIntervalMs: number;
}

export interface TakeProfitResult {
	tradeId: string;
	marketId: string;
	side: "UP" | "DOWN";
	entryPrice: number;
	currentTokenPrice: number;
	gainPercent: number;
	shouldTakeProfit: boolean;
	reason: string;
}

export const DEFAULT_TAKE_PROFIT_CONFIG: TakeProfitConfig = {
	takeProfitPercent: 0.15, // 15% gain
	checkIntervalMs: 5_000, // 5s check interval
};

/**
 * Check a single trade for take-profit conditions.
 * Uses Polymarket token price for the side we hold.
 */
export function checkTradeTakeProfit(
	trade: TradeEntry,
	currentTokenPrice: number,
	config: TakeProfitConfig = DEFAULT_TAKE_PROFIT_CONFIG,
): TakeProfitResult {
	const entryPrice = trade.price;
	const gainPercent = (currentTokenPrice - entryPrice) / entryPrice;

	if (gainPercent >= config.takeProfitPercent) {
		return {
			tradeId: trade.id,
			marketId: trade.marketId,
			side: trade.side,
			entryPrice,
			currentTokenPrice,
			gainPercent,
			shouldTakeProfit: true,
			reason: `take_profit_${(gainPercent * 100).toFixed(1)}%`,
		};
	}

	return {
		tradeId: trade.id,
		marketId: trade.marketId,
		side: trade.side,
		entryPrice,
		currentTokenPrice,
		gainPercent,
		shouldTakeProfit: false,
		reason: "within_limits",
	};
}

/**
 * Batch check multiple trades for take-profit.
 * Requires marketUp and marketDown prices per marketId.
 */
export function checkTakeProfit(
	trades: TradeEntry[],
	tokenPrices: Map<string, { up: number | null; down: number | null }>,
	config: TakeProfitConfig = DEFAULT_TAKE_PROFIT_CONFIG,
): TakeProfitResult[] {
	const results: TakeProfitResult[] = [];

	for (const trade of trades) {
		if (trade.resolved) continue;

		const prices = tokenPrices.get(trade.marketId);
		if (!prices) continue;

		const currentTokenPrice = trade.side === "UP" ? prices.up : prices.down;
		if (currentTokenPrice === null) continue;

		const result = checkTradeTakeProfit(trade, currentTokenPrice, config);
		if (result.shouldTakeProfit) {
			log.info(
				`Take-profit triggered for ${trade.id}: ${result.reason} ` +
					`(entry=${trade.price.toFixed(4)}, current=${currentTokenPrice.toFixed(4)})`,
			);
		}
		results.push(result);
	}

	return results;
}

/**
 * Take-profit monitor — periodically checks pending trades and triggers early exits.
 */
export class TakeProfitMonitor {
	private config: TakeProfitConfig;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private onTakeProfit: (tradeId: string, sellPrice: number, reason: string) => void;
	private getPendingTrades: () => TradeEntry[];
	private getTokenPrices: () => Map<string, { up: number | null; down: number | null }>;

	constructor(options: {
		config?: Partial<TakeProfitConfig>;
		onTakeProfit: (tradeId: string, sellPrice: number, reason: string) => void;
		getPendingTrades: () => TradeEntry[];
		getTokenPrices: () => Map<string, { up: number | null; down: number | null }>;
	}) {
		this.config = { ...DEFAULT_TAKE_PROFIT_CONFIG, ...options.config };
		this.onTakeProfit = options.onTakeProfit;
		this.getPendingTrades = options.getPendingTrades;
		this.getTokenPrices = options.getTokenPrices;
	}

	start(): void {
		if (this.intervalId) {
			log.warn("Take-profit monitor already running");
			return;
		}

		this.intervalId = setInterval(() => {
			this.check();
		}, this.config.checkIntervalMs);

		log.info(
			`Take-profit monitor started (interval=${this.config.checkIntervalMs}ms, ` +
				`threshold=${(this.config.takeProfitPercent * 100).toFixed(1)}%)`,
		);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
			log.info("Take-profit monitor stopped");
		}
	}

	private check(): void {
		const pendingTrades = this.getPendingTrades();
		if (pendingTrades.length === 0) return;

		const tokenPrices = this.getTokenPrices();
		const results = checkTakeProfit(pendingTrades, tokenPrices, this.config);

		for (const result of results) {
			if (result.shouldTakeProfit) {
				this.onTakeProfit(result.tradeId, result.currentTokenPrice, result.reason);
			}
		}
	}

	updateConfig(config: Partial<TakeProfitConfig>): void {
		this.config = { ...this.config, ...config };
		log.info(`Take-profit config updated: threshold=${(this.config.takeProfitPercent * 100).toFixed(1)}%`);
	}
}
