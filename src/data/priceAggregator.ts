/**
 * 价格聚合器
 * 聚合多个交易所价格，检测价差和异常
 */

import { createLogger } from "../core/logger.ts";
import { fetchLastPrice } from "./binance.ts";
import { fetchBybitPrice } from "./bybit.ts";

const log = createLogger("price-aggregator");

export interface PriceSource {
	name: string;
	price: number | null;
	timestamp: number;
}

export interface AggregatedPrice {
	average: number;
	sources: PriceSource[];
	divergence: DivergenceInfo | null;
	confidence: number; // 0-1
}

export interface DivergenceInfo {
	maxDivergence: number; // 最大价差百分比
	source1: string;
	source2: string;
	price1: number;
	price2: number;
}

/**
 * 聚合多个交易所价格
 */
export async function aggregatePrices(symbol: string): Promise<AggregatedPrice | null> {
	const sources: PriceSource[] = [];

	// 并行获取价格
	const [binancePrice, bybitPrice] = await Promise.all([fetchLastPrice({ symbol }), fetchBybitPrice(symbol)]);

	const now = Date.now();

	// 添加 Binance 价格
	if (binancePrice !== null) {
		sources.push({
			name: "binance",
			price: binancePrice,
			timestamp: now,
		});
	}

	// 添加 Bybit 价格
	if (bybitPrice !== null) {
		sources.push({
			name: "bybit",
			price: bybitPrice,
			timestamp: now,
		});
	}

	// 如果没有价格数据，返回 null
	if (sources.length === 0) {
		log.warn(`No price data available for ${symbol}`);
		return null;
	}

	// 计算平均价格
	const validPrices = sources.filter((s) => s.price !== null).map((s) => s.price as number);
	const average = validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length;

	// 检测价差
	const divergence = detectDivergence(sources);

	// 计算置信度
	const confidence = calculateConfidence(sources, divergence);

	return {
		average,
		sources,
		divergence,
		confidence,
	};
}

/**
 * 检测价差
 */
export function detectDivergence(sources: PriceSource[]): DivergenceInfo | null {
	if (sources.length < 2) {
		return null;
	}

	let maxDivergence = 0;
	let divergenceInfo: DivergenceInfo | null = null;

	// 比较所有价格对
	for (let i = 0; i < sources.length; i++) {
		for (let j = i + 1; j < sources.length; j++) {
			const source1 = sources[i];
			const source2 = sources[j];
			if (!source1 || !source2) continue;

			const price1 = source1.price;
			const price2 = source2.price;

			if (price1 === null || price2 === null) continue;

			// 计算价差百分比
			const avgPrice = (price1 + price2) / 2;
			const divergence = Math.abs(price1 - price2) / avgPrice;

			if (divergence > maxDivergence) {
				maxDivergence = divergence;
				divergenceInfo = {
					maxDivergence: divergence,
					source1: source1.name,
					source2: source2.name,
					price1,
					price2,
				};
			}
		}
	}

	return divergenceInfo;
}

/**
 * 计算价格置信度
 */
export function calculateConfidence(sources: PriceSource[], divergence: DivergenceInfo | null): number {
	let confidence = 0;

	// 基础置信度：有多个数据源
	if (sources.length >= 2) {
		confidence += 0.5;
	} else {
		confidence += 0.3;
	}

	// 价差惩罚
	if (divergence) {
		if (divergence.maxDivergence < 0.001) {
			// 价差 < 0.1%，高置信度
			confidence += 0.3;
		} else if (divergence.maxDivergence < 0.004) {
			// 价差 < 0.4%，中等置信度
			confidence += 0.2;
		} else {
			// 价差 >= 0.4%，低置信度
			confidence += 0.1;
		}
	} else {
		// 没有价差数据，使用基础置信度
		confidence += 0.2;
	}

	// 价格新鲜度
	const now = Date.now();
	const allFresh = sources.every((s) => now - s.timestamp < 10_000);
	if (allFresh) {
		confidence += 0.2;
	}

	return Math.min(confidence, 1);
}

/**
 * 检查是否存在套利机会
 */
export function hasArbitrageOpportunity(
	divergence: DivergenceInfo | null,
	threshold: number = 0.004, // 默认 0.4%
): boolean {
	if (!divergence) return false;
	return divergence.maxDivergence >= threshold;
}

/**
 * 获取价格方向一致性
 * 如果所有价格源方向一致，返回 true
 */
export function getPriceDirectionConsensus(
	sources: PriceSource[],
	previousPrice: number,
): { consensus: boolean; direction: "UP" | "DOWN" | null } {
	if (sources.length === 0 || !previousPrice) {
		return { consensus: false, direction: null };
	}

	let upCount = 0;
	let downCount = 0;

	for (const source of sources) {
		if (source.price === null) continue;

		if (source.price > previousPrice) {
			upCount++;
		} else if (source.price < previousPrice) {
			downCount++;
		}
	}

	// 如果所有数据源方向一致
	if (upCount > 0 && downCount === 0) {
		return { consensus: true, direction: "UP" };
	}
	if (downCount > 0 && upCount === 0) {
		return { consensus: true, direction: "DOWN" };
	}

	// 方向不一致
	return { consensus: false, direction: null };
}
