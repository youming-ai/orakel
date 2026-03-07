import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { EmptyPlaceholder } from "@/components/EmptyPlaceholder";
import { Card } from "@/components/ui/card";
import {
	addTimelineStartPoint,
	CHART_COLORS,
	CHART_HEIGHT,
	TOOLTIP_CONTENT_STYLE,
	TOOLTIP_CURSOR_STYLE,
} from "@/lib/charts";
import { asNumber, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PnlTimelineChartProps {
	timeline: Array<{
		ts: string;
		time: string;
		market: string;
		side: string | null;
		pnl: number;
		cumulative: number;
	}>;
}

export function PnlTimelineChart({ timeline }: PnlTimelineChartProps) {
	const chartData = useMemo(() => addTimelineStartPoint(timeline), [timeline]);
	const isPositive = (timeline[timeline.length - 1]?.cumulative ?? 0) >= 0;

	if (timeline.length === 0) {
		return (
			<Card className="shadow-sm">
				<div className="px-6 pb-2 pt-4">
					<div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cumulative P&L</div>
				</div>
				<div className={cn("px-6", CHART_HEIGHT.responsive)}>
					<EmptyPlaceholder />
				</div>
			</Card>
		);
	}

	return (
		<Card className="shadow-sm">
			<div className="px-6 pb-2 pt-4">
				<div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cumulative P&L</div>
			</div>
			<div className={cn("px-6", CHART_HEIGHT.responsive)}>
				<ChartErrorBoundary>
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={chartData}>
							<defs>
								<linearGradient id="timelineGrad" x1="0" y1="0" x2="0" y2="1">
									<stop
										offset="5%"
										stopColor={isPositive ? CHART_COLORS.positive : CHART_COLORS.negative}
										stopOpacity={0.35}
									/>
									<stop
										offset="95%"
										stopColor={isPositive ? CHART_COLORS.positive : CHART_COLORS.negative}
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
								stroke={isPositive ? CHART_COLORS.positive : CHART_COLORS.negative}
								fill="url(#timelineGrad)"
								strokeWidth={2}
							/>
						</AreaChart>
					</ResponsiveContainer>
				</ChartErrorBoundary>
			</div>
		</Card>
	);
}
