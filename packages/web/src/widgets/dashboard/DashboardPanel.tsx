import { TrendingDown, TrendingUp, Zap } from "lucide-react";
import { useMemo } from "react";
import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SignalCard } from "@/components/cards/SignalCard";
import { PnlTimelineChart } from "@/components/charts";
import { OverviewSkeleton } from "@/components/OverviewSkeleton";
import { TradeTable } from "@/components/TradeTable";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLiveStats, usePaperStats } from "@/entities/account/queries";
import { useTrades } from "@/entities/trade/queries";
import { buildPnlTimeline, buildStatsFromTrades } from "@/lib/stats";
import { useUIStore } from "@/lib/store";
import { cn } from "@/lib/utils";

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
	const signalMarket = state?.markets?.[0];

	if (!state) {
		return (
			<main className="p-3 sm:p-6 max-w-5xl mx-auto pb-20 sm:pb-6">
				<OverviewSkeleton />
			</main>
		);
	}

	return (
		<AppErrorBoundary>
			<main className="p-2 sm:p-6 max-w-5xl mx-auto pb-16 sm:pb-6 space-y-3 sm:space-y-6">
				<section>
					<TodayPerformanceCard todayStats={todayStats} stats={mergedStats} viewMode={viewMode} />
				</section>

				<section>
					{signalMarket ? (
						<SignalCard market={signalMarket} />
					) : (
						<Card className="border-border/60 bg-muted/20 shadow-sm">
							<CardContent className="py-8 sm:py-12 text-center text-sm text-muted-foreground">
								No market signal yet.
							</CardContent>
						</Card>
					)}
				</section>

				<section>
					<Card className="shadow-sm">
						<CardContent className="p-3 sm:p-6">
							<div className="flex items-center justify-between mb-3 sm:mb-4">
								<h2 className="text-xs sm:text-sm font-semibold text-foreground">Trade History</h2>
								<Badge variant="secondary" className="text-[10px]">
									{trades.length} trades
								</Badge>
							</div>
							<TradeTable trades={trades} paperMode={viewMode === "paper"} />
						</CardContent>
					</Card>
				</section>

				<section>
					<PnlTimelineChart timeline={pnlTimeline} />
				</section>

				{state.updatedAt && (
					<div className="text-center text-[10px] sm:text-[11px] text-muted-foreground/50 py-1">
						Last update: {new Date(state.updatedAt).toLocaleTimeString("en-US", { hour12: false })}
					</div>
				)}
			</main>
		</AppErrorBoundary>
	);
}

interface TodayPerformanceCardProps {
	todayStats?: { pnl: number; trades: number; limit: number };
	stats: ReturnType<typeof buildStatsFromTrades>;
	viewMode: "paper" | "live";
}

