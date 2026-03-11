import { createLogger } from "../core/logger.ts";
import { fetchLastPrice } from "./bybit.ts";

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
	const price = await fetchLastPrice({ symbol });

	if (price === null) {
		log.warn(`No price data available for ${symbol}`);
		return null;
	}

	const now = Date.now();
	const sources: PriceSource[] = [
		{
			name: "bybit",
			price,
			timestamp: now,
		},
	];

	return {
		average: price,
		sources,
		divergence: null,
		confidence: 0.8,
	};
}
