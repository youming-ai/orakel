import type { DashboardState, PaperBalance, StopLossStatus, TodayStats } from "@/contracts/http";

export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed" | "balance:snapshot";

export interface WsMessage<T = unknown> {
	type: WsEventType;
	data: T;
	ts: number;
	version: number;
}

export interface StateSnapshotPayload {
	markets: DashboardState["markets"];
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperStats: DashboardState["paperStats"];
	liveStats: DashboardState["liveStats"];
	liveTodayStats: TodayStats | null;
	paperBalance?: PaperBalance;
	liveBalance?: PaperBalance;
	todayStats?: TodayStats;
	stopLoss?: StopLossStatus | null;
	liveStopLoss?: StopLossStatus | null;
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
