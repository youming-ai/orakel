import type { ConfidenceResult, MarketSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	confidenceBarFill,
	confidenceText,
	signalLightDot,
	toConfidenceLevel,
	toSignalStrength,
	trendBar,
} from "@/lib/variants";

export function macdLabel(macd: MarketSnapshot["macd"]): { text: string; color: string } {
	if (!macd) return { text: "---", color: "text-muted-foreground" };
	if (macd.hist > 0 && (macd.histDelta ?? 0) > 0) return { text: "bullish", color: "text-emerald-400" };
	if (macd.hist > 0) return { text: "green", color: "text-emerald-400/70" };
	if (macd.hist < 0 && (macd.histDelta ?? 0) < 0) return { text: "bearish", color: "text-red-400" };
	return { text: "red", color: "text-red-400/70" };
}

export function MiniTrend({ haColor, count }: { haColor: string | null; count: number }) {
	const isGreen = haColor === "green";
	const bars = [];
	for (let i = 0; i < 5; i++) {
		const state = i >= count ? "inactive" : isGreen ? "activeUp" : "activeDown";
		bars.push(<div key={i} className={trendBar({ state })} />);
	}
	return <div className="flex gap-0.5 items-center">{bars}</div>;
}

interface SimplifiedIndicatorsProps {
	market: MarketSnapshot;
}

export function SimplifiedIndicators({ market: m }: SimplifiedIndicatorsProps) {
	const activeHaDots = Math.min(Math.max(m.haConsecutive ?? 0, 0), 3);
	const haDotColor = m.haColor === "green" ? "bg-emerald-500" : "bg-red-500";

	const rsiValue = m.rsi;
	const rsiColor =
		rsiValue === null
			? "text-muted-foreground"
			: rsiValue > 70
				? "text-red-400"
				: rsiValue < 30
					? "text-emerald-400"
					: "text-muted-foreground";

	const vwapPosition = (m.vwapSlope ?? 0) > 0 ? "Above" : "Below";
	const imbalanceValue = m.orderbookImbalance;
	const imbalanceColor =
		imbalanceValue === null ? "text-muted-foreground" : imbalanceValue >= 0 ? "text-emerald-400" : "text-red-400";

	return (
		<div className="flex items-center justify-between text-[11px]">
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">HA</span>
				<div className="flex items-center gap-0.5">
					{["ha-a", "ha-b", "ha-c"].map((dotKey, i) => (
						<div
							key={dotKey}
							className={cn("h-1.5 w-1.5 rounded-full", i < activeHaDots ? haDotColor : "bg-muted/40")}
						/>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">RSI</span>
				<span className={cn("font-mono font-medium", rsiColor)}>{rsiValue === null ? "-" : rsiValue.toFixed(1)}</span>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">VWAP</span>
				<span className="font-mono font-medium">{vwapPosition}</span>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">Imb</span>
				<span className={cn("font-mono font-medium", imbalanceColor)}>
					{imbalanceValue === null ? "-" : `${(imbalanceValue * 100).toFixed(0)}%`}
				</span>
			</div>
		</div>
	);
}

export function ConfidenceBar({ confidence }: { confidence?: ConfidenceResult }) {
	if (!confidence) return null;
	const level = toConfidenceLevel(confidence.score);

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-[10px]">
				<span className="text-muted-foreground">Confidence</span>
				<span className={cn("font-mono font-medium", confidenceText({ level }))}>
					{(confidence.score * 100).toFixed(0)}%
				</span>
			</div>
			<div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
				<div className={confidenceBarFill({ level })} style={{ width: `${confidence.score * 100}%` }} />
			</div>
		</div>
	);
}

export function SignalLight({ action, edge }: { action: string; edge: number | null }) {
	return <div className={signalLightDot({ strength: toSignalStrength(action, edge) })} />;
}



export function SimplifiedIndicators({ market: m }: { market: MarketSnapshot }) {
	// HA Trend dots
	const haDots = Array.from({ length: Math.min(m.haConsecutive ?? 0, 3) }, (_, i) => (
		<div
			key={i}
			className={cn(
				"w-1.5 h-1.5 rounded-full",
				m.haColor === "green" ? "bg-emerald-500" : "bg-red-500"
			)}
		/>
	));

	// RSI color
	const rsiValue = m.rsi ?? 50;
	const rsiColor = rsiValue > 70 ? "text-red-400" : rsiValue < 30 ? "text-emerald-400" : "text-muted-foreground";

	// VWAP position
	const vwapPosition = (m.vwapSlope ?? 0) > 0 ? "Above" : "Below";

	return (
		<div className="flex items-center justify-between text-[11px]">
			{/* HA Trend */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">HA</span>
				<div className="flex gap-0.5">{haDots}</div>
			</div>

			{/* RSI */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">RSI</span>
				<span className={cn("font-mono font-medium", rsiColor)}>
					{m.rsi?.toFixed(1) ?? "-"}
				</span>
			</div>

			{/* VWAP */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">VWAP</span>
				<span className="font-mono font-medium">{vwapPosition}</span>
			</div>

			{/* Imbalance */}
			<div className="flex flex-col gap-1">
				<span className="text-[10px] uppercase text-muted-foreground">Imb</span>
				<span className={cn(
					"font-mono font-medium",
					(m.orderbookImbalance ?? 0) > 0 ? "text-emerald-400" : "text-red-400"
				)}>
					{m.orderbookImbalance !== null ? `${(m.orderbookImbalance * 100).toFixed(0)}%` : "-"}
				</span>
			</div>
		</div>
	);
}
