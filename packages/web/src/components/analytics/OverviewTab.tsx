import { HeroPnlCard, SignalCard, StatsGrid, TodayStatsCard } from "@/components/cards";
import { PnlTimelineChart } from "@/components/charts";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketSnapshot, TodayStats } from "@/contracts/http";
import type { ExtendedStats } from "@/lib/stats";

interface OverviewTabProps {
	todayStats?: TodayStats;
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

export function OverviewTab({ todayStats, mergedStats, pnlTimeline, markets, updatedAt }: OverviewTabProps) {
	const signalMarket = markets[0];

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-4 xl:flex-row xl:items-start">
				<div className="flex flex-col gap-4 xl:flex-[3]">
					{signalMarket ? (
						<SignalCard market={signalMarket} />
					) : (
						<Card className="border-border/60 bg-muted/20 shadow-sm">
							<CardContent className="py-12 text-center text-sm text-muted-foreground">
								No market signal yet.
							</CardContent>
						</Card>
					)}
					<PnlTimelineChart timeline={pnlTimeline} />
				</div>

				<div className="flex flex-col gap-4 xl:flex-[2]">
					{todayStats && <TodayStatsCard todayStats={todayStats} stats={mergedStats} />}
					<HeroPnlCard
						totalPnl={mergedStats.totalPnl}
						bestTrade={mergedStats.bestTrade}
						worstTrade={mergedStats.worstTrade}
						profitFactor={mergedStats.profitFactor}
					/>
					<StatsGrid stats={mergedStats} />
				</div>
			</div>

			{updatedAt && (
				<div className="text-center text-[11px] text-muted-foreground/50 py-2">
					Last update: {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
				</div>
			)}
		</div>
	);
}
