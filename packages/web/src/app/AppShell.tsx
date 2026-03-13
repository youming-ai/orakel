import { useCallback } from "react";
import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmToggleDialog } from "@/features/botControl/ConfirmToggleDialog";
import { useLiveCancel, useLiveToggle, usePaperCancel, usePaperToggle } from "@/features/botControl/mutations";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useUIStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { DashboardPanel } from "@/widgets/dashboard/DashboardPanel";
import { AppLayout } from "./layout/AppLayout";

export function AppShell() {
	const prefersReducedMotion = useReducedMotion();
	const viewMode = useUIStore((s) => s.viewMode);
	const setViewMode = useUIStore((s) => s.setViewMode);
	const setConfirmAction = useUIStore((s) => s.setConfirmAction);
	const { data: state, error: stateError } = useDashboardStateWithWs();

	const paperToggle = usePaperToggle();
	const liveToggle = useLiveToggle();
	const paperCancel = usePaperCancel();
	const liveCancel = useLiveCancel();

	const handleViewModeChange = useCallback(
		(mode: "paper" | "live") => {
			setViewMode(mode);
		},
		[setViewMode],
	);

	const handlePaperToggle = useCallback(() => {
		if (!state) return;
		if (state.paperPendingStart || state.paperPendingStop) {
			paperCancel.mutate();
			toast({ type: "info", description: "Paper bot start/stop cancelled" });
			return;
		}
		setConfirmAction(state.paperRunning ? "stop" : "start");
	}, [state, paperCancel, setConfirmAction]);

	const handleLiveToggle = useCallback(() => {
		if (!state) return;
		if (state.livePendingStart || state.livePendingStop) {
			liveCancel.mutate();
			toast({ type: "info", description: "Live bot start/stop cancelled" });
			return;
		}
		setConfirmAction(state.liveRunning ? "stop" : "start");
	}, [state, liveCancel, setConfirmAction]);

	if (!state) {
		return (
			<div className="flex items-center justify-center h-screen">
				<div className="text-center space-y-3">
					{stateError ? (
						<>
							<p className="text-sm text-red-400">Failed to connect: {stateError.message}</p>
							<button
								type="button"
								onClick={() => window.location.reload()}
								className="mt-2 px-4 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-accent transition-colors"
							>
								Retry
							</button>
						</>
					) : (
						<>
							<output
								className={`inline-block h-6 w-6 rounded-full border-2 border-muted-foreground border-t-transparent${
									prefersReducedMotion ? "" : " animate-spin"
								}`}
								aria-label="Loading dashboard"
							/>
							<p className="text-sm text-muted-foreground">Connecting to bot...</p>
						</>
					)}
				</div>
			</div>
		);
	}

	const layoutProps = {
		viewMode,
		paperRunning: state.paperRunning,
		liveRunning: state.liveRunning,
		paperPendingStart: state.paperPendingStart ?? false,
		paperPendingStop: state.paperPendingStop ?? false,
		livePendingStart: state.livePendingStart ?? false,
		livePendingStop: state.livePendingStop ?? false,
		onViewModeChange: handleViewModeChange,
		onPaperToggle: handlePaperToggle,
		onLiveToggle: handleLiveToggle,
		paperMutationPending: paperToggle.isPending || paperCancel.isPending,
		liveMutationPending: liveToggle.isPending || liveCancel.isPending,
	};

	return (
		<>
			<AppLayout {...layoutProps}>
				<DashboardPanel />
			</AppLayout>
			<ConfirmToggleDialog />
			<Toaster />
		</>
	);
}
