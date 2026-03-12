import { BtcIcon, EthIcon } from "@/components/icons";
import { SimplifiedIndicators } from "@/components/market/SimplifiedIndicators";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MarketSnapshot } from "@/contracts/http";
import { fmtCents, fmtMinSec, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

function MarketLabel({ id, spotPrice }: { id: string; spotPrice: number | null }) {
	const isBtc = id.startsWith("BTC");
	const isEth = id.startsWith("ETH");
	return (
		<div className="flex items-center gap-2">
			<span className="flex items-center gap-1.5">
				{isBtc && <BtcIcon size={18} />}
				{isEth && <EthIcon size={18} />}
				<span className="font-semibold text-sm sm:text-base">{id}</span>
			</span>
			{spotPrice !== null && (
				<span className="text-xs font-medium tabular-nums text-muted-foreground">{fmtPrice(id, spotPrice)}</span>
			)}
		</div>
	);
}

function ConfidenceMeter({ confidence }: { confidence: MarketSnapshot["confidence"] }) {
	if (!confidence) return null;
	const pct = Math.round(confidence.score * 100);
	const color =
		confidence.level === "HIGH"
			? "bg-emerald-500/70 text-emerald-400"
			: confidence.level === "MEDIUM"
				? "bg-amber-500/70 text-amber-400"
				: "bg-red-500/70 text-red-400";
	const textColor =
		confidence.level === "HIGH"
			? "text-emerald-400"
			: confidence.level === "MEDIUM"
				? "text-amber-400"
				: "text-red-400";

	return (
		<div className="flex items-center gap-2">
			<span className="text-[11px] uppercase text-muted-foreground w-10 shrink-0">Conf</span>
			<div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
				<div
					className={cn("h-full rounded-full transition-all duration-500", color.split(" ")[0])}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className={cn("text-[11px] font-mono font-medium shrink-0", textColor)}>{pct}%</span>
		</div>
	);
}

function VolatilityBadge({ vol }: { vol: number | null }) {
	if (vol === null) return null;
	const volPct = (vol * 100).toFixed(2);
	const level = vol > 0.02 ? "HIGH" : vol > 0.01 ? "MED" : "LOW";
	const color =
		level === "HIGH"
			? "text-red-400 bg-red-500/10 border-red-500/20"
			: level === "MED"
				? "text-amber-400 bg-amber-500/10 border-amber-500/20"
				: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
	return (
		<Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-mono", color)}>
			Vol {volPct}%
		</Badge>
	);
}

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
				"bg-muted/30 border-border/50 shadow-sm",
				"hover:bg-muted/50 hover:border-border/80 hover:-translate-y-0.5 hover:shadow-md",
				"rounded-xl",
			)}
		>
			<CardContent className="p-3 sm:p-4 space-y-2 sm:space-y-3">
				{/* Header: Signal + ID + Phase + Vol */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div
							className={cn(
								"w-2 h-2 rounded-full transition-colors duration-500",
								isEntry ? (isLong ? "bg-emerald-500" : "bg-red-500") : "bg-muted-foreground/30",
							)}
						/>
						<MarketLabel id={m.id} spotPrice={m.spotPrice} />
					</div>
					<div className="flex items-center gap-1.5">
						<VolatilityBadge vol={m.volatility15m} />
						{m.phase && (
							<Badge variant="secondary" className="text-[11px] px-1.5 py-0">
								{m.phase}
							</Badge>
						)}
						<span className="font-mono text-[11px] text-muted-foreground">{fmtMinSec(m.timeLeftMin)}</span>
					</div>
				</div>

				{/* Main Signal */}
				<div className="text-center py-1 sm:py-2">
					<div
						className={cn("text-lg sm:text-2xl font-bold tracking-tight", isLong ? "text-emerald-500" : "text-red-500")}
					>
						{isLong ? "LONG" : "SHORT"} {isLong ? m.predictLong : m.predictShort}%
					</div>
				</div>

				{/* Odds + Price to beat */}
				<div className="flex justify-center items-center gap-3 text-[11px] font-mono">
					<span className="text-emerald-400">UP {fmtCents(m.marketUp)}</span>
					<span className="text-muted-foreground/30">|</span>
					<span className="text-red-400">DN {fmtCents(m.marketDown)}</span>
					{m.priceToBeat !== null && (
						<>
							<span className="text-muted-foreground/30">|</span>
							<span className="text-muted-foreground" title="Price to beat">
								PTB {fmtPrice(m.id, m.priceToBeat)}
							</span>
						</>
					)}
				</div>

				{/* Indicators */}
				<div className="pt-2 border-t border-border/30">
					<SimplifiedIndicators market={m} />
				</div>

				<div className="space-y-1.5">
					<ConfidenceMeter confidence={m.confidence} />
				</div>

				{/* Action Button */}
				{isEntry ? (
					<div
						className={cn(
							"rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-xs font-semibold text-center",
							"bg-primary/10 text-primary border border-primary/30",
							"animate-in fade-in slide-in-from-bottom-2 duration-500",
						)}
					>
						<span className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
							<span>BUY {m.side}</span>
							<span className="text-primary/40">|</span>
							<span className="font-mono">Edge {((m.edge ?? 0) * 100).toFixed(1)}%</span>
						</span>
					</div>
				) : (
					<div className="text-center text-[11px] text-muted-foreground uppercase tracking-wide py-1 sm:py-1.5">
						{m.reason ?? "NO TRADE"}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
