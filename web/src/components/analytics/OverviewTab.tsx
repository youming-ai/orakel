import { useMemo } from "react";
import { HeroPnlCard, MarketCard, StatsGrid, StopLossCard, TodayStatsCard } from "@/components/cards";
import { PnlTimelineChart } from "@/components/charts";
import { OverviewSkeleton } from "@/components/OverviewSkeleton";
import type { MarketSnapshot, PaperStats, StopLossStatus, TodayStats } from "@/contracts/http";
import type { ViewMode } from "@/lib/types";

interface OverviewTabProps {
	stopLoss?: StopLossStatus | null;
	viewMode: ViewMode;
	todayStats?: TodayStats;
	clearStopMutation: {
		mutate: () => void;
		isPending: boolean;
	};
	mergedStats: PaperStats;
	pnlTimeline: Array<{
		ts: string;
		time: string;
		market: string;
		side: string | null;
		pnl: number;
		cumulative: number;
	}>;
	timelinePositive: boolean;
	markets: MarketSnapshot[];
}

const MARKET_ORDER = ["BTC-15m", "ETH-15m"];

export function OverviewTab({
	stopLoss,
	viewMode: _viewMode,
	todayStats,
	clearStopMutation,
	mergedStats,
	pnlTimeline,
	timelinePositive: _timelinePositive,
	markets,
}: OverviewTabProps) {
	const sortedMarkets = useMemo(() => {
		return [...markets].sort((a, b) => {
			const aIndex = MARKET_ORDER.indexOf(a.id);
			const bIndex = MARKET_ORDER.indexOf(b.id);
			if (aIndex === -1 && bIndex === -1) return 0;
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		});
	}, [markets]);

	if (mergedStats.totalTrades === 0 && markets.length === 0) {
		return <OverviewSkeleton />;
	}

	return (
		<div className="space-y-4">
			<StopLossCard stopLoss={stopLoss} onReset={clearStopMutation.mutate} isPending={clearStopMutation.isPending} />

			{todayStats && <TodayStatsCard todayStats={todayStats} />}

			<div className="flex flex-col xl:flex-row gap-4">
				<HeroPnlCard totalPnl={mergedStats.totalPnl} />
				<StatsGrid stats={mergedStats} />
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
				{sortedMarkets.map((m) => (
					<MarketCard key={m.id} market={m} />
				))}
			</div>

			<PnlTimelineChart timeline={pnlTimeline} />
		</div>
	);
}
