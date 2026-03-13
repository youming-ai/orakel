import { BtcIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketSnapshot } from "@/contracts/http";
import { fmtCents, fmtMinSec, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SignalCardProps {
	market: MarketSnapshot;
}

export function SignalCard({ market: m }: SignalCardProps) {
	if (!m.ok) {
		return (
			<Card className="border-red-500/40 bg-red-500/10 p-4">
				<p className="text-sm text-red-400">Error: {m.error ?? "Unknown"}</p>
			</Card>
		);
	}

	const isLong = m.predictDirection === "LONG";
	const isShort = m.predictDirection === "SHORT";
	const isEntry = m.action === "ENTER";
	const signalDirection = isShort ? "SHORT" : "LONG";
	const signalPct = signalDirection === "LONG" ? m.predictLong : m.predictShort;
	const deltaPct = m.spotDelta === null ? null : m.spotDelta * 100;
	const edgePct = m.edge === null ? null : m.edge * 100;
	const confidencePct = m.confidence ? Math.round(m.confidence.score * 100) : 0;
	const sideLabel = m.side ?? (signalDirection === "LONG" ? "UP" : "DOWN");

	const borderTone = isEntry ? (isLong ? "border-emerald-500/40" : "border-red-500/40") : "border-border/60";
	const signalDotTone = isEntry ? (isLong ? "bg-emerald-400" : "bg-red-400") : "bg-muted-foreground/70";
	const heroTone = isLong ? "text-emerald-400" : "text-red-400";
	const confidenceTone = isLong ? "bg-emerald-400" : "bg-red-400";
	const deltaTone = deltaPct === null ? "text-muted-foreground" : deltaPct >= 0 ? "text-emerald-400" : "text-red-400";
	const edgeTone = edgePct === null ? "text-foreground" : edgePct >= 0 ? "text-emerald-400" : "text-red-400";
	const volatilityTone =
		m.volatility15m === null ? "text-foreground" : m.volatility15m >= 0.02 ? "text-red-400" : "text-emerald-400";

	return (
		<Card
			className={cn(
				"overflow-hidden shadow-sm transition-all duration-300 sm:hover:-translate-y-0.5 sm:hover:shadow-md",
				borderTone,
			)}
		>
			<CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-5">
				<div className="flex items-start justify-between gap-2 sm:gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<span className={cn("mt-0.5 size-2 sm:size-2.5 shrink-0 rounded-full", signalDotTone)} />
						<BtcIcon size={18} />
						<span className="truncate font-mono text-sm sm:text-lg font-bold text-foreground tabular-nums">
							{fmtPrice(m.id, m.spotPrice)}
						</span>
					</div>
					<div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
						{m.phase && (
							<Badge variant="secondary" className="px-1.5 sm:px-2 py-0 text-[9px] sm:text-[10px]">
								{m.phase}
							</Badge>
						)}
						<span className="font-mono text-[10px] sm:text-xs text-muted-foreground tabular-nums">
							{fmtMinSec(m.timeLeftMin)}
						</span>
					</div>
				</div>

				<div className="py-1.5 sm:py-2 text-center">
					<p className={cn("text-2xl sm:text-3xl font-black tracking-tight", heroTone)}>
						{signalDirection} {signalPct === null ? "--" : `${signalPct.toFixed(0)}%`}
					</p>
					<p className="mt-1.5 sm:mt-2 font-mono text-[10px] sm:text-xs text-muted-foreground">
						PTB {fmtPrice(m.id, m.priceToBeat)}
						<span className="px-1.5 sm:px-2 opacity-40">·</span>
						<span className={deltaTone}>
							Δ {deltaPct === null ? "--" : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%`}
						</span>
					</p>
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border/40 overflow-hidden rounded-lg border border-border/40 bg-muted/20">
					<div className="space-y-0.5 sm:space-y-1 px-2 py-2 sm:py-2.5 text-center sm:border-0 border-b border-border/30">
						<p className="text-[9px] sm:text-[10px] uppercase tracking-wide text-muted-foreground">Edge</p>
						<p className={cn("font-mono text-[11px] sm:text-xs font-semibold", edgeTone)}>
							{edgePct === null ? "--" : `${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(1)}%`}
						</p>
					</div>
					<div className="space-y-0.5 sm:space-y-1 px-2 py-2 sm:py-2.5 text-center sm:border-0 border-b border-border/30 sm:border-r border-border/30">
						<p className="text-[9px] sm:text-[10px] uppercase tracking-wide text-muted-foreground">Up</p>
						<p className="font-mono text-[11px] sm:text-xs font-semibold text-emerald-300">{fmtCents(m.marketUp)}</p>
					</div>
					<div className="space-y-0.5 sm:space-y-1 px-2 py-2 sm:py-2.5 text-center border-r sm:border-r-0 border-border/30">
						<p className="text-[9px] sm:text-[10px] uppercase tracking-wide text-muted-foreground">Down</p>
						<p className="font-mono text-[11px] sm:text-xs font-semibold text-red-300">{fmtCents(m.marketDown)}</p>
					</div>
					<div className="space-y-0.5 sm:space-y-1 px-2 py-2 sm:py-2.5 text-center">
						<p className="text-[9px] sm:text-[10px] uppercase tracking-wide text-muted-foreground">Vol</p>
						<p className={cn("font-mono text-[11px] sm:text-xs font-semibold", volatilityTone)}>
							{m.volatility15m === null ? "--" : `${(m.volatility15m * 100).toFixed(1)}%`}
						</p>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<span className="w-16 sm:w-20 shrink-0 text-[10px] sm:text-[11px] uppercase tracking-wide text-muted-foreground">
						Conf
					</span>
					<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/30">
						<div
							className={cn("h-full rounded-full transition-all duration-500", confidenceTone)}
							style={{ width: `${confidencePct}%` }}
						/>
					</div>
					<span className="w-8 sm:w-10 shrink-0 text-right font-mono text-[10px] sm:text-[11px] text-foreground">
						{confidencePct}%
					</span>
				</div>

				{isEntry ? (
					<div
						className={cn(
							"rounded-md border px-2.5 sm:px-3 py-1.5 sm:py-2 text-center text-[11px] sm:text-xs font-semibold tracking-wide",
							isLong
								? "border-emerald-400/40 bg-emerald-400/12 text-emerald-200"
								: "border-red-400/40 bg-red-400/12 text-red-200",
						)}
					>
						<span className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
							<span>BUY {sideLabel}</span>
							<span className="text-current/40">·</span>
							<span className="font-mono">
								Edge {edgePct === null ? "--" : `${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(1)}%`}
							</span>
						</span>
					</div>
				) : (
					<div className="py-0.5 sm:py-1 text-center text-[10px] sm:text-[11px] uppercase tracking-[0.15em] sm:tracking-[0.2em] text-muted-foreground">
						NO TRADE
					</div>
				)}

				{!isEntry && m.reason && (
					<div className="text-center font-mono text-[10px] sm:text-[11px] text-muted-foreground/80">{m.reason}</div>
				)}
			</CardContent>
		</Card>
	);
}
