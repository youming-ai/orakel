export interface AccountStatsDto {
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

export type WindowStateLabel = "PENDING" | "ACTIVE" | "CLOSING" | "SETTLED" | "REDEEMED";
export type Phase = "EARLY" | "MID" | "LATE";
export type Side = "UP" | "DOWN";
export type Decision = "ENTER_UP" | "ENTER_DOWN" | "SKIP";

export interface WindowSnapshotDto {
	slug: string;
	state: WindowStateLabel;
	startMs: number;
	endMs: number;
	timeLeftSeconds: number;
	priceToBeat: number | null;
	chainlinkPrice: number | null;
	deviation: number | null;
	modelProbUp: number | null;
	marketProbUp: number | null;
	edgeUp: number | null;
	edgeDown: number | null;
	phase: Phase | null;
	decision: Decision | null;
	volatility: number | null;
}

export interface StateSnapshotPayload {
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	currentWindow: WindowSnapshotDto | null;
	paperStats: AccountStatsDto | null;
	liveStats: AccountStatsDto | null;
}

export interface SignalNewPayload {
	windowSlug: string;
	chainlinkPrice: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edgeUp: number;
	edgeDown: number;
	phase: Phase;
	decision: Decision;
	reason: string | null;
}

export interface TradeExecutedPayload {
	mode: "paper" | "live";
	windowSlug: string;
	side: Side;
	price: number;
	size: number;
	edge: number;
	orderId: string | null;
	timestamp: string;
}

export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed";

export interface WsMessage<T = unknown> {
	type: WsEventType;
	data: T;
	ts: number;
}
