import { useMemo } from "react";
import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { OverviewTab } from "@/components/analytics/OverviewTab";
import { TradesTab } from "@/components/analytics/TradesTab";
import { OverviewSkeleton } from "@/components/OverviewSkeleton";
import { useLiveStats, usePaperStats } from "@/entities/account/queries";
import { useTrades } from "@/entities/trade/queries";
import { buildPnlTimeline, buildStatsFromTrades } from "@/lib/stats";
import { useUIStore } from "@/lib/store";

export function DashboardPanel() {
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: state } = useDashboardStateWithWs();
	const { data: paperStatsData } = usePaperStats(viewMode === "paper");
	const { data: liveStatsData } = useLiveStats(viewMode === "live");
	const { data: trades = [] } = useTrades(viewMode);

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
				<div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
					<TradesTab viewMode={viewMode} liveTrades={trades} />
				</div>
			</main>
		</AppErrorBoundary>
	);
}
