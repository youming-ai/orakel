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

export function usePaperClearStop() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.paperClearStop(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.state });
			qc.invalidateQueries({ queryKey: queryKeys.paperStats });
		},
	});
}

export function usePaperReset() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.paperReset(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.state });
			qc.invalidateQueries({ queryKey: queryKeys.trades("paper") });
			qc.invalidateQueries({ queryKey: queryKeys.paperStats });
		},
	});
}

export function useLiveReset() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.liveReset(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.state });
			qc.invalidateQueries({ queryKey: queryKeys.trades("live") });
			qc.invalidateQueries({ queryKey: queryKeys.liveStats });
		},
	});
}
