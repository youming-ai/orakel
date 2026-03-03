import { AlertTriangle, DollarSign, Hash, RotateCcw, Target, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiquidGlassPanel } from "@/components/ui/liquid-glass";
import type { MarketSnapshot, PaperStats, StopLossStatus, TodayStats } from "@/lib/api";
import { CHART_COLORS, CHART_HEIGHT, TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR_STYLE } from "@/lib/charts";
import { asNumber, fmtDateTime, fmtTime } from "@/lib/format";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChartErrorBoundary } from "../ChartErrorBoundary";
import { EmptyPlaceholder } from "../EmptyPlaceholder";
import { OverviewSkeleton } from "../OverviewSkeleton";
import { MarketCard } from "../MarketCard";
import { StatCard } from "../StatCard";

// Add a starting point (cumulative = 0) to make chart animation start from zero line
const addTimelineStartPoint = <T extends { cumulative: number }>(
	timeline: T[],
): Array<T & { isFirst: boolean }> => {
	if (timeline.length === 0) return [];
	// Create a starting point with cumulative = 0 at the time of the first trade
	const firstPoint = timeline[0];
	return [
		{
			...firstPoint,
			cumulative: 0,
			pnl: 0,
			isFirst: true,
		} as T & { isFirst: boolean },
		...timeline.map((item) => ({ ...item, isFirst: false })),
	];
};

