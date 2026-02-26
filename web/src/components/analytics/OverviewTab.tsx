import { useMemo } from "react";
import { AlertTriangle, DollarSign, Hash, Target, TrendingDown, TrendingUp, Zap, Activity } from "lucide-react";
import {
    Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "../StatCard";
import { MarketCard } from "../MarketCard";
import { ChartErrorBoundary } from "../ChartErrorBoundary";
import { CHART_COLORS, CHART_HEIGHT, TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR_STYLE } from "@/lib/charts";
import { asNumber, fmtDateTime, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketSnapshot, PaperStats, StopLossStatus, TodayStats } from "@/lib/api";
import type { ViewMode } from "@/lib/types";

interface OverviewTabProps {
    stopLoss?: StopLossStatus;
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

export function EmptyPlaceholder() {
    return (
        <div className="h-full w-full flex flex-col items-center justify-center p-6 text-muted-foreground bg-muted/5 rounded-lg border border-dashed border-border/50">
            <Activity className="size-8 mb-3 opacity-20" />
            <span className="text-[10px] font-medium uppercase tracking-widest opacity-60">Awaiting Signal</span>
        </div>
    );
}

export function OverviewTab({
    stopLoss,
    viewMode,
    todayStats,
    clearStopMutation,
    mergedStats,
    pnlTimeline,
    timelinePositive,
    markets,
}: OverviewTabProps) {
    const sortedMarkets = useMemo(() => {
        return [...markets].sort((a, b) => {
            if (a.phase === "ENTER" && b.phase !== "ENTER") return -1;
            if (b.phase === "ENTER" && a.phase !== "ENTER") return 1;
            return 0;
        });
    }, [markets]);

    return (
        <div className="space-y-4">
            {/* Stop Loss Warning */}
            {stopLoss?.stoppedAt && (
                <Card className="border-red-500/50 bg-red-500/10">
                    <CardContent className="py-3">
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
                    </CardContent>
                </Card>
            )}

            {/* Today Stats & Stop Loss Status */}
            {todayStats && (
                <Card className="border-border/50">
                    <CardContent className="py-3">
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
                                <div className="w-24 h-2 bg-muted/30 rounded-full overflow-hidden shrink-0">
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
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-col xl:flex-row gap-4">
                {/* Hero Stats */}
                <Card className={cn(
                    "flex flex-col justify-center p-6 border-border/60 shadow-sm shrink-0 xl:w-72",
                    mergedStats.totalPnl >= 0 ? "bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20" : "bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20"
                )}>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                        <DollarSign className="size-4 opacity-70" />
                        Total P&L
                    </span>
                    <span className={cn(
                        "font-mono text-4xl sm:text-5xl font-black tracking-tighter truncate",
                        mergedStats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
                    )}>
                        {mergedStats.totalPnl >= 0 ? "+" : ""}{mergedStats.totalPnl.toFixed(2)}
                        <span className="text-sm sm:text-lg font-bold opacity-60 ml-2 tracking-wide uppercase block sm:inline-block">USDC</span>
                    </span>
                </Card>

                {/* Standard Stats */}
                <Card className="flex-1 overflow-hidden border-border/60 shadow-sm">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px sm:gap-0 bg-border/60 sm:bg-card sm:divide-x sm:divide-border/60 h-full">
                        <StatCard
                            label="Trades"
                            value={String(mergedStats.totalTrades)}
                            icon={<Hash className="size-3.5" />}
                            trend="neutral"
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
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                        Cumulative P&L
                    </CardTitle>
                </CardHeader>
                <CardContent className={CHART_HEIGHT.responsive}>
                    {pnlTimeline.length === 0 ? (
                        <EmptyPlaceholder />
                    ) : (
                        <ChartErrorBoundary>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={pnlTimeline}>
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
                                    <XAxis
                                        dataKey="time"
                                        tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                                        minTickGap={24}
                                    />
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
                                                | { ts: string; market: string; side: string; pnl: number }
                                                | undefined;
                                            if (!row) return "-";
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
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sortedMarkets.map((m) => (
                    <MarketCard key={m.id} market={m} />
                ))}
            </div>
        </div>
    );
}
