import { useMemo } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { OverviewTab } from "@/components/analytics/OverviewTab";
import { OverviewSkeleton } from "@/components/OverviewSkeleton";
import { useDashboardStateWithWs, useLiveStats, usePaperStats } from "@/lib/queries";
import { buildPnlTimeline, buildStatsFromTrades } from "@/lib/stats";
import { useUIStore } from "@/lib/store";

export function OverviewPanel() {
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: state } = useDashboardStateWithWs();
	const { data: paperStatsData } = usePaperStats(viewMode === "paper");
	const { data: liveStatsData } = useLiveStats(viewMode === "live");
	const statsData = viewMode === "paper" ? paperStatsData : liveStatsData;
	const currentTrades = statsData?.trades ?? [];
	const mergedStats = useMemo(() => buildStatsFromTrades(currentTrades), [currentTrades]);
	const pnlTimeline = useMemo(() => buildPnlTimeline(currentTrades), [currentTrades]);
	const todayStats = viewMode === "paper" ? state?.todayStats : state?.liveTodayStats;

	if (!state) {
		return (
			<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-20 sm:pb-6">
				<OverviewSkeleton />
			</main>
		);
	}

	return (
		<AppErrorBoundary>
			<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-20 sm:pb-6">
				<OverviewTab
					todayStats={todayStats}
					mergedStats={mergedStats}
					pnlTimeline={pnlTimeline}
					markets={state.markets ?? []}
					updatedAt={state.updatedAt}
				/>
			</main>
		</AppErrorBoundary>
	);
}
