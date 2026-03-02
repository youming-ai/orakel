import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketSnapshot, TimeframeId } from "@/lib/api";
import { CHART_COLORS, TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR_STYLE } from "@/lib/charts";
import { MARKETS } from "@/lib/constants";
import { asNumber, fmtCents, fmtPrice, fmtTime, fmtTimeShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartErrorBoundary } from "./ChartErrorBoundary";

const MAX_POINTS = 60;
const TF_OPTIONS: TimeframeId[] = ["15m", "1h", "4h"];

interface PricePoint {
	time: string;
	ts: number;
	price: number;
	priceToBeat: number | null;
	marketUp: number | null;
	marketDown: number | null;
	isTrade: boolean;
	tradeSide: "UP" | "DOWN" | null;
}

interface PriceChartProps {
	markets: MarketSnapshot[];
}

interface CustomDotProps {
	cx?: number;
	cy?: number;
	payload?: PricePoint;
}

function TradeDot({ cx = 0, cy = 0, payload }: CustomDotProps) {
	if (!payload?.isTrade || !payload.tradeSide) return null;
	const isUp = payload.tradeSide === "UP";
	return (
		<circle
			cx={cx}
			cy={cy}
			r={5}
			fill={isUp ? CHART_COLORS.positive : CHART_COLORS.negative}
			stroke={isUp ? "#065f46" : "#7f1d1d"}
			strokeWidth={1.5}
		/>
	);
}

function tfButtonColor(tf: string, selected: boolean): string {
	if (!selected) return "bg-muted/40 text-muted-foreground hover:bg-muted/60";
	if (tf === "1h") return "bg-blue-500/20 border-blue-500/40 text-blue-400";
	if (tf === "4h") return "bg-purple-500/20 border-purple-500/40 text-purple-400";
	return "bg-primary text-primary-foreground";
}

