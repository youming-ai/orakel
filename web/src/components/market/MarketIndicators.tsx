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
