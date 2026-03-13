import type { StateSnapshotPayload } from "@orakel/shared/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function usePaperStats(enabled: boolean) {
	return useQuery({
		queryKey: ["paperStats"],
		queryFn: () => api.getPaperStats(),
		enabled,
		staleTime: 5000,
		refetchInterval: 10000,
	});
}

export function useLiveStats(enabled: boolean) {
	return useQuery({
		queryKey: ["liveStats"],
		queryFn: () => api.getLiveStats(),
		enabled,
		staleTime: 5000,
		refetchInterval: 10000,
	});
}
