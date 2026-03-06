import { useEffect, useRef } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { QUERY_REFETCH_TRADES_MS, QUERY_STALE_TRADES_MS } from "@/lib/constants";
import type { ViewMode } from "@/lib/types";
import { queryKeys } from "@/shared/query/queryKeys";

export function tradesQueryOptions(mode: ViewMode) {
	return queryOptions({
		queryKey: queryKeys.trades(mode),
		queryFn: () => api.getTrades(mode),
		refetchInterval: QUERY_REFETCH_TRADES_MS,
		staleTime: QUERY_STALE_TRADES_MS,
	});
}

export function useTrades(mode: ViewMode) {
	const queryClient = useQueryClient();
	const previousModeRef = useRef<ViewMode>(mode);

	useEffect(() => {
		if (previousModeRef.current !== mode) {
			const oldMode = previousModeRef.current;
			previousModeRef.current = mode;
			queryClient.removeQueries({ queryKey: queryKeys.trades(oldMode) });
			queryClient.invalidateQueries({ queryKey: queryKeys.trades(mode) });
		}
	}, [mode, queryClient]);

	return useQuery(tradesQueryOptions(mode));
}
