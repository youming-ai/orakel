import { liveStatsQueryOptions, paperStatsQueryOptions, stateQueryOptions, useDashboardState, useLiveStats, usePaperStats } from "@/entities/account/queries";
import { useTrades, tradesQueryOptions } from "@/entities/trade/queries";
import {
	useLiveCancel,
	useLiveReset,
	useLiveToggle,
	usePaperCancel,
	usePaperClearStop,
	usePaperReset,
	usePaperToggle,
} from "@/features/botControl/mutations";
import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";

export const queries = {
	state: stateQueryOptions,
	trades: tradesQueryOptions,
	paperStats: paperStatsQueryOptions,
	liveStats: liveStatsQueryOptions,
};

export {
	useDashboardState,
	useDashboardStateWithWs,
	useLiveCancel,
	useLiveReset,
	useLiveStats,
	useLiveToggle,
	usePaperCancel,
	usePaperClearStop,
	usePaperReset,
	usePaperStats,
	usePaperToggle,
	useTrades,
};
