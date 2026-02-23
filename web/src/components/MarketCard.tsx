import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketSnapshot } from "@/lib/api";
import { fmtCents, fmtMinSec, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MarketCardProps {
	market: MarketSnapshot;
}

function macdLabel(macd: MarketSnapshot["macd"]): {
	text: string;
	color: string;
} {
	if (!macd) return { text: "---", color: "text-muted-foreground" };
	if (macd.hist > 0 && (macd.histDelta ?? 0) > 0)
		return { text: "bullish", color: "text-emerald-400" };
	if (macd.hist > 0) return { text: "green", color: "text-emerald-400/70" };
	if (macd.hist < 0 && (macd.histDelta ?? 0) < 0)
		return { text: "bearish", color: "text-red-400" };
	return { text: "red", color: "text-red-400/70" };
}

export function MarketCard({ market: m }: MarketCardProps) {
	if (!m.ok) {
		return (
			<Card className="border-red-900/40 bg-red-950/20">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">{m.id}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-red-400">Error: {m.error ?? "Unknown"}</p>
				</CardContent>
			</Card>
		);
	}

	const isLong = m.predictDirection === "LONG";
	const isEntry = m.action === "ENTER";
	const phaseBg = m.phase === "LATE" ? "bg-amber-500/10" : "";
	const macdInfo = macdLabel(m.macd);

	return (
		<Card className={cn("relative overflow-hidden", phaseBg)}>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<CardTitle className="text-base font-bold">{m.id}</CardTitle>
					<div className="flex items-center gap-2">
						{m.phase && (
							<Badge variant="secondary" className="text-[10px] px-1.5 py-0">
								{m.phase}
							</Badge>
						)}
						<span className="font-mono text-xs text-muted-foreground">
							{fmtMinSec(m.timeLeftMin)}
						</span>
					</div>
				</div>
				<div className="flex items-baseline gap-2 mt-1">
					<span className="font-mono text-xl font-bold tracking-tight">
						{fmtPrice(m.id, m.spotPrice)}
					</span>
					{m.priceToBeat !== null && (
						<span className="font-mono text-xs text-muted-foreground">
							PTB {fmtPrice(m.id, m.priceToBeat)}
						</span>
					)}
				</div>
			</CardHeader>

			<CardContent className="space-y-3 pt-0">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<span className="text-xs text-muted-foreground">Predict</span>
						<span
							className={cn(
								"font-mono text-sm font-semibold",
								isLong ? "text-emerald-400" : "text-red-400",
							)}
						>
							{isLong ? "LONG" : "SHORT"}{" "}
							{isLong ? m.predictLong : m.predictShort}%
						</span>
					</div>
					<div className="flex gap-3 font-mono text-xs">
						<span className="text-emerald-400/80">
							UP {fmtCents(m.marketUp)}
						</span>
						<span className="text-red-400/80">DN {fmtCents(m.marketDown)}</span>
					</div>
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">HA</span>
						<span
							className={cn(
								"font-mono block",
								m.haColor === "green" ? "text-emerald-300" : "text-red-300",
							)}
						>
							{m.haColor ?? "-"} x{m.haConsecutive}
						</span>
					</div>
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">RSI</span>
						<span
							className={cn(
								"font-mono block",
								(m.rsi ?? 50) > 70
									? "text-red-400"
									: (m.rsi ?? 50) < 30
										? "text-emerald-400"
										: "text-foreground",
							)}
						>
							{m.rsi?.toFixed(1) ?? "-"}
						</span>
					</div>
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">MACD</span>
						<span className={cn("font-mono block", macdInfo.color)}>
							{macdInfo.text}
						</span>
					</div>
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">VWAP</span>
						<span
							className={cn(
								"font-mono block",
								(m.vwapSlope ?? 0) > 0 ? "text-emerald-400" : "text-red-400",
							)}
						>
							{(m.vwapSlope ?? 0) > 0 ? "up" : "dn"}
						</span>
					</div>
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">Vol</span>
						<span className="font-mono block">
							{m.volatility15m !== null
								? `${(m.volatility15m * 100).toFixed(2)}%`
								: "-"}
						</span>
					</div>
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">Blend</span>
						<span className="font-mono block">{m.blendSource ?? "-"}</span>
					</div>
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">OB</span>
						<span
							className={cn(
								"font-mono block",
								m.orderbookImbalance !== null && m.orderbookImbalance > 0
									? "text-emerald-400"
									: "text-red-400",
							)}
						>
							{m.orderbookImbalance !== null
								? `${(m.orderbookImbalance * 100).toFixed(0)}%`
								: "-"}
						</span>
					</div>
					<div className="space-y-0.5">
						<span className="text-muted-foreground block">Sum</span>
						<span
							className={cn(
								"font-mono block",
								m.arbitrage ? "text-amber-400" : "",
							)}
						>
							{m.rawSum !== null ? m.rawSum.toFixed(3) : "-"}
						</span>
					</div>
				</div>

				<div
					className={cn(
						"rounded-md px-3 py-1.5 text-xs font-medium text-center",
						isEntry
							? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
							: "bg-muted/50 text-muted-foreground",
					)}
				>
					{isEntry ? (
						<span>
							BUY {m.side} | Edge {((m.edge ?? 0) * 100).toFixed(1)}% |{" "}
							{m.strength}
						</span>
					) : (
						<span>NO TRADE ({m.reason ?? m.phase})</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
