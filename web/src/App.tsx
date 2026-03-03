import { useCallback, useMemo } from "react";
import { Routes, Route, Navigate } from "react-router";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/toaster";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { PaperTradeEntry, TradeRecord } from "@/lib/api";
import { useDashboardStateWithWs, useLiveCancel, useLiveReset, useLiveToggle, usePaperCancel, usePaperClearStop, usePaperReset, usePaperStats, usePaperToggle, useTrades } from "@/lib/queries";
import { useUIStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { Dashboard } from "./components/Dashboard";
import { Layout } from "./components/Layout";
import { TradesPage } from "./pages/Trades";

function AppContent() {
	const prefersReducedMotion = useReducedMotion();
	const viewMode = useUIStore((s) => s.viewMode);
	const setViewMode = useUIStore((s) => s.setViewMode);
	const confirmAction = useUIStore((s) => s.confirmAction);
	const setConfirmAction = useUIStore((s) => s.setConfirmAction);
	const { data: state, error: stateError } = useDashboardStateWithWs();

	const { data: trades = [] } = useTrades(viewMode);
	const { data: paperStatsData } = usePaperStats(viewMode === "paper");
	const paperToggle = usePaperToggle();
	const liveToggle = useLiveToggle();
	const paperCancel = usePaperCancel();
	const liveCancel = useLiveCancel();

	const paperTrades = paperStatsData?.trades ?? [];

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

	const handleConfirm = useCallback(() => {
		if (!state || !confirmAction) return;
		const actionStr = confirmAction === "start" ? "Starting" : "Stopping";
		if (viewMode === "paper") {
			paperToggle.mutate(confirmAction === "stop");
			toast({ title: "Paper Bot", description: `${actionStr} paper trading...`, type: "info" });
		} else {
			liveToggle.mutate(confirmAction === "stop");
			toast({ title: "Live Bot", description: `${actionStr} live trading...`, type: "info" });
		}
		setConfirmAction(null);
	}, [state, confirmAction, viewMode, paperToggle, liveToggle, setConfirmAction]);

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
							{/* biome-ignore lint/a11y/useSemanticElements: role=status is correct for ARIA live region loading spinners */}
							<div
								className={`inline-block h-6 w-6 rounded-full border-2 border-muted-foreground border-t-transparent${
									prefersReducedMotion ? "" : " animate-spin"
								}`}
								role="status"
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
		<Routes>
			<Route path="/" element={<Layout {...layoutProps} />}>
				<Route index element={<Dashboard />} />
				<Route path="trades" element={<TradesPage viewMode={viewMode} liveTrades={trades} paperTrades={paperTrades} />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Route>
		</Routes>
	);
}

export function App() {
	return (
		<>
			<AppContent />
			<AlertDialogWrapper />
			<Toaster />
		</>
	);
}

function AlertDialogWrapper() {
	const confirmAction = useUIStore((s) => s.confirmAction);
	const setConfirmAction = useUIStore((s) => s.setConfirmAction);
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: state } = useDashboardStateWithWs();
	const paperToggle = usePaperToggle();
	const liveToggle = useLiveToggle();

	const handleConfirm = useCallback(() => {
		if (!state || !confirmAction) return;
		const actionStr = confirmAction === "start" ? "Starting" : "Stopping";
		if (viewMode === "paper") {
			paperToggle.mutate(confirmAction === "stop");
			toast({ title: "Paper Bot", description: `${actionStr} paper trading...`, type: "info" });
		} else {
			liveToggle.mutate(confirmAction === "stop");
			toast({ title: "Live Bot", description: `${actionStr} live trading...`, type: "info" });
		}
		setConfirmAction(null);
	}, [state, confirmAction, viewMode, paperToggle, liveToggle, setConfirmAction]);

	return (
		<AlertDialog
			open={confirmAction !== null}
			onOpenChange={(open) => {
				if (!open) setConfirmAction(null);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{confirmAction === "start" ? "Start Bot" : "Stop Bot"}</AlertDialogTitle>
					<AlertDialogDescription>
						{confirmAction === "start"
							? `Start ${viewMode} trading? The bot will begin at the next 15-minute cycle boundary.`
							: `Stop ${viewMode} trading? The bot will finish the current cycle and settle before stopping.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={handleConfirm} variant={confirmAction === "stop" ? "destructive" : "default"}>
						{confirmAction === "start" ? "Start" : "Stop"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
