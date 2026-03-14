/**
 * Shared chart constants for Recharts components
 * Consolidates colors, tooltip styles, and common chart configurations
 */

export const CHART_COLORS = {
	/** Success/positive values (emerald) */
	positive: "var(--chart-2, #10b981)",
	/** Danger/negative values (red) */
	negative: "var(--chart-5, #ef4444)",
	/** Warning/pending values (amber) */
	pending: "var(--chart-1, #f59e0b)",
	/** Axis labels and text */
	axis: "var(--muted-foreground)",
	/** Grid lines */
	grid: "var(--border)",
	/** Tooltip background */
	tipBg: "var(--card)",
	/** Tooltip border */
	tipBorder: "var(--border)",
	/** Cursor stroke */
	cursor: "var(--muted-foreground)",
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
	responsive: "w-full h-44 sm:h-72 lg:h-96",
} as const;

/**
 * Add a starting point (cumulative = 0) to make chart animation start from zero line
 */
export function addTimelineStartPoint<T extends { cumulative: number }>(
	timeline: T[],
): Array<T & { isFirst: boolean }> {
	if (timeline.length === 0) return [];
	const firstPoint = timeline[0];
	return [
		{
			...firstPoint,
			cumulative: 0,
			pnl: 0,
			isFirst: true,
		} as T & { isFirst: boolean },
		...timeline.map((item) => ({ ...item, isFirst: false })),
	];
}
