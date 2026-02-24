/**
 * Shared chart constants for Recharts components
 * Consolidates colors, tooltip styles, and common chart configurations
 */

export const CHART_COLORS = {
	/** Success/positive values (emerald) */
	positive: "#34d399",
	/** Danger/negative values (red) */
	negative: "#f87171",
	/** Warning/pending values (amber) */
	pending: "#fbbf24",
	/** Axis labels and text */
	axis: "#71717a",
	/** Grid lines */
	grid: "#2f2f3a",
	/** Tooltip background */
	tipBg: "#1a1a2e",
	/** Tooltip border */
	tipBorder: "#3f3f46",
	/** Cursor stroke */
	cursor: "#52525b",
} as const;

/**
 * Shared tooltip content style for Recharts
 * Usage: <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
 */
export const TOOLTIP_CONTENT_STYLE: React.CSSProperties = {
	background: CHART_COLORS.tipBg,
	border: `1px solid ${CHART_COLORS.tipBorder}`,
	borderRadius: 8,
	fontSize: 12,
};

/**
 * Shared tooltip cursor style for Recharts
 * Usage: <Tooltip cursor={TOOLTIP_CURSOR_STYLE} />
 */
export const TOOLTIP_CURSOR_STYLE = {
	stroke: CHART_COLORS.cursor,
	strokeDasharray: "3 3",
};

/**
 * Chart height classes for responsive layouts
 */
export const CHART_HEIGHT = {
	/** Default chart height: smaller on mobile, larger on desktop */
	responsive: "h-48 sm:h-72",
	/** Taller chart for detailed views */
	tall: "h-56 sm:h-72",
	/** Fixed height for compact displays */
	compact: "h-48",
} as const;
