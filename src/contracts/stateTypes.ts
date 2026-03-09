export interface ConfidenceDto {
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
	binanceChainlinkDelta: number | null;
	orderbookImbalance: number | null;
	confidence?: ConfidenceDto;
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
}

export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed" | "balance:snapshot";

export interface WsMessage<T = unknown> {
	type: WsEventType;
	data: T;
	ts: number;
	version: number;
}

export interface StateSnapshotPayload {
	markets: MarketSnapshot[];
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperPendingSince: number | null;
	livePendingSince: number | null;
	paperStats: PaperStats | null;
	liveStats: PaperStats | null;
	liveTodayStats: { pnl: number; trades: number; limit: number } | null;
	todayStats?: { pnl: number; trades: number; limit: number };
	stopLoss?: { stoppedAt: string | null; reason: string | null } | null;
	liveStopLoss?: { stoppedAt: string | null; reason: string | null } | null;
}

export interface SignalNewPayload {
	marketId: string;
	timestamp: string;
	regime: string | null;
	signal: "ENTER" | "HOLD";
	modelUp: number;
	modelDown: number;
	edgeUp: number | null;
	edgeDown: number | null;
	recommendation: string | null;
}

export interface TradeExecutedPayload {
	marketId: string;
	mode: "paper" | "live";
	side: "UP" | "DOWN";
	price: number;
	size: number;
	timestamp: string;
	orderId: string;
	status: string;
}

export interface CtfPosition {
	tokenId: string;
	balance: string;
	marketId: string | null;
	side: string | null;
}

export interface BalanceSnapshotPayload {
	usdcBalance: number;
	usdcRaw: string;
	positions: CtfPosition[];
	blockNumber: number;
	timestamp: number;
}
