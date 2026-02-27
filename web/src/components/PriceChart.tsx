import { useEffect, useRef, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketSnapshot } from "@/lib/api";
import { CHART_COLORS, TOOLTIP_CONTENT_STYLE, TOOLTIP_CURSOR_STYLE } from "@/lib/charts";
import { asNumber, fmtPrice, fmtTimeShort } from "@/lib/format";
import { ChartErrorBoundary } from "./ChartErrorBoundary";

const MARKETS = ["BTC", "ETH", "SOL", "XRP"] as const;
const MAX_POINTS = 60;

interface PricePoint {
	time: string;
	ts: number;
	price: number;
	priceToBeat: number | null;
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

export function PriceChart({ markets }: PriceChartProps) {
	const [selectedMarket, setSelectedMarket] = useState<string>("BTC");
	const priceHistoryRef = useRef<Record<string, PricePoint[]>>({
		BTC: [],
		ETH: [],
		SOL: [],
		XRP: [],
	});
	const [, forceUpdate] = useState(0);

	const market = markets.find((m) => m.id === selectedMarket);

	useEffect(() => {
		if (!market || market.spotPrice === null) return;

		const now = Date.now();
		const history = priceHistoryRef.current;

		const newPoint: PricePoint = {
			time: new Date(now).toISOString(),
			ts: now,
			price: market.spotPrice,
			priceToBeat: market.priceToBeat,
			isTrade: market.action === "ENTER",
			tradeSide: market.action === "ENTER" ? (market.side as "UP" | "DOWN" | null) : null,
		};

		const marketHistory = history[market.id] ?? [];
		const updated = [...marketHistory, newPoint].slice(-MAX_POINTS);
		priceHistoryRef.current = { ...history, [market.id]: updated };
		forceUpdate((n) => n + 1);
	}, [market]);

	const history = priceHistoryRef.current[selectedMarket] ?? [];
	const priceToBeat = market?.priceToBeat ?? null;
	const lastPrice = history[history.length - 1]?.price ?? null;
	const priceAbove = lastPrice !== null && priceToBeat !== null && lastPrice > priceToBeat;

	const gradientId = `priceGrad-${selectedMarket}`;
	const gradientColor = priceAbove ? CHART_COLORS.positive : CHART_COLORS.negative;

	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Price vs Target</CardTitle>
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
			</CardHeader>
			<CardContent className="h-[200px]">
				{history.length < 2 ? (
					<div className="h-full w-full flex flex-col items-center justify-center p-6 text-muted-foreground bg-muted/5 rounded-lg border border-dashed border-border/50">
						<span className="text-[10px] font-medium uppercase tracking-widest opacity-60">Accumulating data…</span>
					</div>
				) : (
					<ChartErrorBoundary>
						<ResponsiveContainer width="100%" height="100%">
							<AreaChart data={history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
									tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
									tickFormatter={(v: number) => fmtPrice(selectedMarket, v).replace("$", "")}
									width={56}
									domain={["auto", "auto"]}
								/>
								{priceToBeat !== null && (
									<ReferenceLine
										y={priceToBeat}
										stroke={CHART_COLORS.axis}
										strokeDasharray="5 3"
										strokeWidth={1.5}
										label={{
											value: "Target",
											position: "insideTopRight",
											fontSize: 9,
											fill: CHART_COLORS.axis,
										}}
									/>
								)}
								<Tooltip
									cursor={TOOLTIP_CURSOR_STYLE}
									contentStyle={TOOLTIP_CONTENT_STYLE}
						labelFormatter={(label) => fmtTimeShort(typeof label === "string" ? label : "")}
						formatter={(value, _key, item) => {
							const v = asNumber(value, 0);
							const p = (item as { payload: PricePoint }).payload;
							const priceLabel = fmtPrice(selectedMarket, v);
							return p.isTrade ? [`${priceLabel} ▶ ${p.tradeSide} ENTRY`, "Price"] : [priceLabel, "Spot Price"];
						}}
								/>
								<Area
									type="monotone"
									dataKey="price"
									stroke={gradientColor}
									fill={`url(#${gradientId})`}
									strokeWidth={2}
									dot={(props: CustomDotProps) => <TradeDot key={`dot-${props.payload?.ts}`} {...props} />}
									activeDot={{ r: 4 }}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</ChartErrorBoundary>
				)}
			</CardContent>
		</Card>
	);
}
