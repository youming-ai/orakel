import { useCallback, useMemo } from "react";
import {
	useDashboardStateWithWs,
	useLiveCancel,
	useLiveToggle,
	usePaperCancel,
	usePaperStats,
	usePaperToggle,
	useTrades,
} from "@/lib/queries";
import { useUIStore } from "@/lib/store";
import type { ViewMode } from "@/lib/types";
import type { DashboardState, PaperTradeEntry, TradeRecord } from "@/lib/api";
import { AnalyticsTabs } from "./AnalyticsTabs";
import { Header } from "./Header";
import { Web3Provider } from "./Web3Provider";
import { LiveConnect } from "./LiveConnect";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/lib/toast";
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

const DEFAULT_CONFIG: DashboardState["config"] = {
	strategy: {
		edgeThresholdEarly: 0.06,
		edgeThresholdMid: 0.08,
		edgeThresholdLate: 0.1,
		minProbEarly: 0.52,
		minProbMid: 0.55,
		minProbLate: 0.6,
		blendWeights: { vol: 0.5, ta: 0.5 },
		regimeMultipliers: { CHOP: 1.3, RANGE: 1.0, TREND_ALIGNED: 0.8, TREND_OPPOSED: 1.2 },
	},
	paperRisk: {
		maxTradeSizeUsdc: 1,
		limitDiscount: 0.05,
		dailyMaxLossUsdc: 10,
		maxOpenPositions: 2,
		minLiquidity: 15000,
		maxTradesPerWindow: 1,
	},
	liveRisk: {
		maxTradeSizeUsdc: 1,
		limitDiscount: 0.05,
		dailyMaxLossUsdc: 10,
		maxOpenPositions: 2,
		minLiquidity: 15000,
		maxTradesPerWindow: 1,
	},
};

function DashboardContent() {
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
	const paperByMarket = paperStatsData?.byMarket ?? {};

	// Convert TradeRecord (live trades) to PaperTradeEntry format for AnalyticsTabs
	const liveTradesAsPaper = useMemo<PaperTradeEntry[]>(() => {
		// Ensure trades is an array before mapping
		if (!Array.isArray(trades)) return [];
		return trades.map((t: TradeRecord) => ({
			id: t.orderId,
			marketId: t.market,
			windowStartMs: new Date(t.timestamp).getTime(),
			side: (t.side.includes("UP") ? "UP" : "DOWN") as "UP" | "DOWN",
			price: Number.parseFloat(t.price) || 0,
			size: Number.parseFloat(t.amount) || 0,
			priceToBeat: 0,
			currentPriceAtEntry: null,
			timestamp: t.timestamp,
			resolved: t.status === "settled" || t.status === "won" || t.status === "lost",
			won: t.won === null ? null : Boolean(t.won),
			pnl: t.pnl,
			settlePrice: null,
		}));
	}, [trades]);

	const handleViewModeChange = useCallback(
		(mode: ViewMode) => {
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
		if (!state.liveRunning && !state.liveWallet?.clientReady) return;
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
							<div
								className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
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

	return (
		<div className="min-h-screen bg-background">
			<Header
				viewMode={viewMode}
				paperRunning={state.paperRunning}
				liveRunning={state.liveRunning}
				liveWalletReady={state.liveWallet?.clientReady ?? false}
				paperPendingStart={state.paperPendingStart ?? false}
				paperPendingStop={state.paperPendingStop ?? false}
				livePendingStart={state.livePendingStart ?? false}
				livePendingStop={state.livePendingStop ?? false}
			onViewModeChange={handleViewModeChange}
			onPaperToggle={handlePaperToggle}
			onLiveToggle={handleLiveToggle}
			paperMutationPending={paperToggle.isPending || paperCancel.isPending}
			liveMutationPending={liveToggle.isPending || liveCancel.isPending}
		/>
			<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-safe">
				{viewMode === "live" && (
					<LiveConnect
						clientReady={state.liveWallet?.clientReady ?? false}
						walletAddress={state.liveWallet?.address ?? null}
					/>
				)}
				<AnalyticsTabs
					stats={viewMode === "paper" ? state.paperStats : state.liveStats}
					trades={viewMode === "paper" ? paperTrades : liveTradesAsPaper}
					byMarket={viewMode === "paper" ? paperByMarket : undefined}
				config={state.config ?? DEFAULT_CONFIG}
					markets={state.markets ?? []}
					liveTrades={trades}
					viewMode={viewMode}
					stopLoss={viewMode === "paper" ? state.stopLoss : undefined}
					todayStats={viewMode === "paper" ? state.todayStats : state.liveTodayStats}
				/>
			</main>

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
		</div>
	);
}

export default function Dashboard() {
	return (
		<Web3Provider>
			<DashboardContent />
			<Toaster />
		</Web3Provider>
	);
}
