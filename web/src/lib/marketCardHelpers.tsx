import type { MarketSnapshot } from "@/lib/api";
import { CHART_COLORS } from "@/lib/charts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared helpers used by MarketCard, MarketCardWithSignal, and SignalStrength
// ---------------------------------------------------------------------------

/** MACD histogram label + color class */
export function macdLabel(macd: MarketSnapshot["macd"]): {
	text: string;
	color: string;
} {
	if (!macd) return { text: "---", color: "text-muted-foreground" };
	if (macd.hist > 0 && (macd.histDelta ?? 0) > 0) return { text: "bullish", color: "text-emerald-400" };
	if (macd.hist > 0) return { text: "green", color: "text-emerald-400/70" };
	if (macd.hist < 0 && (macd.histDelta ?? 0) < 0) return { text: "bearish", color: "text-red-400" };
	return { text: "red", color: "text-red-400/70" };
}

/** Confidence score → text color class */
export function confidenceColor(score: number): string {
	if (score >= 0.7) return "text-emerald-400";
	if (score >= 0.5) return "text-amber-400";
	return "text-red-400";
}

/** Confidence score → background + border class */
export function confidenceBg(score: number): string {
	if (score >= 0.7) return "bg-emerald-500/15 border-emerald-500/30";
	if (score >= 0.5) return "bg-amber-500/15 border-amber-500/30";
	return "bg-red-500/15 border-red-500/30";
}

/** Confidence level → chart color */
export function levelColor(level: "HIGH" | "MEDIUM" | "LOW"): string {
	if (level === "HIGH") return CHART_COLORS.positive;
	if (level === "MEDIUM") return CHART_COLORS.pending;
	return CHART_COLORS.negative;
}

/** Confidence level → badge class */
export function levelBadgeClass(level: "HIGH" | "MEDIUM" | "LOW"): string {
	if (level === "HIGH") return "bg-emerald-500/15 text-emerald-400";
	if (level === "MEDIUM") return "bg-amber-500/15 text-amber-400";
	return "bg-red-500/15 text-red-400";
}

/** Mini Heiken-Ashi trend bars */
export function MiniTrend({ haColor, count }: { haColor: string | null; count: number }) {
	const bars = [];
	for (let i = 0; i < 5; i++) {
		const isActive = i < count;
		const isGreen = haColor === "green";
		bars.push(
			<div
				key={i}
				className={cn(
					"w-1.5 h-3 rounded-sm transition-all",
					isActive ? (isGreen ? "bg-emerald-400" : "bg-red-400") : "bg-muted/30",
				)}
			/>,
		);
	}
	return <div className="flex gap-0.5 items-center">{bars}</div>;
}

/** Signal strength traffic-light dot */
export function SignalLight({ action, edge }: { action: string; edge: number | null }) {
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

	return <div className={cn("w-2.5 h-2.5 rounded-full transition-all duration-300", color, glow)} />;
}
