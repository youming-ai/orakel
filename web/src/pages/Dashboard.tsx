import { useMemo } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { OverviewTab } from "@/components/analytics/OverviewTab";
import type { PaperTradeEntry, TradeRecord } from "@/lib/api";
import {
	useDashboardStateWithWs,
	useLiveReset,
	usePaperClearStop,
	usePaperReset,
	usePaperStats,
	useTrades,
} from "@/lib/queries";
import { buildPnlTimeline, buildStatsFromTrades, liveTradesAsPaper } from "@/lib/stats";
import { useUIStore } from "@/lib/store";

function DashboardContent() {
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: state } = useDashboardStateWithWs();
	const { data: trades = [] } = useTrades(viewMode);
	const { data: paperStatsData } = usePaperStats(viewMode === "paper");

	const paperTrades = paperStatsData?.trades ?? [];

	// Convert TradeRecord (live trades) to PaperTradeEntry format for OverviewTab
	const liveTradesPaper = useMemo(() => liveTradesAsPaper(trades), [trades]);
	const currentTrades = viewMode === "paper" ? paperTrades : liveTradesPaper;

	// Calculate merged stats for OverviewTab
	const mergedStats = useMemo(() => buildStatsFromTrades(currentTrades), [currentTrades]);

	// Calculate PnL timeline for OverviewTab
	const pnlTimeline = useMemo(() => buildPnlTimeline(currentTrades), [currentTrades]);

	const timelinePositive = (pnlTimeline[pnlTimeline.length - 1]?.cumulative ?? 0) >= 0;
	const clearStopMutation = usePaperClearStop();
	const paperResetMutation = usePaperReset();
	const liveResetMutation = useLiveReset();
	const resetMutation = viewMode === "paper" ? paperResetMutation : liveResetMutation;

	if (!state) {
		return null; // Loading state handled by App.tsx
	}

	return (
		<AppErrorBoundary>
			<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-safe">
				<OverviewTab
					stopLoss={viewMode === "paper" ? state.stopLoss : undefined}
					viewMode={viewMode}
					todayStats={viewMode === "paper" ? state.todayStats : state.liveTodayStats}
					clearStopMutation={clearStopMutation}
					mergedStats={mergedStats}
					pnlTimeline={pnlTimeline}
					timelinePositive={timelinePositive}
					markets={state.markets ?? []}
				/>
			</main>
		</AppErrorBoundary>
	);
}

export function Dashboard() {
	return <DashboardContent />;
}
