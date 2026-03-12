import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/shared/query/queryKeys";

export function usePaperToggle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (running: boolean) => (running ? api.paperStop() : api.paperStart()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.state });
		},
	});
}

export function useLiveToggle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (running: boolean) => (running ? api.liveStop() : api.liveStart()),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.state });
		},
	});
}

export function usePaperCancel() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.paperCancel(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.state });
		},
	});
}

export function useLiveCancel() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.liveCancel(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.state });
		},
	});
}