interface OverviewTabProps {
	stopLoss?: StopLossStatus;
	viewMode: ViewMode;
	todayStats?: TodayStats;
	clearStopMutation: {
		mutate: () => void;
		isPending: boolean;
	};
	resetMutation: {
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

export function OverviewTab({
	stopLoss,
	viewMode,
	todayStats,
	clearStopMutation,
	resetMutation,
	mergedStats,
	pnlTimeline,
	timelinePositive,
	markets,
}: OverviewTabProps) {
	const sortedMarkets = useMemo(() => {
		const marketOrder = ["BTC", "ETH", "SOL", "XRP"];
		return [...markets].sort((a, b) => {
			const aIndex = marketOrder.indexOf(a.id);
			const bIndex = marketOrder.indexOf(b.id);
			if (aIndex === -1 && bIndex === -1) return 0;
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		});
	}, [markets]);

	// Add starting point for smooth chart animation
	const chartData = useMemo(() => addTimelineStartPoint(pnlTimeline), [pnlTimeline]);

	if (mergedStats.totalTrades === 0 && markets.length === 0) {
		return <OverviewSkeleton />;
	}
	return (
		<div className="space-y-4">
			{/* Stop Loss Warning */}
			{stopLoss?.stoppedAt && (
				<LiquidGlassPanel className="border-red-500/30 bg-red-500/5">
					<div className="p-3">
						<div className="flex items-center gap-3">
							<AlertTriangle className="size-5 text-red-400" />
							<div className="flex-1">
								<p className="text-sm font-medium text-red-400">Trading Stopped</p>
								<p className="text-xs text-red-400/70">
									Reason: {stopLoss.reason} • Since {fmtTime(stopLoss.stoppedAt)}
								</p>
							</div>
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs border-red-400/50 text-red-400 hover:bg-red-400/10"
								onClick={() => clearStopMutation.mutate()}
								disabled={clearStopMutation.isPending}
							>
								{clearStopMutation.isPending ? "Resetting..." : "Reset & Resume"}
							</Button>
						</div>
					</div>
				</LiquidGlassPanel>
			)}

			{/* Today Stats & Stop Loss Status */}
			{todayStats && (
				<LiquidGlassPanel className="border-white/10 dark:border-white/5">
					<div className="p-3">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
							<div className="flex items-center gap-3 sm:gap-4 min-w-0">
								<div className="flex items-center gap-2 shrink-0">
									<Zap className="size-4 text-amber-400" />
									<span className="text-xs text-muted-foreground">Today</span>
								</div>
								<span
									className={cn(
										"font-mono text-sm font-medium",
										todayStats.pnl >= 0 ? "text-emerald-400" : "text-red-400",
									)}
								>
									{todayStats.pnl >= 0 ? "+" : ""}
									{todayStats.pnl.toFixed(2)} USDC
								</span>
								<span className="text-xs text-muted-foreground">
									{todayStats.trades} trade{todayStats.trades !== 1 ? "s" : ""}
								</span>
							</div>
							<div className="flex items-center gap-2 pl-6 sm:pl-0">
								<span className="text-xs text-muted-foreground shrink-0">Daily Limit:</span>
								<div className="w-24 h-2 bg-white/10 dark:bg-black/30 rounded-full overflow-hidden shrink-0">
									<div
										className={cn(
											"h-full rounded-full transition-all",
											todayStats.pnl >= 0
												? "bg-emerald-400"
												: Math.abs(todayStats.pnl) / todayStats.limit > 0.7
													? "bg-red-400"
													: "bg-amber-400",
										)}
										style={{
											width: `${Math.min(100, (Math.max(0, todayStats.limit + todayStats.pnl) / todayStats.limit) * 100)}%`,
										}}
									/>
								</div>
								<span className="text-xs text-muted-foreground">
									{((1 - Math.abs(todayStats.pnl) / todayStats.limit) * 100).toFixed(0)}%
								</span>
							</div>
						</div>
					</div>
				</LiquidGlassPanel>
			)}

			<div className="flex flex-col xl:flex-row gap-4">
				{/* Hero Stats */}
				<LiquidGlassPanel
					className={cn(
						"flex flex-col justify-center p-6 shrink-0 xl:w-72",
						mergedStats.totalPnl >= 0
							? "border-emerald-500/20"
							: "border-red-500/20",
					)}
				>
					<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
						<DollarSign className="size-4 opacity-70" />
						Total P&L
					</span>
					<span
						className={cn(
							"font-mono text-4xl sm:text-5xl font-black tracking-tighter truncate",
							mergedStats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
						)}
					>
						{mergedStats.totalPnl >= 0 ? "+" : ""}
						{mergedStats.totalPnl.toFixed(2)}
						<span className="text-sm sm:text-lg font-bold opacity-60 ml-2 tracking-wide uppercase block sm:inline-block">
							USDC
						</span>
					</span>
				</LiquidGlassPanel>

				{/* Standard Stats */}
				<LiquidGlassPanel className="flex-1 overflow-hidden">
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 h-full">
						<StatCard
						label="Trades"
						value={String(mergedStats.totalTrades)}
						icon={<Hash className="size-3.5" />}
					/>
						<StatCard
							label="Win Rate"
							value={mergedStats.wins + mergedStats.losses > 0 ? `${(mergedStats.winRate * 100).toFixed(1)}%` : "-"}
							color={mergedStats.winRate >= 0.5 ? "text-emerald-400" : mergedStats.winRate > 0 ? "text-red-400" : ""}
							icon={<Target className="size-3.5" />}
							trend={mergedStats.winRate >= 0.5 ? "up" : "down"}
						/>
						<StatCard
							label="Wins"
							value={String(mergedStats.wins)}
							color="text-emerald-400"
							icon={<TrendingUp className="size-3.5" />}
							trend="up"
						/>
						<StatCard
							label="Losses"
							value={String(mergedStats.losses)}
							color="text-red-400"
							icon={<TrendingDown className="size-3.5" />}
							trend="down"
						/>
					</div>
				</LiquidGlassPanel>
			</div>

			<LiquidGlassPanel>
				<div className="px-6 pb-2 pt-4">
					<div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cumulative P&L</div>
				</div>
				<div className={cn("px-6", CHART_HEIGHT.responsive)}>
					{pnlTimeline.length === 0 ? (
						<EmptyPlaceholder />
					) : (
						<ChartErrorBoundary>
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart
									data={chartData}
									animationDuration={750}
									animationEasing="ease-in-out"
								>
									<defs>
										<linearGradient id="timelineGrad" x1="0" y1="0" x2="0" y2="1">
											<stop
												offset="5%"
												stopColor={timelinePositive ? CHART_COLORS.positive : CHART_COLORS.negative}
												stopOpacity={0.35}
											/>
											<stop
												offset="95%"
												stopColor={timelinePositive ? CHART_COLORS.positive : CHART_COLORS.negative}
												stopOpacity={0}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
									<XAxis dataKey="time" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} minTickGap={24} />
									<YAxis
										tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
										tickFormatter={(v: number) => `${v.toFixed(1)}`}
										width={52}
									/>
									<ReferenceLine y={0} stroke={CHART_COLORS.axis} strokeDasharray="3 3" opacity={0.5} />
									<Tooltip
										cursor={TOOLTIP_CURSOR_STYLE}
										contentStyle={TOOLTIP_CONTENT_STYLE}
										labelFormatter={(_, payload) => {
											const row = payload?.[0]?.payload as
												| { ts: string; market: string; side: string; pnl: number; isFirst?: boolean }
												| undefined;
											if (!row) return "-";
											if (row.isFirst) return fmtDateTime(row.ts) + "  (Start)";
											return `${fmtDateTime(row.ts)}  ${row.market} ${row.side}`;
										}}
										formatter={(value, key, item) => {
											const v = asNumber(value, 0);
											const payload = item.payload as { pnl: number };
											if (String(key) === "cumulative")
												return [`${v >= 0 ? "+" : ""}${v.toFixed(2)} USDC`, "Cumulative P&L"];
											return [`${payload.pnl >= 0 ? "+" : ""}${payload.pnl.toFixed(2)} USDC`, "Per-Trade P&L"];
										}}
									/>
									<Area
										type="monotone"
										dataKey="cumulative"
										stroke={timelinePositive ? CHART_COLORS.positive : CHART_COLORS.negative}
										fill="url(#timelineGrad)"
										strokeWidth={2}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</ChartErrorBoundary>
					)}
				</div>
			</LiquidGlassPanel>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{sortedMarkets.map((m) => (
					<MarketCard key={m.id} market={m} />
				))}
			</div>
			{/* Reset Data */}
			<div className="flex justify-end">
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-xs text-muted-foreground hover:text-red-400 hover:border-red-400/50 hover:bg-red-400/10 gap-1.5"
					onClick={() => resetMutation.mutate()}
					disabled={resetMutation.isPending}
				>
					<RotateCcw className={cn("size-3", resetMutation.isPending && "animate-spin")} />
					{resetMutation.isPending ? "Resetting..." : `Reset ${viewMode === "paper" ? "Paper" : "Live"} Data`}
				</Button>
			</div>
		</div>
	);
}
