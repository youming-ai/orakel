import type { AccountStatsDto, Phase, Side, WindowSnapshotDto } from "./state.ts";

export interface StatusDto {
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	currentWindow: WindowSnapshotDto | null;
	btcPrice: number | null;
	btcPriceAgeMs: number | null;
	cliAvailable: boolean;
	dbConnected: boolean;
	uptimeMs: number;
}

export interface StatsDto {
	paper: AccountStatsDto;
	live: AccountStatsDto;
}

export interface TradeRecordDto {
	id: number;
	mode: "paper" | "live";
	windowSlug: string;
	side: Side;
	price: number;
	size: number;
	priceToBeat: number;
	entryBtcPrice: number;
	edge: number;
	modelProb: number;
	marketProb: number;
	phase: Phase;
	orderId: string | null;
	outcome: "WIN" | "LOSS" | null;
	settleBtcPrice: number | null;
	pnlUsdc: number | null;
	createdAt: string;
	settledAt: string | null;
}

export interface SignalRecordDto {
	id: number;
	windowSlug: string;
	timestamp: string;
	btcPrice: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edgeUp: number;
	edgeDown: number;
	volatility: number;
	timeLeftSeconds: number;
	phase: Phase;
	decision: "ENTER_UP" | "ENTER_DOWN" | "SKIP";
	reason: string | null;
}

export interface ControlRequestDto {
	mode: "paper" | "live";
}

export interface ControlResponseDto {
	ok: boolean;
	message: string;
	state: { paperRunning: boolean; liveRunning: boolean };
}
