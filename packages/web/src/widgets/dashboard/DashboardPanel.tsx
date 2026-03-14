import {
	ArrowLeftRight,
	BarChart3,
	LineChart,
	Percent,
	Scale,
	Target,
	TrendingDown,
	TrendingUp,
	Wallet,
	Zap,
} from "lucide-react";
import { useMemo } from "react";
import { useDashboardStateWithWs } from "@/app/ws/useDashboardStateWithWs";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SignalCard } from "@/components/cards/SignalCard";
import { PnlTimelineChart } from "@/components/charts";
import { OverviewSkeleton } from "@/components/OverviewSkeleton";
import { TradeTable } from "@/components/TradeTable";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
						<Card className="border-dashed">
							<CardContent className="py-12 text-center">
								<BarChart3 className="mx-auto size-8 text-muted-foreground mb-3" />
								<p className="text-sm text-muted-foreground">No active market signal</p>
								<p className="text-xs text-muted-foreground/60 mt-1">Waiting for next trading window...</p>
							</CardContent>
						</Card>
					)}
				</section>

				<section>
					<PnlTimelineChart timeline={pnlTimeline} />
				</section>

				<section>
					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<CardTitle className="flex items-center gap-2 text-sm font-semibold">
									<ArrowLeftRight className="size-4 text-muted-foreground" />
									Trade History
								</CardTitle>
								<Badge variant="secondary" className="text-xs">
									{trades.length} trades
								</Badge>
							</div>
						</CardHeader>
						<CardContent className="pt-0">
							<TradeTable trades={trades} paperMode={viewMode === "paper"} />
						</CardContent>
					</Card>
				</section>

				{state.updatedAt && (
					<div className="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground/50">
						<span>Last update</span>
						<span className="font-mono">
							{new Date(state.updatedAt).toLocaleTimeString("en-US", { hour12: false })}
						</span>
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

	const isProfitable = stats.totalPnl >= 0;

	return (
		<Card>
			<CardContent className="p-3 sm:p-5">
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2">
						<div className={cn("p-1.5 rounded-md", viewMode === "paper" ? "bg-amber-500/10" : "bg-emerald-500/10")}>
							<Zap className={cn("size-4", viewMode === "paper" ? "text-amber-500" : "text-emerald-500")} />
						</div>
						<span className="text-sm font-semibold">{viewMode === "paper" ? "Paper Trading" : "Live Trading"}</span>
					</div>
					{todayStats && (
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
							<span>Today</span>
							<span className="text-border">·</span>
							<span className="font-mono">{todayStats.trades}</span>
							<span>trade{todayStats.trades !== 1 ? "s" : ""}</span>
						</div>
					)}
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<div
						className={cn(
							"col-span-2 sm:col-span-1 flex flex-col justify-center p-3 sm:p-4 rounded-lg border",
							isProfitable ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20",
						)}
					>
						<div className="flex items-center gap-1.5 mb-1">
							<Wallet className="size-3 text-muted-foreground" />
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Today P&L</span>
						</div>
						<span
							className={cn(
								"font-mono text-2xl sm:text-3xl font-bold tracking-tight",
								isProfitable ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
							)}
						>
							{todayStats ? `${todayStats.pnl >= 0 ? "+" : ""}${todayStats.pnl.toFixed(2)}` : "--"}
						</span>
						<span className="text-[10px] text-muted-foreground mt-0.5">USDC</span>
					</div>

					<div className="flex flex-col justify-center p-3 rounded-lg bg-muted/50">
						<div className="flex items-center gap-1.5 mb-1.5">
							<Percent className="size-3 text-muted-foreground" />
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Win Rate</span>
						</div>
						<div className="flex items-baseline gap-2">
							<span
								className={cn(
									"font-mono text-xl font-bold",
									winRate && Number(winRate) >= 50
										? "text-emerald-600 dark:text-emerald-400"
										: "text-red-600 dark:text-red-400",
								)}
							>
								{winRate ? `${winRate}%` : "--"}
							</span>
						</div>
						{resolvedTrades > 0 && (
							<div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
								<span className="text-emerald-600 dark:text-emerald-400 font-medium">{stats.wins}W</span>
								<span>/</span>
								<span className="text-red-600 dark:text-red-400 font-medium">{stats.losses}L</span>
							</div>
						)}
					</div>

					<div className="flex flex-col justify-center p-3 rounded-lg bg-muted/50">
						<div className="flex items-center gap-1.5 mb-1.5">
							<LineChart className="size-3 text-muted-foreground" />
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total P&L</span>
						</div>
						<span
							className={cn(
								"font-mono text-xl font-bold",
								stats.totalPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
							)}
						>
							{resolvedTrades > 0 ? `${stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}` : "--"}
						</span>
					</div>

					{todayStats ? (
						<div className="flex flex-col justify-center p-3 rounded-lg bg-muted/50">
							<div className="flex items-center gap-1.5 mb-2">
								<Scale className="size-3 text-muted-foreground" />
								<span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
									Daily Limit
								</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
									<div
										className={cn(
											"h-full rounded-full transition-all duration-500",
											todayStats.pnl >= 0 ? "bg-emerald-500" : limitRemaining < 30 ? "bg-red-500" : "bg-amber-500",
										)}
										style={{ width: `${limitRemaining}%` }}
									/>
								</div>
								<span className="text-xs font-mono font-medium tabular-nums">{limitRemaining.toFixed(0)}%</span>
							</div>
						</div>
					) : (
						<div className="flex flex-col justify-center p-3 rounded-lg bg-muted/50">
							<div className="flex items-center gap-1.5 mb-1.5">
								<Scale className="size-3 text-muted-foreground" />
								<span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
									Daily Limit
								</span>
							</div>
							<span className="font-mono text-xl font-bold">--</span>
						</div>
					)}
				</div>

				{resolvedTrades > 0 && (
					<div className="grid grid-cols-3 sm:flex sm:flex-wrap sm:justify-center gap-2 sm:gap-x-6 gap-y-2 mt-4 pt-4 border-t">
						<StatItem
							icon={<TrendingUp className="size-3" />}
							label="Best"
							value={`+${stats.bestTrade.toFixed(2)}`}
							variant="positive"
						/>
						<StatItem
							icon={<TrendingDown className="size-3" />}
							label="Worst"
							value={stats.worstTrade.toFixed(2)}
							variant="negative"
						/>
						<StatItem
							icon={<Target className="size-3" />}
							label="Avg"
							value={`${stats.avgPnl >= 0 ? "+" : ""}${stats.avgPnl.toFixed(2)}`}
							variant={stats.avgPnl >= 0 ? "positive" : "negative"}
						/>
						<StatItem
							label="PF"
							value={stats.profitFactor >= 999 ? "∞" : stats.profitFactor.toFixed(2)}
							variant={stats.profitFactor >= 1.5 ? "positive" : stats.profitFactor >= 1 ? "warning" : "negative"}
						/>
						{stats.streak !== 0 && (
							<StatItem
								label="Streak"
								value={stats.streak > 0 ? `${stats.streak}W` : `${Math.abs(stats.streak)}L`}
								variant={stats.streak > 0 ? "positive" : "negative"}
							/>
						)}
						{stats.pending > 0 && (
							<div className="flex items-center gap-1.5 text-xs">
								<span className="relative flex h-2 w-2">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
									<span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
								</span>
								<span className="font-mono font-medium text-amber-600 dark:text-amber-400">
									{stats.pending} pending
								</span>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

interface StatItemProps {
	icon?: React.ReactNode;
	label: string;
	value: string;
	variant: "positive" | "negative" | "warning" | "neutral";
}

function StatItem({ icon, label, value, variant }: StatItemProps) {
	const variantStyles = {
		positive: "text-emerald-600 dark:text-emerald-400",
		negative: "text-red-600 dark:text-red-400",
		warning: "text-amber-600 dark:text-amber-400",
		neutral: "text-foreground",
	};

	return (
		<div className="flex items-center gap-1.5 text-xs">
			{icon && <span className={variantStyles[variant]}>{icon}</span>}
			<span className="text-muted-foreground">{label}</span>
			<span className={cn("font-mono font-medium tabular-nums", variantStyles[variant])}>{value}</span>
		</div>
	);
}
