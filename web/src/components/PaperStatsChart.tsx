import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PaperStats, PaperTradeEntry } from "@/lib/api";
import { fmtTimeShort } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PaperStatsChartProps {
	stats: PaperStats;
	trades: PaperTradeEntry[];
}

function buildCumulativePnlData(trades: PaperTradeEntry[]) {
	const resolved = trades
		.filter((t) => t.resolved && t.pnl !== null)
		.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

	if (resolved.length === 0) return [];

	let cumPnl = 0;
	return resolved.map((t, i) => {
		cumPnl += t.pnl ?? 0;
		return {
			idx: i + 1,
			pnl: Number(cumPnl.toFixed(2)),
			trade: `${t.marketId} ${t.side}`,
			time: fmtTimeShort(t.timestamp),
		};
	});
}

function buildMarketBreakdown(trades: PaperTradeEntry[]) {
	const map = new Map<
		string,
		{ wins: number; losses: number; pending: number }
	>();
	for (const t of trades) {
		const entry = map.get(t.marketId) ?? { wins: 0, losses: 0, pending: 0 };
		if (!t.resolved) entry.pending++;
		else if (t.won) entry.wins++;
		else entry.losses++;
		map.set(t.marketId, entry);
	}
	return Array.from(map.entries()).map(([market, data]) => ({
		market,
		...data,
	}));
}

const COLORS = {
	win: "#34d399",
	loss: "#f87171",
	pending: "#fbbf24",
	pnlPositive: "#34d399",
	pnlNegative: "#f87171",
	grid: "#333",
	axis: "#666",
};

export function PaperStatsChart({ stats, trades }: PaperStatsChartProps) {
	const pnlData = buildCumulativePnlData(trades);
	const marketData = buildMarketBreakdown(trades);
	const hasResolved = stats.wins + stats.losses > 0;

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
				<StatCard label="Trades" value={String(stats.totalTrades)} />
				<StatCard
					label="Win Rate"
					value={hasResolved ? `${(stats.winRate * 100).toFixed(0)}%` : "-"}
					color={
						stats.winRate >= 0.5
							? "text-emerald-400"
							: stats.winRate > 0
								? "text-red-400"
								: undefined
					}
				/>
				<StatCard
					label="Wins"
					value={String(stats.wins)}
					color="text-emerald-400"
				/>
				<StatCard
					label="Losses"
					value={String(stats.losses)}
					color="text-red-400"
				/>
				<StatCard
					label="P&L"
					value={`${stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}`}
					color={stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
					suffix="USDC"
				/>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							Cumulative P&L
						</CardTitle>
					</CardHeader>
					<CardContent className="h-48">
						{pnlData.length > 0 ? (
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart data={pnlData}>
									<defs>
										<linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
											<stop
												offset="5%"
												stopColor={COLORS.pnlPositive}
												stopOpacity={0.3}
											/>
											<stop
												offset="95%"
												stopColor={COLORS.pnlPositive}
												stopOpacity={0}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
									<XAxis
										dataKey="idx"
										tick={{ fontSize: 10, fill: COLORS.axis }}
									/>
									<YAxis
										tick={{ fontSize: 10, fill: COLORS.axis }}
										tickFormatter={(v: number) => `${v}`}
									/>
									<Tooltip
										contentStyle={{
											background: "#1a1a2e",
											border: "1px solid #333",
											borderRadius: 6,
											fontSize: 11,
										}}
										labelFormatter={(v) => `Trade #${v}`}
										formatter={(v: number | undefined) => [
											`${(v ?? 0) >= 0 ? "+" : ""}${(v ?? 0).toFixed(2)} USDC`,
											"P&L",
										]}
									/>
									<Area
										type="monotone"
										dataKey="pnl"
										stroke={COLORS.pnlPositive}
										fill="url(#pnlGrad)"
										strokeWidth={2}
									/>
								</AreaChart>
							</ResponsiveContainer>
						) : (
							<div className="flex items-center justify-center h-full text-xs text-muted-foreground">
								Waiting for trades to resolve...
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							By Market
						</CardTitle>
					</CardHeader>
					<CardContent className="h-48">
						{marketData.length > 0 ? (
							<ResponsiveContainer width="100%" height="100%">
								<BarChart data={marketData} barGap={2}>
									<CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
									<XAxis
										dataKey="market"
										tick={{ fontSize: 10, fill: COLORS.axis }}
									/>
									<YAxis
										tick={{ fontSize: 10, fill: COLORS.axis }}
										allowDecimals={false}
									/>
									<Tooltip
										contentStyle={{
											background: "#1a1a2e",
											border: "1px solid #333",
											borderRadius: 6,
											fontSize: 11,
										}}
									/>
									<Bar
										dataKey="wins"
										stackId="a"
										fill={COLORS.win}
										radius={[0, 0, 0, 0]}
										name="Wins"
									/>
									<Bar
										dataKey="losses"
										stackId="a"
										fill={COLORS.loss}
										radius={[0, 0, 0, 0]}
										name="Losses"
									/>
									<Bar
										dataKey="pending"
										stackId="a"
										fill={COLORS.pending}
										radius={[2, 2, 0, 0]}
										name="Pending"
									/>
								</BarChart>
							</ResponsiveContainer>
						) : (
							<div className="flex items-center justify-center h-full text-xs text-muted-foreground">
								No trades yet
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{stats.pending > 0 && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Badge
						variant="secondary"
						className="text-[10px] px-1.5 bg-amber-500/15 text-amber-400"
					>
						{stats.pending} pending
					</Badge>
					<span>trades awaiting 15m window resolution</span>
				</div>
			)}
		</div>
	);
}

function StatCard({
	label,
	value,
	color,
	suffix,
}: {
	label: string;
	value: string;
	color?: string;
	suffix?: string;
}) {
	return (
		<Card>
			<CardContent className="py-3 px-4">
				<span className="text-[11px] text-muted-foreground block">{label}</span>
				<span className={cn("font-mono text-lg font-bold block", color)}>
					{value}
					{suffix && (
						<span className="text-xs font-normal text-muted-foreground ml-1">
							{suffix}
						</span>
					)}
				</span>
			</CardContent>
		</Card>
	);
}
