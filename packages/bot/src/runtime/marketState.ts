import type { MarketState } from "../pipeline/processMarket.ts";

export function collectLatestPrices(
	markets: ReadonlyArray<{ id: string }>,
	states: Map<string, MarketState>,
): Map<string, number> {
	const prices = new Map<string, number>();
	for (const market of markets) {
		const marketState = states.get(market.id);
		const p = marketState?.prevCurrentPrice;
		if (p !== null && p !== undefined) {
			prices.set(market.id, p);
		}
	}
	return prices;
}

export function createMarketStateMap(markets: ReadonlyArray<{ id: string }>): Map<string, MarketState> {
	return new Map<string, MarketState>(
		markets.map((m) => [
			m.id,
			{
				prevSpotPrice: null,
				prevCurrentPrice: null,
				prevMarketUp: null,
				prevMarketDown: null,
				priceToBeatState: { slug: null, value: null, setAtMs: null },
			},
		]),
	);
}
