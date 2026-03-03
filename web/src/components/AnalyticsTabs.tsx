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
import { useLiveReset, usePaperClearStop, usePaperReset } from "@/lib/queries";
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

function buildStatsFromTrades(trades: PaperTradeEntry[]): PaperStats {
	let wins = 0;
	let losses = 0;
	let pending = 0;
	let totalPnl = 0;
	for (const trade of trades) {
		if (!trade.resolved) {
			pending += 1;
			continue;
		}
		if (trade.won) wins += 1;
		else losses += 1;
		totalPnl += trade.pnl ?? 0;
	}
	const resolved = wins + losses;
	return {
		totalTrades: trades.length,
		wins,
		losses,
		pending,
		winRate: resolved > 0 ? wins / resolved : 0,
		totalPnl: Number(totalPnl.toFixed(2)),
	};
}

function buildMarketFromTrades(trades: PaperTradeEntry[]): Record<string, MarketBreakdown> {
	const marketMap = new Map<string, MarketBreakdown>();
	for (const trade of trades) {
		const current = marketMap.get(trade.marketId) ?? {
			wins: 0,
			losses: 0,
			pending: 0,
			winRate: 0,
			totalPnl: 0,
			tradeCount: 0,
		};
		current.tradeCount += 1;
		if (!trade.resolved) current.pending += 1;
		else if (trade.won) current.wins += 1;
		else current.losses += 1;
		current.totalPnl += trade.pnl ?? 0;
		marketMap.set(trade.marketId, current);
	}

	const result: Record<string, MarketBreakdown> = {};
	for (const [market, item] of marketMap.entries()) {
		const resolved = item.wins + item.losses;
		result[market] = {
			...item,
			winRate: resolved > 0 ? item.wins / resolved : 0,
			totalPnl: Number(item.totalPnl.toFixed(2)),
		};
	}
	return result;
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
	const paperResetMutation = usePaperReset();
	const liveResetMutation = useLiveReset();
	const resetMutation = viewMode === "paper" ? paperResetMutation : liveResetMutation;

	const mergedStats = useMemo(() => buildStatsFromTrades(trades), [trades]);

	const marketStats = useMemo(() => {
		const client = buildMarketFromTrades(trades);
		if (Object.keys(client).length > 0) return client;
		return byMarket ?? {};
	}, [byMarket, trades]);

	const pnlTimeline = useMemo(() => {
		const resolved = trades
			.filter((t) => t.resolved && t.pnl !== null)
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		let running = 0;
		return resolved.map((trade) => {
			running += trade.pnl ?? 0;
			return {
				ts: trade.timestamp,
				time: fmtTime(trade.timestamp),
				market: trade.marketId,
				side: trade.side,
				pnl: trade.pnl ?? 0,
				cumulative: Number(running.toFixed(2)),
			};
		});
	}, [trades]);

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
					resetMutation={resetMutation}
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
