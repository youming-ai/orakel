import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketSnapshot } from "@/lib/api";
import { fmtMinSec, fmtPrice } from "@/lib/format";
import { SignalLight } from "@/lib/marketCardHelpers";
import { cn } from "@/lib/utils";

interface GroupedMarketCardProps {
	snapshots: MarketSnapshot[];
}

const TF_ORDER = ["15m", "1h", "4h"];

// 5-column layout: TF | Signal | Edge | Conf | Time
const ROW_GRID = "grid grid-cols-[40px_1fr_60px_1fr_52px] gap-x-2";

function tfBadgeColor(tf: string): string {
	if (tf === "1h") return "border-blue-500/40 text-blue-400";
	if (tf === "4h") return "border-purple-500/40 text-purple-400";
	return "border-border/60 text-muted-foreground";
}

function TimeframeRow({ snapshot: s }: { snapshot: MarketSnapshot }) {
	const tf = s.timeframe ?? "15m";

	// Error snapshot — use flex layout, skip grid complexity
	if (!s.ok) {
		return (
			<div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 last:border-b-0 bg-red-500/5">
				<Badge variant="outline" className={cn("text-[9px] px-1 py-0 font-mono shrink-0", tfBadgeColor(tf))}>
					{tf}
				</Badge>
				<span className="text-red-400 text-[10px] truncate">{s.error ?? "Error"}</span>
			</div>
		);
	}

	const isEntry = s.action === "ENTER";
	const confScore = s.confidence?.score ?? 0;

	return (
		<div
			className={cn(
				ROW_GRID,
				"px-3 py-1.5 text-[11px] items-center border-b border-border/20 last:border-b-0",
				isEntry ? "bg-emerald-500/5" : "",
			)}
		>
			{/* TF badge */}
			<Badge variant="outline" className={cn("text-[9px] px-1 py-0 font-mono justify-center", tfBadgeColor(tf))}>
				{tf}
			</Badge>

			{/* Signal (action + side) */}
			<div className="flex items-center gap-1.5">
				<SignalLight action={s.action} edge={s.edge} />
				{isEntry ? (
					<span className={cn("font-semibold text-[10px]", s.side === "UP" ? "text-emerald-400" : "text-red-400")}>
						BUY {s.side}
					</span>
				) : (
					<span className="text-muted-foreground text-[10px]">NO TRADE</span>
				)}
			</div>

			{/* Edge */}
			<span className={cn("font-mono font-medium", isEntry ? "text-emerald-400" : "text-muted-foreground")}>
				{s.edge !== null ? `${(s.edge * 100).toFixed(1)}%` : "-"}
			</span>

			{/* Confidence — mini bar + score */}
			<div className="flex items-center gap-1">
				<div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden">
					<div
						className={cn(
							"h-full rounded-full",
							confScore >= 0.7 ? "bg-emerald-400" : confScore >= 0.5 ? "bg-amber-400" : "bg-red-400",
						)}
						style={{ width: `${confScore * 100}%` }}
					/>
				</div>
				<span className="text-[9px] font-mono text-muted-foreground w-6 text-right">
					{(confScore * 100).toFixed(0)}
				</span>
			</div>

			{/* Time left */}
			<span className="font-mono text-muted-foreground text-right">{fmtMinSec(s.timeLeftMin)}</span>
		</div>
	);
}

export const GroupedMarketCard = memo(function GroupedMarketCard({ snapshots }: GroupedMarketCardProps) {
	const sortedSnapshots = useMemo(() => {
		return [...snapshots].sort((a, b) => {
			const ai = TF_ORDER.indexOf(a.timeframe ?? "15m");
			const bi = TF_ORDER.indexOf(b.timeframe ?? "15m");
			return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
		});
	}, [snapshots]);

	if (sortedSnapshots.length === 0) return null;

	// primary: first snapshot for shared data (coin id always available)
	const primary = sortedSnapshots[0];
	if (!primary) return null;

	// bestSnapshot: ENTER with highest edge, else primary
	const enterSnaps = sortedSnapshots.filter((s) => s.ok && s.action === "ENTER");
	const firstEntry = enterSnaps[0];
	const bestSnapshot =
		firstEntry !== undefined
			? enterSnaps.reduce<MarketSnapshot>((best, s) => ((s.edge ?? 0) > (best.edge ?? 0) ? s : best), firstEntry)
			: primary;

	return (
		<Card className="overflow-hidden">
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<SignalLight action={bestSnapshot.action} edge={bestSnapshot.edge} />
						<CardTitle className="text-base font-bold">{primary.id}</CardTitle>
						<span className="font-mono text-lg font-bold tracking-tight">
							{fmtPrice(primary.id, primary.ok ? primary.spotPrice : null)}
						</span>
					</div>
				</div>
			</CardHeader>

			{/* Per-timeframe signal table */}
			<div className="border-t border-border/50">
				{/* Table header */}
				<div
					className={cn(
						ROW_GRID,
						"px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border/30",
					)}
				>
					<span>TF</span>
					<span>Signal</span>
					<span>Edge</span>
					<span>Conf</span>
					<span className="text-right">Time</span>
				</div>

				{/* Rows */}
				{sortedSnapshots.map((s) => (
					<TimeframeRow key={s.timeframe ?? "15m"} snapshot={s} />
				))}
			</div>
		</Card>
	);
});
