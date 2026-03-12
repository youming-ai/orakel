export type { Decision, Phase, Side, WindowStateLabel } from "@orakel/shared/contracts";

export interface PriceTick {
	price: number;
	timestampMs: number;
}

export interface PriceAdapter {
	getLatestPrice(): PriceTick | null;
	getRecentTicks(maxAgeMs?: number): PriceTick[];
	start(): void;
	stop(): void;
}

export interface OrderBookSnapshot {
	bestBid: number | null;
	bestAsk: number | null;
	midpoint: number | null;
	spread: number | null;
	timestampMs: number;
}

export interface MarketInfo {
	slug: string;
	conditionId: string;
	upTokenId: string;
	downTokenId: string;
	priceToBeat: number;
	startMs: number;
	endMs: number;
}
