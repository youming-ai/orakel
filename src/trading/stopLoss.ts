/**
 * 止损监控模块
 * 监控未结算交易，当价格超过止损阈值时触发止损
 */

import { createLogger } from "../core/logger.ts";
import type { TradeEntry } from "./accountTypes.ts";

const log = createLogger("stop-loss");

export interface StopLossConfig {
	/** 止损百分比 (0.03 = 3%) */
	stopLossPercent: number;
	/** 检查间隔 (ms) */
	checkIntervalMs: number;
	/** 最大持仓时间 (ms)，超时强制止损 */
	maxHoldingTimeMs?: number;
}

export interface StopLossResult {
	tradeId: string;
	marketId: string;
	side: "UP" | "DOWN";
	entryPrice: number;
	currentPrice: number;
	lossPercent: number;
	shouldStop: boolean;
	reason: string;
}

export const DEFAULT_STOP_LOSS_CONFIG: StopLossConfig = {
	stopLossPercent: 0.03, // 3% 止损
	checkIntervalMs: 10_000, // 10秒检查一次
	maxHoldingTimeMs: 15 * 60 * 1000, // 15分钟最大持仓
};

/**
 * 检查单个交易的止损条件
 */
export function checkTradeStopLoss(
	trade: TradeEntry,
	currentPrice: number,
	config: StopLossConfig = DEFAULT_STOP_LOSS_CONFIG,
): StopLossResult {
	const entryPrice = trade.price;
	const lossPercent =
		trade.side === "UP" ? (entryPrice - currentPrice) / entryPrice : (currentPrice - entryPrice) / (1 - entryPrice);

	// 检查价格止损
	if (lossPercent >= config.stopLossPercent) {
		return {
			tradeId: trade.id,
			marketId: trade.marketId,
			side: trade.side,
			entryPrice,
			currentPrice,
			lossPercent,
			shouldStop: true,
			reason: `stop_loss_${(lossPercent * 100).toFixed(1)}%`,
		};
	}

	// 检查持仓时间
	if (config.maxHoldingTimeMs) {
		const holdingTime = Date.now() - trade.windowStartMs;
		if (holdingTime >= config.maxHoldingTimeMs) {
			return {
				tradeId: trade.id,
				marketId: trade.marketId,
				side: trade.side,
				entryPrice,
				currentPrice,
				lossPercent,
				shouldStop: true,
				reason: `max_holding_time_${Math.round(holdingTime / 60000)}min`,
			};
		}
	}

	return {
		tradeId: trade.id,
		marketId: trade.marketId,
		side: trade.side,
		entryPrice,
		currentPrice,
		lossPercent,
		shouldStop: false,
		reason: "within_limits",
	};
}

/**
 * 批量检查多个交易的止损条件
 */
export function checkStopLoss(
	trades: TradeEntry[],
	currentPrices: Map<string, number>,
	config: StopLossConfig = DEFAULT_STOP_LOSS_CONFIG,
): StopLossResult[] {
	const results: StopLossResult[] = [];

	for (const trade of trades) {
		if (trade.resolved) continue;

		const currentPrice = currentPrices.get(trade.marketId);
		if (currentPrice === undefined) {
			log.warn(`No current price for ${trade.marketId}, skipping stop loss check`);
			continue;
		}

		const result = checkTradeStopLoss(trade, currentPrice, config);
		if (result.shouldStop) {
			log.warn(
				`Stop loss triggered for ${trade.id}: ${result.reason} ` +
					`(entry=${entryPriceToString(trade.price, trade.side)}, current=${currentPrice.toFixed(4)})`,
			);
		}
		results.push(result);
	}

	return results;
}

/**
 * 格式化价格用于日志
 */
function entryPriceToString(price: number, side: "UP" | "DOWN"): string {
	if (side === "UP") {
		return `$${(price * 100).toFixed(0)}c (Yes)`;
	} else {
		return `$${((1 - price) * 100).toFixed(0)}c (No)`;
	}
}

/**
 * 止损监控器类
 * 定期检查未结算交易并触发止损
 */
export class StopLossMonitor {
	private config: StopLossConfig;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private onStopLoss: (tradeId: string, reason: string) => void;
	private getPendingTrades: () => TradeEntry[];
	private getCurrentPrices: () => Map<string, number>;

	constructor(options: {
		config?: Partial<StopLossConfig>;
		onStopLoss: (tradeId: string, reason: string) => void;
		getPendingTrades: () => TradeEntry[];
		getCurrentPrices: () => Map<string, number>;
	}) {
		this.config = { ...DEFAULT_STOP_LOSS_CONFIG, ...options.config };
		this.onStopLoss = options.onStopLoss;
		this.getPendingTrades = options.getPendingTrades;
		this.getCurrentPrices = options.getCurrentPrices;
	}

	start(): void {
		if (this.intervalId) {
			log.warn("Stop loss monitor already running");
			return;
		}

		this.intervalId = setInterval(() => {
			this.check();
		}, this.config.checkIntervalMs);

		log.info(
			`Stop loss monitor started (interval=${this.config.checkIntervalMs}ms, ` +
				`threshold=${(this.config.stopLossPercent * 100).toFixed(1)}%)`,
		);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
			log.info("Stop loss monitor stopped");
		}
	}

	private check(): void {
		const pendingTrades = this.getPendingTrades();
		if (pendingTrades.length === 0) return;

		const currentPrices = this.getCurrentPrices();
		const results = checkStopLoss(pendingTrades, currentPrices, this.config);

		for (const result of results) {
			if (result.shouldStop) {
				this.onStopLoss(result.tradeId, result.reason);
			}
		}
	}

	updateConfig(config: Partial<StopLossConfig>): void {
		this.config = { ...this.config, ...config };
		log.info(`Stop loss config updated: threshold=${(this.config.stopLossPercent * 100).toFixed(1)}%`);
	}
}
