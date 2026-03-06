import { AlertTriangle, DollarSign, Hash, Target, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { MarketSnapshot, PaperStats, StopLossStatus, TodayStats } from "@/contracts/http";
import { CHART_COLORS, CHART_HEIGHT, TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR_STYLE } from "@/lib/charts";
import { asNumber, fmtDateTime, fmtTime } from "@/lib/format";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChartErrorBoundary } from "../ChartErrorBoundary";
import { EmptyPlaceholder } from "../EmptyPlaceholder";
import { MarketCard } from "../MarketCard";
import { OverviewSkeleton } from "../OverviewSkeleton";
import { StatCard } from "../StatCard";

// Add a starting point (cumulative = 0) to make chart animation start from zero line
const addTimelineStartPoint = <T extends { cumulative: number }>(timeline: T[]): Array<T & { isFirst: boolean }> => {
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

export function OverviewTab({
	stopLoss,
	viewMode: _viewMode,
	todayStats,
	clearStopMutation,
	mergedStats,
	pnlTimeline,
	timelinePositive,
	markets,
}: OverviewTabProps) {
	const sortedMarkets = useMemo(() => {
		const marketOrder = ["BTC-5m", "BTC-15m", "BTC-1h", "BTC-4h"];
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
				<Card className="border-red-500/30 bg-red-500/5 shadow-sm">
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
				</Card>
			)}

			{/* Today Stats & Stop Loss Status */}
			{todayStats && (
				<Card className="border-border/50 shadow-sm">
					<div className="p-3">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
							<div className="flex items-center justify-between gap-3 sm:gap-4 min-w-0">
								<div className="flex items-center gap-2 sm:gap-3 min-w-0">
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
								<span className="shrink-0 text-xs text-muted-foreground">
									{todayStats.trades} trade{todayStats.trades !== 1 ? "s" : ""}
								</span>
							</div>
							<div className="flex items-center gap-2 w-full sm:w-auto">
								<span className="text-xs text-muted-foreground shrink-0">Daily Limit:</span>
								<div className="h-2 w-full sm:w-24 bg-muted/30 rounded-full overflow-hidden">
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
				</Card>
			)}

			<div className="flex flex-col xl:flex-row gap-4">
				{/* Hero Stats */}
				<Card
					className={cn(
						"flex flex-col justify-center p-6 shrink-0 xl:w-72 shadow-sm",
						mergedStats.totalPnl >= 0 ? "border-emerald-500/20" : "border-red-500/20",
					)}
				>
					<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
						<DollarSign className="size-4 opacity-70" />
						Total P&L
					</span>
					<span
						className={cn(
							"font-mono text-3xl sm:text-5xl font-black tracking-tighter truncate",
							mergedStats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
						)}
					>
						{mergedStats.totalPnl >= 0 ? "+" : ""}
						{mergedStats.totalPnl.toFixed(2)}
						<span className="text-sm sm:text-lg font-bold opacity-60 ml-2 tracking-wide uppercase block sm:inline-block">
							USDC
						</span>
					</span>
				</Card>

				{/* Standard Stats */}
				<Card className="flex-1 overflow-hidden shadow-sm">
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-4 h-full">
						<StatCard label="Trades" value={String(mergedStats.totalTrades)} icon={<Hash className="size-3.5" />} />
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
				</Card>
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
				{sortedMarkets.map((m) => (
					<MarketCard key={m.id} market={m} />
				))}
			</div>

			<Card className="shadow-sm">
				<div className="px-6 pb-2 pt-4">
					<div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cumulative P&L</div>
				</div>
				<div className={cn("px-6", CHART_HEIGHT.responsive)}>
					{pnlTimeline.length === 0 ? (
						<EmptyPlaceholder />
					) : (
						<ChartErrorBoundary>
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart data={chartData}>
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
									<XAxis dataKey="time" tick={{ fontSize: 10, fill: CHART_COLORS.axis }} minTickGap={32} />
									<YAxis
										tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
										tickFormatter={(v: number) => `${v.toFixed(1)}`}
										width={44}
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
											if (row.isFirst) return `${fmtDateTime(row.ts)}  (Start)`;
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
			</Card>
		</div>
	);
}
