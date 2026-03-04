import { useMemo } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { OverviewTab } from "@/components/analytics/OverviewTab";
import {
	useDashboardStateWithWs,
	useLiveReset,
	useLiveStats,
	usePaperClearStop,
	usePaperReset,
	usePaperStats,
} from "@/lib/queries";
import { buildPnlTimeline, buildStatsFromTrades } from "@/lib/stats";
import { useUIStore } from "@/lib/store";

function DashboardContent() {
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: state } = useDashboardStateWithWs();
	const { data: paperStatsData } = usePaperStats(viewMode === "paper");
	const { data: liveStatsData } = useLiveStats(viewMode === "live");

	// Both paper and live now use their respective /xxx-stats endpoints (authoritative accountStats)
	const statsData = viewMode === "paper" ? paperStatsData : liveStatsData;
	const currentTrades = statsData?.trades ?? [];

	// Calculate merged stats for OverviewTab
	const mergedStats = useMemo(() => buildStatsFromTrades(currentTrades), [currentTrades]);

	// Calculate PnL timeline for OverviewTab
	const pnlTimeline = useMemo(() => buildPnlTimeline(currentTrades), [currentTrades]);

	const timelinePositive = (pnlTimeline[pnlTimeline.length - 1]?.cumulative ?? 0) >= 0;
	const clearStopMutation = usePaperClearStop();
	const paperResetMutation = usePaperReset();
	const liveResetMutation = useLiveReset();
	const resetMutation = viewMode === "paper" ? paperResetMutation : liveResetMutation;

	// stopLoss: paper from /paper-stats, live from WS/state snapshot
	const stopLoss = viewMode === "paper" ? state?.stopLoss : state?.liveStopLoss;
	const todayStats = viewMode === "paper" ? state?.todayStats : state?.liveTodayStats;

	if (!state) {
		return null; // Loading state handled by App.tsx
	}

	return (
		<AppErrorBoundary>
			<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-safe">
				<OverviewTab
					stopLoss={stopLoss}
					viewMode={viewMode}
					todayStats={todayStats}
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
