import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketSnapshot } from "@/lib/api";
import { fmtCents, fmtMinSec, fmtPrice } from "@/lib/format";
import { MiniTrend, macdLabel, SignalLight } from "@/lib/marketCardHelpers";
import { cn } from "@/lib/utils";

interface GroupedMarketCardProps {
	snapshots: MarketSnapshot[];
}

const TF_ORDER = ["15m", "1h", "4h"];

// Responsive grid template: 6 cols on mobile (no PTB), 7 cols on sm+
const ROW_GRID = "grid grid-cols-[40px_1fr_60px_1fr_50px_52px] sm:grid-cols-[40px_1fr_1fr_60px_1fr_50px_52px] gap-x-2";

function tfBadgeColor(tf: string): string {
	if (tf === "1h") return "border-blue-500/40 text-blue-400";
	if (tf === "4h") return "border-purple-500/40 text-purple-400";
	return "border-border/60 text-muted-foreground";
}

function TimeframeRow({ snapshot: s, coinId }: { snapshot: MarketSnapshot; coinId: string }) {
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

			{/* PTB — hidden on mobile */}
			<span className="hidden sm:block font-mono text-muted-foreground truncate">
				{fmtPrice(coinId, s.priceToBeat)}
			</span>

			{/* UP / DN */}
			<div className="flex gap-1 font-mono">
				<span className="text-emerald-400/80">{fmtCents(s.marketUp)}</span>
				<span className="text-muted-foreground/50">/</span>
				<span className="text-red-400/80">{fmtCents(s.marketDown)}</span>
			</div>

			{/* Edge */}
			<span className={cn("font-mono font-medium", isEntry ? "text-emerald-400" : "text-muted-foreground")}>
				{s.edge !== null ? `${(s.edge * 100).toFixed(1)}%` : "-"}
			</span>

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

	// Derived shared indicator display values
	const macdInfo = macdLabel(primary.ok ? primary.macd : null);
	const rsiVal = primary.ok ? (primary.rsi ?? 50) : 50;
	const rsiColor = rsiVal > 70 ? "text-red-400" : rsiVal < 30 ? "text-emerald-400" : "text-foreground";
	const vwapUp = primary.ok ? (primary.vwapSlope ?? 0) > 0 : false;
	const vwapColor = vwapUp ? "text-emerald-400" : "text-red-400";
	const vwapText = primary.ok ? (vwapUp ? "↑" : "↓") : "-";

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

			{/* Shared technical indicators — sourced from 15m candles */}
			<div className="px-3 pb-3">
				<span className="text-[9px] text-muted-foreground/50 font-medium uppercase tracking-wider mb-1.5 block">
					Indicators (15m)
				</span>
				<div className="grid grid-cols-5 gap-x-3 text-[11px]">
					{/* HA Trend */}
					<div className="flex items-center gap-1.5">
						<span className="text-[10px] uppercase text-muted-foreground font-semibold">HA</span>
						{primary.ok ? (
							<MiniTrend haColor={primary.haColor} count={primary.haConsecutive} />
						) : (
							<span className="text-muted-foreground font-mono">-</span>
						)}
					</div>

					{/* RSI */}
					<div className="flex items-center gap-1.5">
						<span className="text-[10px] uppercase text-muted-foreground font-semibold">RSI</span>
						<span className={cn("font-mono font-medium", rsiColor)}>
							{primary.ok ? (primary.rsi?.toFixed(1) ?? "-") : "-"}
						</span>
					</div>

					{/* MACD */}
					<div className="flex items-center gap-1.5">
						<span className="text-[10px] uppercase text-muted-foreground font-semibold">MACD</span>
						<span className={cn("font-mono font-medium", macdInfo.color)}>{macdInfo.text}</span>
					</div>

					{/* VWAP */}
					<div className="flex items-center gap-1.5">
						<span className="text-[10px] uppercase text-muted-foreground font-semibold">VWAP</span>
						<span className={cn("font-mono font-medium", vwapColor)}>{vwapText}</span>
					</div>

					{/* Vol */}
					<div className="flex items-center gap-1.5">
						<span className="text-[10px] uppercase text-muted-foreground font-semibold">Vol</span>
						<span className="font-mono font-medium">
							{primary.ok && primary.volatility15m !== null ? `${(primary.volatility15m * 100).toFixed(2)}%` : "-"}
						</span>
					</div>
				</div>
			</div>

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
					<span className="hidden sm:block">PTB</span>
					<span>UP / DN</span>
					<span>Edge</span>
					<span>Signal</span>
					<span>Conf</span>
					<span className="text-right">Time</span>
				</div>

				{/* Rows */}
				{sortedSnapshots.map((s) => (
					<TimeframeRow key={s.timeframe ?? "15m"} snapshot={s} coinId={primary.id} />
				))}
			</div>
		</Card>
	);
});
