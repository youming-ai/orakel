export interface StopLossStatus {
	stoppedAt: string | null;
	reason: string | null;
}

export interface TodayStats {
	pnl: number;
	trades: number;
	limit: number;
}

export interface PaperBalance {
	initial: number;
	current: number;
	maxDrawdown: number;
	reserved?: number;
}

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

export interface RiskConfig {
	maxTradeSizeUsdc: number;
	limitDiscount: number;
	dailyMaxLossUsdc: number;
	maxOpenPositions: number;
	minLiquidity: number;
	maxTradesPerWindow: number;
}

export interface ConfigPayload {
	strategy: Record<string, unknown>;
	paperRisk?: Partial<RiskConfig>;
	liveRisk?: Partial<RiskConfig>;
}

export interface DashboardState {
	markets: MarketSnapshot[];
	paperMode: boolean;
	paperStats: PaperStats | null;
	liveStats: PaperStats | null;
	config: {
		strategy: Record<string, unknown>;
		paperRisk: RiskConfig;
		liveRisk: RiskConfig;
	};
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperPendingSince: number | null;
	livePendingSince: number | null;
	wallet: {
		address: string | null;
		connected: boolean;
	};
	liveWallet: {
		address: string | null;
		connected: boolean;
		clientReady: boolean;
	};
	stopLoss: StopLossStatus | null;
	liveStopLoss: StopLossStatus | null;
	paperBalance: PaperBalance;
	liveBalance: PaperBalance;
	todayStats: TodayStats;
	liveTodayStats: TodayStats;
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
	binanceChainlinkDelta: number | null;
	orderbookImbalance: number | null;
	confidence?: ConfidenceResult;
}

export interface PaperStats {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
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

export interface MarketBreakdown {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}

export interface PaperStatsResponse {
	stats: PaperStats;
	trades: PaperTradeEntry[];
	byMarket: Record<string, MarketBreakdown>;
	stopLoss?: StopLossStatus | null;
	balance?: PaperBalance;
	todayStats?: TodayStats;
	dailyPnl?: Array<{
		date: string;
		pnl: number;
		trades: number;
	}>;
}

export interface TradeRecord {
	orderId: string;
	timestamp: string;
	market: string;
	marketSlug: string | null;
	side: string;
	amount: string;
	price: string;
	status?: string;
	mode?: string;
	pnl: number | null;
	won: number | null;
	currentPriceAtEntry: number | null;
}
