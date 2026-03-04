import { LayoutDashboard, List } from "lucide-react";
import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
	MarketBreakdown,
	MarketSnapshot,
	PaperStats,
	PaperTradeEntry,
	StopLossStatus,
	TodayStats,
	TradeRecord,
} from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { usePaperClearStop } from "@/lib/queries";
import { buildMarketFromTrades, buildPnlTimeline, buildStatsFromTrades } from "@/lib/stats";
import type { MarketRow, ViewMode } from "@/lib/types";

import { OverviewTab } from "./analytics/OverviewTab";
import { TradesTab } from "./analytics/TradesTab";

interface AnalyticsTabsProps {
	trades: PaperTradeEntry[];
	byMarket?: Record<string, MarketBreakdown>;
	markets: MarketSnapshot[];
	liveTrades: TradeRecord[];
	viewMode: ViewMode;
	stopLoss?: StopLossStatus;
	todayStats?: TodayStats;
}


export function AnalyticsTabs({
	trades,
	byMarket,
	markets,
	liveTrades,
	viewMode,
	stopLoss,
	todayStats,
}: AnalyticsTabsProps) {
	const clearStopMutation = usePaperClearStop();

	const mergedStats = useMemo(() => buildStatsFromTrades(trades), [trades]);

	const marketStats = useMemo(() => {
		const client = buildMarketFromTrades(trades);
		if (Object.keys(client).length > 0) return client;
		return byMarket ?? {};
	}, [byMarket, trades]);

	const pnlTimeline = useMemo(() => buildPnlTimeline(trades), [trades]);

	const timelinePositive = (pnlTimeline[pnlTimeline.length - 1]?.cumulative ?? 0) >= 0;

	const marketRows = useMemo((): MarketRow[] => {
		return Object.entries(marketStats)
			.map(([market, item]) => ({
				market,
				trades: item.tradeCount,
				wins: item.wins,
				losses: item.losses,
				pending: item.pending,
				winRate: item.winRate,
				winRatePct: Number((item.winRate * 100).toFixed(1)),
				pnl: Number(item.totalPnl.toFixed(2)),
				resolvedCount: item.wins + item.losses,
			}))
			.sort((a, b) => b.pnl - a.pnl);
	}, [marketStats]);

	return (
		<Tabs defaultValue="overview" className="space-y-4">
			<div className="relative overflow-hidden -mx-3 px-3 sm:mx-0 sm:px-0">
				<div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none z-10 sm:hidden" />
				<div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10 sm:hidden" />
				<div className="overflow-x-auto scrollbar-hide py-1">
					<TabsList className="w-max min-w-full sm:w-auto h-11 border-b-0">
						<TabsTrigger value="overview">
							<LayoutDashboard className="size-3.5 mr-1.5" /> Overview
						</TabsTrigger>
						<TabsTrigger value="trades">
							<List className="size-3.5 mr-1.5" /> Trades
						</TabsTrigger>
					</TabsList>
				</div>
			</div>

			<TabsContent value="overview" className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
				<OverviewTab
					stopLoss={stopLoss}
					viewMode={viewMode}
					todayStats={todayStats}
					clearStopMutation={clearStopMutation}
					mergedStats={mergedStats}
					pnlTimeline={pnlTimeline}
					timelinePositive={timelinePositive}
					markets={markets}
				/>
			</TabsContent>

			<TabsContent value="trades" className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
				<TradesTab viewMode={viewMode} liveTrades={liveTrades} marketRows={marketRows} />
			</TabsContent>
		</Tabs>
	);
}
