import { cva } from "class-variance-authority";

// ---------------------------------------------------------------------------
// Sentiment — positive/negative text color for direction, P&L, indicators
// ---------------------------------------------------------------------------

export const sentimentText = cva("", {
	variants: {
		sentiment: {
			positive: "text-emerald-400",
			negative: "text-red-400",
			neutral: "text-foreground",
			muted: "text-muted-foreground",
		},
	},
	defaultVariants: { sentiment: "neutral" },
});

// ---------------------------------------------------------------------------
// Side badge — UP/DOWN tinted background (trade tables)
// ---------------------------------------------------------------------------

export const sideBadge = cva("", {
	variants: {
		side: {
			up: "bg-emerald-500/15 text-emerald-400",
			down: "bg-red-500/15 text-red-400",
		},
	},
});

// ---------------------------------------------------------------------------
// Mode badge — PAPER / LIVE (trade tables)
// ---------------------------------------------------------------------------

export const modeBadge = cva("", {
	variants: {
		mode: {
			paper: "bg-amber-500/15 text-amber-400 border-amber-500/30",
			live: "bg-blue-500/15 text-blue-400 border-blue-500/30",
		},
	},
});

// ---------------------------------------------------------------------------
// Confidence — text, surface (bg+border), bar fill
// ---------------------------------------------------------------------------

export const confidenceText = cva("", {
	variants: {
		level: {
			high: "text-emerald-400",
			medium: "text-amber-400",
			low: "text-red-400",
		},
	},
});

export const confidenceSurface = cva("", {
	variants: {
		level: {
			high: "bg-emerald-500/15 border-emerald-500/30",
			medium: "bg-amber-500/15 border-amber-500/30",
			low: "bg-red-500/15 border-red-500/30",
		},
	},
});

export const confidenceBarFill = cva("h-full rounded-full transition-all duration-300", {
	variants: {
		level: {
			high: "bg-emerald-400",
			medium: "bg-amber-400",
			low: "bg-red-400",
		},
	},
});

// ---------------------------------------------------------------------------
// Signal light — market action indicator dot
// ---------------------------------------------------------------------------

export const signalLightDot = cva("w-2.5 h-2.5 rounded-full transition-all duration-300", {
	variants: {
		strength: {
			strong: "bg-emerald-400 shadow-emerald-400/50 shadow-md",
			moderate: "bg-amber-400 shadow-amber-400/50 shadow-md",
			weak: "bg-yellow-400",
			off: "bg-muted/50",
		},
	},
	defaultVariants: { strength: "off" },
});

// ---------------------------------------------------------------------------
// Trend bar — MiniTrend segment
// ---------------------------------------------------------------------------

export const trendBar = cva("w-1.5 h-3 rounded-sm transition-all", {
	variants: {
		state: {
			activeUp: "bg-emerald-400",
			activeDown: "bg-red-400",
			inactive: "bg-muted/30",
		},
	},
	defaultVariants: { state: "inactive" },
});

// ---------------------------------------------------------------------------
// Value → variant mappers
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "high" | "medium" | "low";

export function toConfidenceLevel(score: number): ConfidenceLevel {
	if (score >= 0.7) return "high";
	if (score >= 0.5) return "medium";
	return "low";
}

export type SignalStrength = "strong" | "moderate" | "weak" | "off";

export function toSignalStrength(action: string, edge: number | null): SignalStrength {
	if (action !== "ENTER") return "off";
	const edgeNum = edge ?? 0;
	if (edgeNum >= 0.15) return "strong";
	if (edgeNum >= 0.08) return "moderate";
	return "weak";
}
