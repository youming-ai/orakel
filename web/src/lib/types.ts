export type ViewMode = "paper" | "live";

export interface MarketRow {
	market: string;
	trades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	winRatePct: number;
	pnl: number;
	resolvedCount: number;
}
