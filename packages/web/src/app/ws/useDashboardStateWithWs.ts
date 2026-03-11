import { useQuery, useQueryClient } from "@tanstack/react-query";
import { stateQueryOptions } from "@/entities/account/queries";
import { useWebSocket } from "@/lib/ws";
import { createWsCacheHandler } from "./cacheSync";

export function useDashboardStateWithWs() {
	const queryClient = useQueryClient();
	const { isConnected } = useWebSocket({
		onMessage: createWsCacheHandler(queryClient),
	});
	return useQuery(stateQueryOptions(isConnected));
}
