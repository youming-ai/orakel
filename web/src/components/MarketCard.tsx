import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConfidenceResult, MarketSnapshot } from "@/lib/api";
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

function confidenceColor(score: number): string {
	if (score >= 0.7) return "text-emerald-400";
	if (score >= 0.5) return "text-amber-400";
	return "text-red-400";
}

function confidenceBg(score: number): string {
	if (score >= 0.7) return "bg-emerald-500/15 border-emerald-500/30";
	if (score >= 0.5) return "bg-amber-500/15 border-amber-500/30";
	return "bg-red-500/15 border-red-500/30";
}

// Mini trend indicator showing HA colors
function MiniTrend({ haColor, count }: { haColor: string | null; count: number }) {
	const bars = [];
	for (let i = 0; i < 5; i++) {
		const isActive = i < count;
		const isGreen = haColor === "green";
		bars.push(
			<div
				key={i}
				className={cn(
					"w-1.5 h-3 rounded-sm transition-all",
					isActive
						? isGreen
							? "bg-emerald-400"
							: "bg-red-400"
						: "bg-muted/30"
				)}
			/>
		);
	}
	return <div className="flex gap-0.5 items-center">{bars}</div>;
}

// Confidence progress bar
function ConfidenceBar({ confidence }: { confidence?: ConfidenceResult }) {
	if (!confidence) return null;
	
	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-[10px]">
				<span className="text-muted-foreground">Confidence</span>
				<span className={cn("font-mono font-medium", confidenceColor(confidence.score))}>
					{(confidence.score * 100).toFixed(0)}%
				</span>
			</div>
			<div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
				<div
					className={cn(
						"h-full rounded-full transition-all duration-300",
						confidence.score >= 0.7 ? "bg-emerald-400" :
						confidence.score >= 0.5 ? "bg-amber-400" : "bg-red-400"
					)}
					style={{ width: `${confidence.score * 100}%` }}
				/>
			</div>
		</div>
	);
}

// Signal strength indicator (traffic light)
function SignalLight({ action, edge }: { action: string; edge: number | null }) {
	const edgeNum = edge ?? 0;
	let color = "bg-muted/50";
	let glow = "";
	
	if (action === "ENTER") {
		if (edgeNum >= 0.15) {
			color = "bg-emerald-400";
			glow = "shadow-emerald-400/50 shadow-md";
		} else if (edgeNum >= 0.08) {
			color = "bg-amber-400";
			glow = "shadow-amber-400/50 shadow-md";
		} else {
			color = "bg-yellow-400";
		}
	}
	
	return (
		<div className={cn(
			"w-2.5 h-2.5 rounded-full transition-all duration-300",
			color,
			glow
		)} />
	);
}

export function MarketCard({ market: m }: MarketCardProps) {
	if (!m.ok) {
		return (
			<Card className="border-red-500/30 bg-red-500/10">
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
	const confidence = m.confidence;

	return (
		<Card className={cn("relative overflow-hidden", phaseBg)}>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<SignalLight action={m.action} edge={m.edge} />
						<CardTitle className="text-base font-bold">{m.id}</CardTitle>
					</div>
					<div className="flex items-center gap-2">
						{m.phase && (
							<Badge variant="secondary" className="text-[11px] px-1.5 py-0">
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
						<span className="text-muted-foreground block">HA Trend</span>
						<div className="flex items-center gap-1.5">
							<MiniTrend haColor={m.haColor} count={m.haConsecutive} />
						</div>
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

				{/* Confidence bar */}
				{confidence && <ConfidenceBar confidence={confidence} />}

				<div
					className={cn(
						"rounded-md px-3 py-1.5 text-xs font-medium text-center border",
						isEntry
							? confidenceBg(confidence?.score ?? 0.5)
							: "bg-muted/50 text-muted-foreground border-transparent",
					)}
				>
					{isEntry ? (
						<span className="flex items-center justify-center gap-2">
							<span className="font-semibold">BUY {m.side}</span>
							<span className="text-muted-foreground">|</span>
							<span>Edge {((m.edge ?? 0) * 100).toFixed(1)}%</span>
							{confidence && (
								<>
									<span className="text-muted-foreground">|</span>
									<span className={confidenceColor(confidence.score)}>
										{confidence.level}
									</span>
								</>
							)}
						</span>
					) : (
						<span>NO TRADE ({m.reason ?? m.phase})</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
