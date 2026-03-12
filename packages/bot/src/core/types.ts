export type { Side, Phase, Decision, WindowStateLabel } from "@orakel/shared/contracts";

export interface PriceTick {
	price: number;
	timestampMs: number;
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
