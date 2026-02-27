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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PaperTradeEntry, TradeRecord } from "@/lib/api";
import { CHART_COLORS, CHART_HEIGHT, TOOLTIP_CONTENT_STYLE } from "@/lib/charts";
import { asNumber } from "@/lib/format";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChartErrorBoundary } from "../ChartErrorBoundary";
import { TradeTable } from "../TradeTable";
import { TradingHeatmap } from "../TradingHeatmap";
import { EmptyPlaceholder } from "./OverviewTab";

interface MarketRow {
	market: string;
	trades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	winRatePct: number;
	pnl: number;
	resolvedCount: number;
}

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
	marketRows: MarketRow[];
}

export function TradesTab({
	viewMode,
	trades,
	liveTrades,
	tradesLength,
	timingData,
	sideTotal,
	sideData,
	marketRows,
}: TradesTabProps) {
	return (
		<div className="space-y-4">
			{/* Trade History — most important, at top */}
			<div>
				<h2 className="text-sm font-semibold text-foreground mb-3">
					{viewMode === "paper" ? "Paper Trades" : "Live Trades"}
				</h2>
				<TradeTable trades={liveTrades} paperMode={viewMode === "paper"} />
			</div>

			{/* Section: Market Analysis */}
			<div className="flex items-center gap-3 pt-2">
				<h2 className="text-sm font-semibold text-foreground">Market Analysis</h2>
				<div className="flex-1 h-px bg-border/50" />
			</div>
			<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Win Rate by Market</CardTitle>
					</CardHeader>
					<CardContent className={CHART_HEIGHT.responsive}>
						{marketRows.length === 0 ? (
							<EmptyPlaceholder />
						) : (
							<ChartErrorBoundary>
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={marketRows} layout="vertical" margin={{ right: 56 }}>
										<CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
										<XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
										<YAxis
											type="category"
											dataKey="market"
											tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
											width={48}
										/>
										<Tooltip
											contentStyle={TOOLTIP_CONTENT_STYLE}
											formatter={(value, _, item) => {
												const v = asNumber(value, 0);
												const p = item.payload as {
													wins: number;
													resolvedCount: number;
												};
												return [`${v.toFixed(1)}% (${p.wins}/${p.resolvedCount})`, "Win Rate"];
											}}
										/>
										<Bar
											dataKey="winRatePct"
											radius={[4, 4, 4, 4]}
											label={(props) => {
												const idx = Number(props.index);
												const row = marketRows[idx];
												if (!row) return null;
												return (
													<text
														x={Number(props.x) + Number(props.width) + 8}
														y={Number(props.y) + Number(props.height) / 2 + 4}
														fill="var(--muted-foreground)"
														fontSize={11}
													>
														{`${row.wins}/${row.resolvedCount}`}
													</text>
												);
											}}
										>
											{marketRows.map((row) => (
												<Cell
													key={row.market}
													fill={row.winRate >= 0.5 ? CHART_COLORS.positive : CHART_COLORS.negative}
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
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">P&L by Market</CardTitle>
					</CardHeader>
					<CardContent className={CHART_HEIGHT.responsive}>
						{marketRows.length === 0 ? (
							<EmptyPlaceholder />
						) : (
							<ChartErrorBoundary>
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={marketRows}>
										<CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
										<XAxis dataKey="market" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
										<YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={52} />
										<Tooltip
											contentStyle={TOOLTIP_CONTENT_STYLE}
											formatter={(value) => {
												const v = asNumber(value, 0);
												return [`${v >= 0 ? "+" : ""}${v.toFixed(2)} USDC`, "Total P&L"];
											}}
										/>
										<Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
											{marketRows.map((row) => (
												<Cell
													key={`${row.market}-pnl`}
													fill={row.pnl >= 0 ? CHART_COLORS.positive : CHART_COLORS.negative}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							</ChartErrorBoundary>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Market Comparison Table */}
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Market Comparison</CardTitle>
				</CardHeader>
				<CardContent>
					{marketRows.length === 0 ? (
						<EmptyPlaceholder />
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Market</TableHead>
										<TableHead className="text-right hidden sm:table-cell">Trades</TableHead>
										<TableHead className="text-right hidden sm:table-cell">W</TableHead>
										<TableHead className="text-right hidden sm:table-cell">L</TableHead>
										<TableHead className="text-right">WR%</TableHead>
										<TableHead className="text-right">P&L</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{marketRows.map((row) => (
										<TableRow key={`table-${row.market}`}>
											<TableCell className="font-mono text-xs font-medium">{row.market}</TableCell>
											<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{row.trades}</TableCell>
											<TableCell className="font-mono text-xs text-right text-emerald-400 hidden sm:table-cell">
												{row.wins}
											</TableCell>
											<TableCell className="font-mono text-xs text-right text-red-400 hidden sm:table-cell">
												{row.losses}
											</TableCell>
											<TableCell className="font-mono text-xs text-right">{row.winRatePct.toFixed(1)}%</TableCell>
											<TableCell
												className={cn(
													"font-mono text-xs text-right",
													row.pnl >= 0 ? "text-emerald-400" : "text-red-400",
												)}
											>
												{row.pnl >= 0 ? "+" : ""}
												{row.pnl.toFixed(2)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Section: Patterns */}
			<div className="flex items-center gap-3 pt-2">
				<h2 className="text-sm font-semibold text-foreground">Patterns</h2>
				<div className="flex-1 h-px bg-border/50" />
			</div>
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

			{/* Trading Heatmap */}
			<TradingHeatmap trades={liveTrades} />
		</div>
	);
}
