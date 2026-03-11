import { createLogger } from "../core/logger.ts";
import { fetchLastPrice as fetchBinancePrice } from "./binance.ts";
import { fetchLastPrice as fetchBybitPrice } from "./bybit.ts";

const log = createLogger("price-aggregator");

export interface PriceSource {
	name: string;
	price: number | null;
	timestamp: number;
}

export interface DivergenceInfo {
	maxDivergence: number;
	source1: string;
	source2: string;
	price1: number;
	price2: number;
}

export interface AggregatedPrice {
	average: number;
	sources: PriceSource[];
	divergence: DivergenceInfo | null;
	confidence: number;
}

export async function aggregatePrices(symbol: string): Promise<AggregatedPrice | null> {
	const now = Date.now();

	const binancePrice = await fetchBinancePrice({ symbol });
	if (binancePrice !== null) {
		return {
			average: binancePrice,
			sources: [
				{
					name: "binance",
					price: binancePrice,
					timestamp: now,
				},
			],
			divergence: null,
			confidence: 0.9,
		};
	}

	log.warn(`Binance failed for ${symbol}, trying Bybit...`);
	const bybitPrice = await fetchBybitPrice({ symbol });
	if (bybitPrice !== null) {
		return {
			average: bybitPrice,
			sources: [
				{
					name: "bybit",
					price: bybitPrice,
					timestamp: now,
				},
			],
			divergence: null,
			confidence: 0.8,
		};
	}

	log.error(`Both Binance and Bybit failed for ${symbol}`);
	return null;
}