function TodayPerformanceCard({ todayStats, stats, viewMode }: TodayPerformanceCardProps) {
	const resolvedTrades = stats.wins + stats.losses;
	const winRate = resolvedTrades > 0 ? (stats.winRate * 100).toFixed(0) : null;
	const limitRemaining = todayStats ? Math.max(0, (1 - Math.abs(todayStats.pnl) / todayStats.limit) * 100) : 100;

	return (
		<Card className="shadow-sm">
			<CardContent className="p-3 sm:p-5">
				<div className="flex items-center justify-between mb-3 sm:mb-4">
					<div className="flex items-center gap-1.5 sm:gap-2">
						<Zap className="size-3.5 sm:size-4 text-amber-400" />
						<span className="text-xs sm:text-sm font-semibold text-foreground">
							{viewMode === "paper" ? "Paper Trading" : "Live Trading"}
						</span>
					</div>
					{todayStats && (
						<span className="text-[10px] sm:text-xs text-muted-foreground">
							Today · {todayStats.trades} trade{todayStats.trades !== 1 ? "s" : ""}
						</span>
					)}
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
					<div className="col-span-2 sm:col-span-1 flex flex-col justify-center p-2.5 sm:p-4 rounded-lg bg-muted/30 border border-border/30">
						<span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 sm:mb-1">
							Today P&L
						</span>
						<span
							className={cn(
								"font-mono text-xl sm:text-3xl font-black tracking-tight",
								todayStats && todayStats.pnl >= 0 ? "text-emerald-400" : "text-red-400",
							)}
						>
							{todayStats ? `${todayStats.pnl >= 0 ? "+" : ""}${todayStats.pnl.toFixed(2)}` : "--"}
							<span className="text-[10px] sm:text-xs font-medium opacity-60 ml-1">USDC</span>
						</span>
					</div>

					<div className="flex flex-col justify-center p-2.5 sm:p-3 rounded-lg bg-muted/20 border border-border/20">
						<span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 sm:mb-1">
							Win Rate
						</span>
						<div className="flex items-baseline gap-1.5 sm:gap-2">
							<span
								className={cn(
									"font-mono text-lg sm:text-xl font-bold",
									winRate && Number(winRate) >= 50 ? "text-emerald-400" : "text-red-400",
								)}
							>
								{winRate ? `${winRate}%` : "--"}
							</span>
							{resolvedTrades > 0 && (
								<span className="text-[9px] sm:text-[10px] text-muted-foreground">
									{stats.wins}W/{stats.losses}L
								</span>
							)}
						</div>
					</div>

					<div className="flex flex-col justify-center p-2.5 sm:p-3 rounded-lg bg-muted/20 border border-border/20">
						<span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 sm:mb-1">
							Total P&L
						</span>
						<span
							className={cn(
								"font-mono text-lg sm:text-xl font-bold",
								stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
							)}
						>
							{resolvedTrades > 0 ? `${stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}` : "--"}
						</span>
					</div>

					{todayStats && (
						<div className="flex flex-col justify-center p-2.5 sm:p-3 rounded-lg bg-muted/20 border border-border/20">
							<span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 sm:mb-1">
								Daily Limit
							</span>
							<div className="flex items-center gap-1.5 sm:gap-2">
								<div className="flex-1 h-1.5 sm:h-2 bg-muted/50 rounded-full overflow-hidden">
									<div
										className={cn(
											"h-full rounded-full transition-all duration-500",
											todayStats.pnl >= 0 ? "bg-emerald-400" : limitRemaining < 30 ? "bg-red-400" : "bg-amber-400",
										)}
										style={{ width: `${limitRemaining}%` }}
									/>
								</div>
								<span
									className={cn(
										"text-[10px] sm:text-xs font-mono",
										limitRemaining < 30 && todayStats.pnl < 0 ? "text-red-400" : "text-muted-foreground",
									)}
								>
									{limitRemaining.toFixed(0)}%
								</span>
							</div>
						</div>
					)}
				</div>

				{resolvedTrades > 0 && (
					<div className="grid grid-cols-3 justify-items-center sm:flex sm:flex-wrap sm:items-center sm:justify-center gap-2 sm:gap-6 mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-border/30 text-[10px] sm:text-xs">
						<div className="flex items-center gap-1">
							<TrendingUp className="size-3 text-emerald-400" />
							<span className="text-muted-foreground">Best</span>
							<span className="font-mono font-medium text-emerald-400">+{stats.bestTrade.toFixed(2)}</span>
						</div>
						<div className="flex items-center gap-1">
							<TrendingDown className="size-3 text-red-400" />
							<span className="text-muted-foreground">Worst</span>
							<span className="font-mono font-medium text-red-400">{stats.worstTrade.toFixed(2)}</span>
						</div>
						<div className="flex items-center gap-1">
							<span className="text-muted-foreground">Avg</span>
							<span className={cn("font-mono font-medium", stats.avgPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
								{stats.avgPnl >= 0 ? "+" : ""}
								{stats.avgPnl.toFixed(2)}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<span className="text-muted-foreground">PF</span>
							<span
								className={cn(
									"font-mono font-medium",
									stats.profitFactor >= 1.5
										? "text-emerald-400"
										: stats.profitFactor >= 1
											? "text-amber-400"
											: "text-red-400",
								)}
							>
								{stats.profitFactor >= 999 ? "∞" : stats.profitFactor.toFixed(2)}
							</span>
						</div>
						{stats.streak !== 0 && (
							<div className="flex items-center gap-1">
								<span className="text-muted-foreground">Streak</span>
								<span className={cn("font-mono font-medium", stats.streak > 0 ? "text-emerald-400" : "text-red-400")}>
									{stats.streak > 0 ? `${stats.streak}W` : `${Math.abs(stats.streak)}L`}
								</span>
							</div>
						)}
						{stats.pending > 0 && (
							<div className="flex items-center gap-1">
								<span className="text-amber-400 font-mono font-medium">{stats.pending} pending</span>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
