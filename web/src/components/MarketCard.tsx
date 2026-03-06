import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketSnapshot } from "@/contracts/http";
import { fmtCents, fmtMinSec } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SimplifiedIndicators } from "./market/MarketIndicators";

interface MarketCardProps {
	market: MarketSnapshot;
}

export function MarketCard({ market: m }: MarketCardProps) {
	if (!m.ok) {
		return (
			<Card className="border-red-500/30 bg-red-500/10 p-4">
				<p className="text-sm text-red-400">Error: {m.error ?? "Unknown"}</p>
			</Card>
		);
	}

	const isLong = m.predictDirection === "LONG";
	const isEntry = m.action === "ENTER";

	return (
		<Card
			className={cn(
				"relative overflow-hidden transition-all duration-300",
				"bg-muted/30 border-border/50",
				"hover:bg-muted/50 hover:border-border/80 hover:-translate-y-0.5",
				"rounded-xl",
			)}
		>
			<CardContent className="p-4 space-y-4">
				{/* Header: Signal + ID + Phase */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div
							className={cn(
								"w-2 h-2 rounded-full transition-colors duration-500",
								isEntry ? (isLong ? "bg-emerald-500" : "bg-red-500") : "bg-muted-foreground/30",
							)}
						/>
						<span className="font-semibold text-sm">{m.id}</span>
					</div>
					<div className="flex items-center gap-2">
						{m.phase && (
							<Badge variant="secondary" className="text-[10px] px-1.5 py-0">
								{m.phase}
							</Badge>
						)}
						<span className="font-mono text-[10px] text-muted-foreground">{fmtMinSec(m.timeLeftMin)}</span>
					</div>
				</div>

				{/* Main Signal */}
				<div className="text-center py-2">
					<div className={cn("text-2xl font-light tracking-tight", isLong ? "text-emerald-500" : "text-red-500")}>
						{isLong ? "LONG" : "SHORT"} {isLong ? m.predictLong : m.predictShort}%
					</div>
				</div>

				{/* Odds */}
				<div className="flex justify-center gap-4 text-[11px] font-mono">
					<span className="text-emerald-400">UP {fmtCents(m.marketUp)}</span>
					<span className="text-muted-foreground/30">|</span>
					<span className="text-red-400">DN {fmtCents(m.marketDown)}</span>
				</div>

				{/* Simplified Indicators */}
				<div className="pt-2 border-t border-border/30">
					<SimplifiedIndicators market={m} />
				</div>

				{/* Action Button */}
				{isEntry ? (
					<div
						className={cn(
							"rounded-lg px-3 py-2 text-xs font-semibold text-center",
							"bg-primary/10 text-primary border border-primary/30",
							"animate-in fade-in slide-in-from-bottom-2 duration-500",
						)}
					>
						<span className="flex items-center justify-center gap-2">
							<span>BUY {m.side}</span>
							<span className="text-primary/40">|</span>
							<span className="font-mono">Edge {((m.edge ?? 0) * 100).toFixed(1)}%</span>
						</span>
					</div>
				) : (
					<div className="text-center text-[11px] text-muted-foreground uppercase tracking-wide py-2">
						{m.reason ?? "NO TRADE"}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
