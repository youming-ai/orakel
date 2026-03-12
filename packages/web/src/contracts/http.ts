import type { RiskConfigDto } from "@orakel/shared/contracts";

export type RiskConfig = RiskConfigDto;

export interface ConfidenceResult {
	score: number;
	factors: {
		indicatorAlignment: number;
		volatilityScore: number;
		orderbookScore: number;
		timingScore: number;
		regimeScore: number;
	};
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
	rawSum: number | null;
	arbitrage: boolean;
	predictLong: number | null;
	predictShort: number | null;
	predictDirection: "LONG" | "SHORT" | "NEUTRAL";
	haColor: string | null;
	haConsecutive: number;
	rsi: number | null;
	macd: { macd: number; signal: number; hist: number; histDelta: number | null } | null;
	vwapSlope: number | null;
	timeLeftMin: number | null;
	phase: string | null;
	action: string;
	side: string | null;
	edge: number | null;
	strength: string | null;
	reason: string | null;
	volatility15m: number | null;
	blendSource: string | null;
	volImpliedUp: number | null;
	spotChainlinkDelta: number | null;
	orderbookImbalance: number | null;
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

export interface StopLossStatus {
	stoppedAt: string | null;
	reason: string | null;
}

export interface TodayStats {
	pnl: number;
	trades: number;
	limit: number;
}

export interface PaperStatsResponse {
	stats: PaperStats;
	trades: PaperTradeEntry[];
	byMarket: Record<string, MarketBreakdown>;
	stopLoss: StopLossStatus | null;
	todayStats: TodayStats;
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
	paperPendingSince?: number | null;
	livePendingSince?: number | null;
	paperStats?: PaperStats | null;
	liveStats?: PaperStats | null;
	stopLoss?: StopLossStatus | null;
	liveStopLoss?: StopLossStatus | null;
	todayStats?: TodayStats;
	liveTodayStats?: TodayStats;
}
