// Public contract types — re-exported from backend (type-only, erased at build time)

export type { ConfigUpdateDto as ConfigPayload, RiskConfigDto as RiskConfig } from "@server/contracts/config.ts";
export type {
	BalanceDto as PaperBalance,
	DashboardStateDto as DashboardState,
	MarketBreakdownDto as MarketBreakdown,
	MarketSnapshotDto as MarketSnapshot,
	PaperStatsDto as PaperStats,
	PaperStatsResponseDto as PaperStatsResponse,
	PaperTradeEntryDto as PaperTradeEntry,
	StopLossStatusDto as StopLossStatus,
	TodayStatsDto as TodayStats,
	TradeRecordDto as TradeRecord,
} from "@server/contracts/http.ts";
export type { ConfidenceDto as ConfidenceResult } from "@server/contracts/stateTypes.ts";
