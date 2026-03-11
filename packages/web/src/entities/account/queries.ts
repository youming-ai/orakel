import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
	QUERY_REFETCH_PAPER_STATS_MS,
	QUERY_REFETCH_STATE_MS,
	QUERY_STALE_STATE_HTTP_MS,
	QUERY_STALE_STATE_WS_MS,
	QUERY_STALE_TRADES_MS,
} from "@/lib/constants";
import { queryKeys } from "@/shared/query/queryKeys";

export function stateQueryOptions(wsConnected: boolean = false) {
	return queryOptions({
		queryKey: queryKeys.state,
		queryFn: api.getState,
		refetchInterval: wsConnected ? false : QUERY_REFETCH_STATE_MS,
		staleTime: wsConnected ? QUERY_STALE_STATE_WS_MS : QUERY_STALE_STATE_HTTP_MS,
	});
}

export function paperStatsQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.paperStats,
		queryFn: api.getPaperStats,
		refetchInterval: QUERY_REFETCH_PAPER_STATS_MS,
		staleTime: QUERY_STALE_TRADES_MS,
	});
}

export function liveStatsQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.liveStats,
		queryFn: api.getLiveStats,
		refetchInterval: QUERY_REFETCH_PAPER_STATS_MS,
		staleTime: QUERY_STALE_TRADES_MS,
	});
}

export function usePaperStats(enabled: boolean) {
	return useQuery({
		...paperStatsQueryOptions(),
		enabled,
		refetchInterval: enabled ? QUERY_REFETCH_PAPER_STATS_MS : false,
	});
}

export function useLiveStats(enabled: boolean) {
	return useQuery({
		...liveStatsQueryOptions(),
		enabled,
		refetchInterval: enabled ? QUERY_REFETCH_PAPER_STATS_MS : false,
	});
}
