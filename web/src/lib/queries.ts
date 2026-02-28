import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfigPayload, DashboardState } from "./api";

import { api } from "./api";
import {
	QUERY_REFETCH_PAPER_STATS_MS,
	QUERY_REFETCH_STATE_MS,
	QUERY_REFETCH_TRADES_MS,
	QUERY_STALE_STATE_HTTP_MS,
	QUERY_STALE_STATE_WS_MS,
	QUERY_STALE_TRADES_MS,
} from "./constants";
import type { ViewMode } from "./types";
import type { WsMessage } from "./ws";
import { useWebSocket } from "./ws";

// ---------------------------------------------------------------------------
// Query Options Factory
// Uses v5 `queryOptions()` for type-safe key + fn + defaults co-location.
// ---------------------------------------------------------------------------

export const queries = {
	state: (wsConnected: boolean = false) =>
		queryOptions({
			queryKey: ["state"] as const,
			queryFn: api.getState,
			// Only poll if WebSocket is not connected
			// When WS is connected, rely on real-time updates
			refetchInterval: wsConnected ? false : QUERY_REFETCH_STATE_MS,
			staleTime: wsConnected ? QUERY_STALE_STATE_WS_MS : QUERY_STALE_STATE_HTTP_MS,
		}),

	trades: (mode: ViewMode) =>
		queryOptions({
			queryKey: ["trades", mode] as const,
			queryFn: () => api.getTrades(mode),
			refetchInterval: QUERY_REFETCH_TRADES_MS,
			staleTime: QUERY_STALE_TRADES_MS,
		}),

	paperStats: () =>
		queryOptions({
			queryKey: ["paper-stats"] as const,
			queryFn: api.getPaperStats,
			refetchInterval: QUERY_REFETCH_TRADES_MS,
			staleTime: QUERY_STALE_TRADES_MS,
		}),
};

// ---------------------------------------------------------------------------
// Query Hooks
// ---------------------------------------------------------------------------

export function useDashboardState() {
	return useQuery(queries.state());
}

export function useTrades(mode: ViewMode) {
	return useQuery(queries.trades(mode));
}

export function usePaperStats(enabled: boolean) {
	return useQuery({
		...queries.paperStats(),
		enabled,
		refetchInterval: enabled ? QUERY_REFETCH_PAPER_STATS_MS : false,
	});
}

// ---------------------------------------------------------------------------
// WebSocket Cache Handler
// ---------------------------------------------------------------------------

export function createWsCacheHandler(qc: ReturnType<typeof useQueryClient>) {
	return (msg: WsMessage) => {
		switch (msg.type) {
			case "state:snapshot": {
				// Only merge into existing cache — WS snapshots are partial (no config/balance/etc.)
				// If no prior HTTP data exists, skip to avoid writing incomplete DashboardState.
				const prev = qc.getQueryData<DashboardState>(queries.state().queryKey);
				if (prev && msg.data && typeof msg.data === "object") {
					const patch = msg.data as Partial<DashboardState>;
					qc.setQueryData(queries.state().queryKey, {
						...prev,
						markets: patch.markets ?? prev.markets,
						updatedAt: patch.updatedAt ?? prev.updatedAt,
						config: patch.config ?? prev.config,
						paperRunning: patch.paperRunning ?? prev.paperRunning,
						liveRunning: patch.liveRunning ?? prev.liveRunning,
						paperStats: patch.paperStats ?? prev.paperStats,
						liveStats: patch.liveStats ?? prev.liveStats,
						liveWallet: patch.liveWallet ?? prev.liveWallet,
						stopLoss: patch.stopLoss !== undefined ? patch.stopLoss : prev.stopLoss,
						balance: patch.balance ?? prev.balance,
						todayStats: patch.todayStats ?? prev.todayStats,
						liveTodayStats: patch.liveTodayStats ?? prev.liveTodayStats,
						paperMode: patch.paperMode ?? prev.paperMode,
					});
				}
				break;
			}
			case "trade:executed": {
				qc.invalidateQueries({ queryKey: queries.trades("paper").queryKey });
				qc.invalidateQueries({ queryKey: queries.trades("live").queryKey });
				qc.invalidateQueries({ queryKey: queries.paperStats().queryKey });
				break;
			}
			case "signal:new": {
				qc.invalidateQueries({ queryKey: queries.state().queryKey });
				break;
			}
		}
	};
}

// Hook that combines WebSocket with React Query cache updates
export function useDashboardStateWithWs() {
	const queryClient = useQueryClient();
	const { isConnected } = useWebSocket({
		onMessage: createWsCacheHandler(queryClient),
	});
	return useQuery(queries.state(isConnected));
}

// ---------------------------------------------------------------------------
// Mutation Hooks
// ---------------------------------------------------------------------------

export function usePaperToggle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (running: boolean) => (running ? api.paperStop() : api.paperStart()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
		},
	});
}

export function useLiveToggle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (running: boolean) => (running ? api.liveStop() : api.liveStart()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
		},
	});
}

export function useConfigMutation(viewMode: ViewMode) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (payload: ConfigPayload) => api.saveConfig(payload),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
			if (viewMode === "paper") {
				qc.invalidateQueries({ queryKey: queries.paperStats().queryKey });
			}
		},
	});
}

export function usePaperClearStop() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.paperClearStop(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
			qc.invalidateQueries({ queryKey: queries.paperStats().queryKey });
		},
	});
}

export function useLiveDisconnect() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.liveDisconnect(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
		},
	});
}
