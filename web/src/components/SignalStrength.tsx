import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConfidenceFactors, MarketSnapshot } from "@/lib/api";
import { CHART_COLORS, TOOLTIP_CONTENT_STYLE } from "@/lib/charts";
import { asNumber } from "@/lib/format";
import { levelBadgeClass, levelColor } from "@/lib/marketCardHelpers";

const FACTOR_LABELS: Record<string, string> = {
	indicatorAlignment: "Indicators",
	volatilityScore: "Volatility",
	orderbookScore: "Orderbook",
	timingScore: "Timing",
	regimeScore: "Regime",
};

interface RadarPoint {
	factor: string;
	value: number;
}

function buildRadarData(factors: ConfidenceFactors): RadarPoint[] {
	return [
		{ factor: "Indicators", value: Math.round((factors.indicatorAlignment ?? 0) * 100) },
		{ factor: "Volatility", value: Math.round((factors.volatilityScore ?? 0) * 100) },
		{ factor: "Orderbook", value: Math.round((factors.orderbookScore ?? 0) * 100) },
		{ factor: "Timing", value: Math.round((factors.timingScore ?? 0) * 100) },
		{ factor: "Regime", value: Math.round((factors.regimeScore ?? 0) * 100) },
	];
}

interface MarketRadarProps {
	market: MarketSnapshot;
}

function MarketRadar({ market }: MarketRadarProps) {
	const { confidence } = market;

	if (!confidence) {
		return (
			<div className="flex flex-col h-full items-center justify-center gap-1 p-4">
				<span className="text-xs font-bold text-muted-foreground">{market.label}</span>
				<span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">No data</span>
			</div>
		);
	}

	const radarData = buildRadarData(confidence.factors);
	const color = levelColor(confidence.level);

	return (
		<div className="flex flex-col items-center gap-1 p-2">
			<div className="flex items-center gap-2">
				<span className="text-xs font-bold text-foreground font-mono">{market.label}</span>
				<Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${levelBadgeClass(confidence.level)}`}>
					{confidence.level}
				</Badge>
			</div>
			<div className="relative w-full" style={{ height: 160 }}>
				<ResponsiveContainer width="100%" height="100%">
					<RadarChart data={radarData} margin={{ top: 8, right: 20, bottom: 8, left: 20 }}>
						<PolarGrid stroke={CHART_COLORS.grid} />
						<PolarAngleAxis dataKey="factor" tick={{ fontSize: 9, fill: CHART_COLORS.axis }} />
						<Radar
							name={market.label}
							dataKey="value"
							stroke={color}
							fill={color}
							fillOpacity={0.25}
							strokeWidth={1.5}
						/>
						<Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(value) => [`${asNumber(value, 0)}%`, "Score"]} />
					</RadarChart>
				</ResponsiveContainer>
				{/* Centered score overlay */}
				<div
					className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
					style={{ top: "50%", transform: "translateY(-50%)" }}
				>
					<span className="text-xl font-black font-mono leading-none" style={{ color }}>
						{Math.round(confidence.score * 100)}
					</span>
					<span className="text-[8px] text-muted-foreground/60 uppercase tracking-wider">score</span>
				</div>
			</div>
		</div>
	);
}

interface SignalStrengthProps {
	markets: MarketSnapshot[];
}

export function SignalStrength({ markets }: SignalStrengthProps) {
	const order = ["BTC", "ETH", "SOL", "XRP"];
	const sorted = [...markets].sort((a, b) => {
		const ai = order.indexOf(a.id);
		const bi = order.indexOf(b.id);
		return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
	});
	const activeMarkets = sorted.filter((m) => m.ok);

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
					Signal Confidence — 5-Factor Analysis
				</CardTitle>
				<p className="text-[10px] text-muted-foreground/60 mt-0.5">
					{Object.keys(FACTOR_LABELS)
						.map((k) => FACTOR_LABELS[k])
						.join(" · ")}
				</p>
			</CardHeader>
			<CardContent>
				{activeMarkets.length === 0 ? (
					<div className="h-40 flex items-center justify-center text-muted-foreground/50 text-xs uppercase tracking-wider border border-dashed border-border/50 rounded-lg">
						No market data
					</div>
				) : (
					<div className="grid grid-cols-2 xl:grid-cols-4 gap-2 divide-x divide-border/30">
					{sorted.map((m) => (
							<MarketRadar key={m.id} market={m} />
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
