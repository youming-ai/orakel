import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { ConfigPayload } from "./api";
import { api } from "./api";
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
			refetchInterval: wsConnected ? false : 2_000,
			staleTime: wsConnected ? 30_000 : 0,
		}),

	trades: (mode: ViewMode) =>
		queryOptions({
			queryKey: ["trades", mode] as const,
			queryFn: () => api.getTrades(mode),
			refetchInterval: 10_000,
			staleTime: 8_000,
		}),

	paperStats: () =>
		queryOptions({
			queryKey: ["paper-stats"] as const,
			queryFn: api.getPaperStats,
			refetchInterval: 10_000,
			staleTime: 8_000,
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
		refetchInterval: enabled ? 10_000 : false,
	});
}

// ---------------------------------------------------------------------------
// WebSocket Cache Handler
// ---------------------------------------------------------------------------

export function createWsCacheHandler(qc: ReturnType<typeof useQueryClient>) {
	return (msg: WsMessage) => {
		switch (msg.type) {
			case "state:snapshot": {
				qc.setQueryData(queries.state().queryKey, msg.data);
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
		mutationFn: (running: boolean) =>
			running ? api.paperStop() : api.paperStart(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
		},
	});
}

export function useLiveToggle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (running: boolean) =>
			running ? api.liveStop() : api.liveStart(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
		},
	});
}

export function usePaperCancel() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.paperCancel(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queries.state().queryKey });
		},
	});
}

export function useLiveCancel() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.liveCancel(),
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
