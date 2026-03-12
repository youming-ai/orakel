import type { RiskConfigDto } from "@orakel/shared/contracts";

export type RiskConfig = RiskConfigDto;

export interface ConfidenceResult {
	score: number;
	level: "HIGH" | "MEDIUM" | "LOW";
}

export interface MarketSnapshot {
	id: string;
	label: string;
	ok: boolean;
	error?: string;
	spotPrice: number | null;
	currentPrice: number | null;
	priceToBeat: number | null;
	marketUp: number | null;
	marketDown: number | null;
	predictLong: number | null;
	predictShort: number | null;
	predictDirection: "LONG" | "SHORT" | "NEUTRAL";
	timeLeftMin: number | null;
	phase: string | null;
	action: string;
	side: string | null;
	edge: number | null;
	reason: string | null;
	volatility15m: number | null;
	spotDelta: number | null;
	confidence?: ConfidenceResult;
}

export interface PaperTradeEntry {
	id: string;
	marketId: string;
	windowStartMs: number;
	side: "UP" | "DOWN";
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

export interface PaperStats {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	todayPnl: number;
	todayTrades: number;
	dailyMaxLoss: number;
	balanceUsdc: number;
}

export interface MarketBreakdown {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}

export interface TodayStats {
	pnl: number;
	trades: number;
	limit: number;
}

export interface TradeRecord {
	timestamp: string;
	market: string;
	marketSlug: string | null;
	side: string;
	amount: string;
	price: string;
	orderId: string;
	status: string;
	mode: string;
	pnl: number | null;
	won: number | null;
	currentPriceAtEntry: number | null;
}

export interface DashboardState {
	markets: MarketSnapshot[];
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperStats?: PaperStats | null;
	liveStats?: PaperStats | null;
	todayStats?: TodayStats;
	liveTodayStats?: TodayStats;
}