export const PriceChart = memo(function PriceChart({ markets }: PriceChartProps) {
	const [selectedMarket, setSelectedMarket] = useState<string>("BTC");
	const [selectedTf, setSelectedTf] = useState<TimeframeId>("15m");
	const priceHistoryRef = useRef<Record<string, PricePoint[]>>({});
	const [, forceUpdate] = useState(0);

	// Compute which timeframes are available for current market
	const availableTimeframes = useMemo(() => {
		const tfs = new Set<TimeframeId>();
		for (const m of markets) {
			if (m.id === selectedMarket && m.timeframe) {
				tfs.add(m.timeframe);
			}
		}
		// Ensure at least "15m" is available
		if (tfs.size === 0) tfs.add("15m");
		return TF_OPTIONS.filter((tf) => tfs.has(tf));
	}, [markets, selectedMarket]);

	// Auto-correct selectedTf if not available for this market
	useEffect(() => {
		if (!availableTimeframes.includes(selectedTf)) {
			setSelectedTf(availableTimeframes[0] ?? "15m");
		}
	}, [availableTimeframes, selectedTf]);

	// Composite key for price history: "BTC-15m"
	const historyKey = `${selectedMarket}-${selectedTf}`;

	// Find market by both id AND timeframe
	const market = markets.find((m) => m.id === selectedMarket && (m.timeframe ?? "15m") === selectedTf);
	const marketId = market?.id;
	const marketTf = market?.timeframe ?? "15m";
	const spotPrice = market?.spotPrice ?? null;
	const marketPriceToBeat = market?.priceToBeat ?? null;
	const marketAction = market?.action;
	const marketSide = market?.side;
	const marketUpPrice = market?.marketUp ?? null;
	const marketDownPrice = market?.marketDown ?? null;

	useEffect(() => {
		if (!marketId || spotPrice === null) return;

		const now = Date.now();
		const history = priceHistoryRef.current;
		const key = `${marketId}-${marketTf}`;

		const newPoint: PricePoint = {
			time: new Date(now).toISOString(),
			ts: now,
			price: spotPrice,
			priceToBeat: marketPriceToBeat,
			marketUp: marketUpPrice,
			marketDown: marketDownPrice,
			isTrade: marketAction === "ENTER",
			tradeSide: marketAction === "ENTER" ? (marketSide as "UP" | "DOWN" | null) : null,
		};

		const marketHistory = history[key] ?? [];
		const updated = [...marketHistory, newPoint].slice(-MAX_POINTS);
		priceHistoryRef.current = { ...history, [key]: updated };
		forceUpdate((n) => n + 1);
	}, [marketId, marketTf, spotPrice, marketPriceToBeat, marketUpPrice, marketDownPrice, marketAction, marketSide]);

	const history = priceHistoryRef.current[historyKey] ?? [];
	const priceToBeat = market?.priceToBeat ?? null;
	const lastPrice = history[history.length - 1]?.price ?? null;
	const priceAbove = lastPrice !== null && priceToBeat !== null && lastPrice > priceToBeat;

	const gradientId = `priceGrad-${historyKey}`;
	const gradientColor = priceAbove ? CHART_COLORS.positive : CHART_COLORS.negative;

	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between flex-wrap gap-2">
					<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Price vs Target</CardTitle>
					<div className="flex items-center gap-3">
						{/* Timeframe selector */}
						<div className="flex gap-0.5">
							{availableTimeframes.map((tf) => (
								<button
									key={tf}
									type="button"
									onClick={() => setSelectedTf(tf)}
									className={cn(
										"px-2 py-1 text-[10px] rounded font-mono font-semibold transition-colors border",
										tfButtonColor(tf, selectedTf === tf),
									)}
								>
									{tf}
								</button>
							))}
						</div>
						{/* Market selector */}
						<div className="flex gap-1">
							{MARKETS.map((m) => (
								<button
									key={m}
									type="button"
									onClick={() => setSelectedMarket(m)}
									className={`px-2.5 py-1 text-xs rounded font-mono font-semibold transition-colors ${
										selectedMarket === m
											? "bg-primary text-primary-foreground"
											: "bg-muted/40 text-muted-foreground hover:bg-muted/60"
									}`}
								>
									{m}
								</button>
							))}
						</div>
					</div>
				</div>
			</CardHeader>
			<CardContent className="h-[200px]">
				{history.length < 2 ? (
					<div className="h-full w-full flex flex-col items-center justify-center p-6 text-muted-foreground bg-muted/5 rounded-lg border border-dashed border-border/50">
						<span className="text-[10px] font-medium uppercase tracking-widest opacity-60">Accumulating data…</span>
					</div>
				) : (
					<ChartErrorBoundary>
						<ResponsiveContainer width="100%" height="100%">
							<ComposedChart data={history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
								<defs>
									<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
										<stop offset="5%" stopColor={gradientColor} stopOpacity={0.3} />
										<stop offset="95%" stopColor={gradientColor} stopOpacity={0} />
									</linearGradient>
								</defs>
								<CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
								<XAxis
									dataKey="time"
									tickFormatter={(v: string) => fmtTimeShort(v)}
									tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
									minTickGap={32}
									interval="preserveStartEnd"
								/>
								<YAxis
									yAxisId="left"
									tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
									tickFormatter={(v: number) => fmtPrice(selectedMarket, v).replace("$", "")}
									width={56}
									domain={["auto", "auto"]}
								/>
								<YAxis
									yAxisId="right"
									orientation="right"
									tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
									tickFormatter={(v: number) => `${(v * 100).toFixed(0)}¢`}
									width={36}
									domain={[0, 1]}
								/>
								{priceToBeat !== null && (
									<ReferenceLine
										yAxisId="left"
										y={priceToBeat}
										stroke={CHART_COLORS.axis}
										strokeDasharray="5 3"
										strokeWidth={1.5}
										label={{
											value: `Target (${selectedTf})`,
											position: "insideTopRight",
											fontSize: 9,
											fill: CHART_COLORS.axis,
										}}
									/>
								)}
								<Tooltip
									cursor={TOOLTIP_CURSOR_STYLE}
									contentStyle={TOOLTIP_CONTENT_STYLE}
									labelFormatter={(label) => fmtTime(typeof label === "string" ? label : "")}
									formatter={(value, name, item) => {
										const v = asNumber(value, 0);
										if (name === "marketUp") return [fmtCents(v), "Mkt UP"];
										if (name === "marketDown") return [fmtCents(v), "Mkt DN"];
										const p = item?.payload as PricePoint | undefined;
										const priceLabel = fmtPrice(selectedMarket, v);
										if (p?.isTrade) return [`${priceLabel} \u25b6 ${p.tradeSide} ENTRY`, "Spot"];
										return [priceLabel, "Spot"];
									}}
								/>
								<Area
									yAxisId="left"
									type="monotone"
									dataKey="price"
									stroke={gradientColor}
									fill={`url(#${gradientId})`}
									strokeWidth={2}
									dot={(props: CustomDotProps) => <TradeDot key={`dot-${props.payload?.ts}`} {...props} />}
									activeDot={{ r: 4 }}
								/>
								<Line
									yAxisId="right"
									type="monotone"
									dataKey="marketUp"
									stroke={CHART_COLORS.positive}
									strokeWidth={1.5}
									strokeDasharray="4 2"
									dot={false}
									connectNulls
									opacity={0.7}
								/>
								<Line
									yAxisId="right"
									type="monotone"
									dataKey="marketDown"
									stroke={CHART_COLORS.negative}
									strokeWidth={1.5}
									strokeDasharray="4 2"
									dot={false}
									connectNulls
									opacity={0.7}
								/>
							</ComposedChart>
						</ResponsiveContainer>
					</ChartErrorBoundary>
				)}
			</CardContent>
		</Card>
	);
});
