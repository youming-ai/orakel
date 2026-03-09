import { useMemo } from "react";
import { HeroPnlCard, MarketCard, StatsGrid, StopLossCard, TodayStatsCard } from "@/components/cards";
import { PnlTimelineChart } from "@/components/charts";
import { OverviewSkeleton } from "@/components/OverviewSkeleton";
import type { MarketSnapshot, StopLossStatus, TodayStats } from "@/contracts/http";
import type { ExtendedStats } from "@/lib/stats";

interface OverviewTabProps {
	stopLoss?: StopLossStatus | null;
	todayStats?: TodayStats;
	clearStopMutation: {
		mutate: () => void;
		isPending: boolean;
	};
	mergedStats: ExtendedStats;
	pnlTimeline: Array<{
		ts: string;
		time: string;
		market: string;
		side: string | null;
		pnl: number;
		cumulative: number;
	}>;
	markets: MarketSnapshot[];
	updatedAt?: string;
}

const MARKET_ORDER = ["BTC-15m", "ETH-15m"];

export function OverviewTab({
	stopLoss,
	todayStats,
	clearStopMutation,
	mergedStats,
	pnlTimeline,
	markets,
	updatedAt,
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

			{todayStats && <TodayStatsCard todayStats={todayStats} stats={mergedStats} />}

			<div className="flex flex-col xl:flex-row xl:items-stretch gap-4">
				<HeroPnlCard
					totalPnl={mergedStats.totalPnl}
					bestTrade={mergedStats.bestTrade}
					worstTrade={mergedStats.worstTrade}
					profitFactor={mergedStats.profitFactor}
				/>
				<StatsGrid stats={mergedStats} />
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
				{sortedMarkets.map((m) => (
					<MarketCard key={m.id} market={m} />
				))}
			</div>

			<PnlTimelineChart timeline={pnlTimeline} />

			{updatedAt && (
				<div className="text-center text-[11px] text-muted-foreground/50 py-2">
					Last update: {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
				</div>
			)}
		</div>
	);
}
