import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PaperTradeEntry, TradeRecord } from "@/lib/api";
import { CHART_COLORS, CHART_HEIGHT, TOOLTIP_CONTENT_STYLE } from "@/lib/charts";
import { asNumber } from "@/lib/format";
import type { ViewMode } from "@/lib/types";
import { ChartErrorBoundary } from "../ChartErrorBoundary";
import { TradeTable } from "../TradeTable";
import { EmptyPlaceholder } from "./OverviewTab";

interface TradesTabProps {
	viewMode: ViewMode;
	trades: PaperTradeEntry[];
	liveTrades: TradeRecord[];
	tradesLength: number;
	timingData: Array<{
		name: string;
		count: number;
		wins: number;
		resolved: number;
		winRate: number;
	}>;
	sideTotal: number;
	sideData: Array<{
		name: string;
		value: number;
		color: string;
	}>;
}

export function TradesTab({
	viewMode,
	trades,
	liveTrades,
	tradesLength,
	timingData,
	sideTotal,
	sideData,
}: TradesTabProps) {
	return (
		<div className="space-y-4">
			{/* Timing & Direction Charts */}
			<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							Entry Timing Distribution
						</CardTitle>
					</CardHeader>
					<CardContent className={CHART_HEIGHT.responsive}>
						{tradesLength === 0 ? (
							<EmptyPlaceholder />
						) : (
							<ChartErrorBoundary>
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={timingData}>
										<CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
										<XAxis dataKey="name" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
										<YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={40} />
										<Tooltip
											contentStyle={TOOLTIP_CONTENT_STYLE}
											formatter={(value, _, item) => {
												const v = Math.round(asNumber(value, 0));
												const p = item.payload as {
													winRate: number;
													wins: number;
													resolved: number;
												};
												return [
													`${v} trades, WR ${(p.winRate * 100).toFixed(1)}% (${p.wins}/${p.resolved})`,
													"Entries",
												];
											}}
										/>
										<Bar dataKey="count" radius={[4, 4, 0, 0]}>
											{timingData.map((item) => (
												<Cell
													key={`timing-${item.name}`}
													fill={
														item.resolved === 0
															? CHART_COLORS.pending
															: item.winRate >= 0.5
																? CHART_COLORS.positive
																: CHART_COLORS.negative
													}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							</ChartErrorBoundary>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							Direction Distribution
						</CardTitle>
					</CardHeader>
					<CardContent className={CHART_HEIGHT.responsive}>
						{sideTotal === 0 ? (
							<EmptyPlaceholder />
						) : (
							<>
								<ChartErrorBoundary>
									<ResponsiveContainer width="100%" height="84%">
										<PieChart>
											<Pie
												data={sideData}
												dataKey="value"
												nameKey="name"
												innerRadius={56}
												outerRadius={90}
												paddingAngle={3}
												label={({ name, percent }) => `${name} ${(Number(percent) * 100).toFixed(0)}%`}
												labelLine={false}
												fontSize={11}
											>
												{sideData.map((item) => (
													<Cell key={`side-${item.name}`} fill={item.color} />
												))}
											</Pie>
											<Tooltip
												contentStyle={TOOLTIP_CONTENT_STYLE}
												formatter={(value) => {
													const v = Math.round(asNumber(value, 0));
													return [`${v} trades`, "Count"];
												}}
											/>
										</PieChart>
									</ResponsiveContainer>
								</ChartErrorBoundary>
								<div className="mt-2 flex items-center justify-center gap-3 text-xs">
									<Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 font-mono">
										UP {sideData[0].value}
									</Badge>
									<Badge variant="secondary" className="bg-red-500/15 text-red-400 font-mono">
										DOWN {sideData[1].value}
									</Badge>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Trade History */}
			<div>
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
					{viewMode === "paper" ? "Paper Trades" : "Live Trades"}
				</h2>
				<TradeTable trades={viewMode === "paper" ? trades : liveTrades} paperMode={viewMode === "paper"} />
			</div>
		</div>
	);
}
