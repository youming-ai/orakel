import type { Side } from "./tradeTypes.ts";

export type AccountMode = "paper" | "live";

export interface DailyPnl {
	date: string;
	pnl: number;
	trades: number;
}

export interface TradeEntry {
	id: string;
	marketId: string;
	marketSlug?: string;
	windowStartMs: number;
	side: Side;
	price: number;
	size: number;
	priceToBeat: number;
	currentPriceAtEntry: number | null;
	timestamp: string;
	resolved: boolean;
	won: boolean | null;
	pnl: number | null;
	settlePrice: number | null;
}

export interface PersistedAccountState {
	trades: TradeEntry[];
	wins: number;
	losses: number;
	totalPnl: number;
	maxDrawdown: number;
	stoppedAt: string | null;
	stopReason: string | null;
}

export interface AccountStatsResult {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}

export interface MarketBreakdown {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}
