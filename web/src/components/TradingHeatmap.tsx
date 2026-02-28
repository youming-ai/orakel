import { memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TradeRecord } from "@/lib/api";
import { MARKETS } from "@/lib/constants";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface CellData {
	wins: number;
	losses: number;
	total: number;
	winRate: number;
}

type HeatmapGrid = Record<string, Record<number, CellData>>;

function buildHeatmap(trades: TradeRecord[]): HeatmapGrid {
	const grid: HeatmapGrid = {};
	for (const market of MARKETS) {
		grid[market] = {};
		for (const h of HOURS) {
			grid[market][h] = { wins: 0, losses: 0, total: 0, winRate: 0 };
		}
	}

	for (const trade of trades) {
		const market = trade.market?.toUpperCase();
		if (!MARKETS.includes(market as (typeof MARKETS)[number])) continue;
		const ts = new Date(trade.timestamp);
		if (Number.isNaN(ts.getTime())) continue;
		const hour = ts.getUTCHours();
		const cell = grid[market]?.[hour];
		if (!cell) continue;

		cell.total += 1;
		if (trade.won === 1) cell.wins += 1;
		else if (trade.won === 0) cell.losses += 1;
	}

	for (const market of MARKETS) {
		for (const h of HOURS) {
			const cell = grid[market]?.[h];
			if (cell && cell.wins + cell.losses > 0) {
				cell.winRate = cell.wins / (cell.wins + cell.losses);
			}
		}
	}

	return grid;
}

function hourlyTotals(grid: HeatmapGrid): Record<number, CellData> {
	const totals: Record<number, CellData> = {};
	for (const h of HOURS) {
		totals[h] = { wins: 0, losses: 0, total: 0, winRate: 0 };
	}
	for (const market of MARKETS) {
		for (const h of HOURS) {
			const cell = grid[market]?.[h];
			if (!cell) continue;
			const t = totals[h];
			if (!t) continue;
			t.wins += cell.wins;
			t.losses += cell.losses;
			t.total += cell.total;
		}
	}
	for (const h of HOURS) {
		const t = totals[h];
		if (t && t.wins + t.losses > 0) {
			t.winRate = t.wins / (t.wins + t.losses);
		}
	}
	return totals;
}

function winRateColor(cell: CellData): string {
	if (cell.total === 0) return "transparent";
	const wr = cell.winRate;
	if (wr >= 0.7) return "rgba(52, 211, 153, 0.55)";
	if (wr >= 0.6) return "rgba(52, 211, 153, 0.35)";
	if (wr >= 0.5) return "rgba(251, 191, 36, 0.30)";
	if (wr >= 0.4) return "rgba(248, 113, 113, 0.30)";
	return "rgba(248, 113, 113, 0.50)";
}

function winRateTextColor(cell: CellData): string {
	if (cell.total === 0) return "text-muted-foreground/20";
	const wr = cell.winRate;
	if (wr >= 0.5) return "text-emerald-400";
	return "text-red-400";
}

interface HeatmapCellProps {
	cell: CellData;
	hour: number;
	market: string;
	isHeader?: boolean;
}

function HeatmapCell({ cell, hour, market, isHeader = false }: HeatmapCellProps) {
	const bg = isHeader ? "transparent" : winRateColor(cell);
	const textClass = winRateTextColor(cell);

	return (
		<div
			className={`relative flex items-center justify-center rounded-sm transition-colors cursor-default ${isHeader ? "h-6" : "h-7"}`}
			style={{ backgroundColor: bg }}
			title={
				cell.total > 0
					? `${market} @${hour}:00 — ${cell.wins}W/${cell.losses}L (${(cell.winRate * 100).toFixed(0)}%) — ${cell.total} trades`
					: undefined
			}
		>
			{cell.total > 0 ? (
				<span className={`text-[9px] font-mono font-bold ${textClass}`}>{(cell.winRate * 100).toFixed(0)}%</span>
			) : (
				<span className="text-[8px] text-muted-foreground/15">·</span>
			)}
		</div>
	);
}

interface TradingHeatmapProps {
	trades: TradeRecord[];
}

export const TradingHeatmap = memo(function TradingHeatmap({ trades }: TradingHeatmapProps) {
	const grid = useMemo(() => buildHeatmap(trades), [trades]);
	const totals = useMemo(() => hourlyTotals(grid), [grid]);

	const hasTrades = trades.length > 0;

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
					Win Rate Heatmap — Market × Hour (UTC)
				</CardTitle>
				<p className="text-[10px] text-muted-foreground/60 mt-0.5">
					Color: <span className="text-emerald-400">green ≥50%</span> ·{" "}
					<span className="text-amber-400">yellow ~50%</span> · <span className="text-red-400">red &lt;50%</span>
				</p>
			</CardHeader>
			<CardContent>
				{!hasTrades ? (
					<div className="h-32 flex items-center justify-center border border-dashed border-border/50 rounded-lg text-muted-foreground/50 text-xs uppercase tracking-wider">
						No trade data available
					</div>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[640px]">
							{/* Hour header */}
							<div className="grid gap-px mb-1" style={{ gridTemplateColumns: `56px repeat(24, 1fr)` }}>
								<div className="text-[9px] text-muted-foreground/50 flex items-center">Market</div>
								{HOURS.map((h) => (
									<div
										key={`hdr-${h}`}
										className="text-[8px] font-mono text-muted-foreground/50 text-center leading-none py-0.5"
									>
										{h.toString().padStart(2, "0")}
									</div>
								))}
							</div>

							{/* Market rows */}
							{MARKETS.map((market) => (
								<div key={market} className="grid gap-px mb-px" style={{ gridTemplateColumns: `56px repeat(24, 1fr)` }}>
									<div className="flex items-center">
										<span className="text-[10px] font-mono font-bold text-muted-foreground">{market}</span>
									</div>
									{HOURS.map((h) => {
										const cell = grid[market]?.[h] ?? { wins: 0, losses: 0, total: 0, winRate: 0 };
										return <HeatmapCell key={`${market}-${h}`} cell={cell} hour={h} market={market} />;
									})}
								</div>
							))}

							{/* Divider */}
							<div className="h-px bg-border/50 my-1.5" />

							{/* Totals row */}
							<div className="grid gap-px" style={{ gridTemplateColumns: `56px repeat(24, 1fr)` }}>
								<div className="flex items-center">
									<span className="text-[9px] font-mono text-muted-foreground/60 uppercase">All</span>
								</div>
								{HOURS.map((h) => {
									const cell = totals[h] ?? { wins: 0, losses: 0, total: 0, winRate: 0 };
									return <HeatmapCell key={`total-${h}`} cell={cell} hour={h} market="ALL" />;
								})}
							</div>

							{/* Legend */}
							<div className="mt-3 flex items-center gap-3 flex-wrap">
								{[
									{ label: "≥70%", color: "rgba(52,211,153,0.55)", text: "text-emerald-300" },
									{ label: "60–70%", color: "rgba(52,211,153,0.35)", text: "text-emerald-400/70" },
									{ label: "50–60%", color: "rgba(251,191,36,0.30)", text: "text-amber-400/70" },
									{ label: "40–50%", color: "rgba(248,113,113,0.30)", text: "text-red-400/70" },
									{ label: "<40%", color: "rgba(248,113,113,0.50)", text: "text-red-300" },
								].map(({ label, color, text }) => (
									<div key={label} className="flex items-center gap-1">
										<div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
										<span className={`text-[9px] font-mono ${text}`}>{label}</span>
									</div>
								))}
								<span className="text-[9px] text-muted-foreground/40 ml-auto">{trades.length} trades total</span>
							</div>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
});
