import type { ConfigSnapshotDto } from "./config.ts";
import type { MarketSnapshot, PaperStats, PaperTradeEntry } from "./stateTypes.ts";

export interface StopLossStatusDto {
	stoppedAt: string | null;
	reason: string | null;
}

export interface TodayStatsDto {
	pnl: number;
	trades: number;
	limit: number;
}

export interface BalanceDto {
	initial: number;
	current: number;
	maxDrawdown: number;
	reserved?: number;
}

export interface DailySummaryDto {
	date: string;
	pnl: number;
	trades: number;
}

export interface WalletStatusDto {
	address: string | null;
	connected: boolean;
}

export interface LiveWalletDto extends WalletStatusDto {
	clientReady: boolean;
}

export type MarketSnapshotDto = MarketSnapshot;
export type PaperStatsDto = PaperStats;
export type PaperTradeEntryDto = PaperTradeEntry;

export interface MarketBreakdownDto {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}

export interface PaperStatsResponseDto {
	stats: PaperStatsDto;
	trades: PaperTradeEntryDto[];
	byMarket: Record<string, MarketBreakdownDto>;
	balance: BalanceDto;
	stopLoss: StopLossStatusDto | null;
	todayStats: TodayStatsDto;
}

export interface TradeRecordDto {
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

export interface DashboardStateDto {
	markets: MarketSnapshotDto[];
	updatedAt: string;
	paperMode: boolean;
	wallet: WalletStatusDto;
	paperDaily: DailySummaryDto;
	liveDaily: DailySummaryDto;
	config: ConfigSnapshotDto;
	paperRunning: boolean;
	liveRunning: boolean;
	paperStats: PaperStatsDto | null;
	liveStats: PaperStatsDto | null;
	paperBalance: BalanceDto;
	liveBalance: BalanceDto;
	liveWallet: LiveWalletDto;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperPendingSince: number | null;
	livePendingSince: number | null;
	stopLoss: StopLossStatusDto | null;
	liveStopLoss: StopLossStatusDto | null;
	todayStats: TodayStatsDto;
	liveTodayStats: TodayStatsDto;
}
