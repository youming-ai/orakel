import {
	BarChart3,
	Clock,
	DollarSign,
	Hash,
	LayoutDashboard,
	List,
	Save,
	Settings2,
	Target,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
	ConfigPayload,
	MarketBreakdown,
	MarketSnapshot,
	PaperStats,
	PaperTradeEntry,
	RiskConfig,
	StrategyConfig,
	TradeRecord,
} from "@/lib/api";
import { SAVE_STATUS_TIMEOUT_MS, TIMING_BUCKETS } from "@/lib/constants";
import { asNumber, fmtDateTime, fmtTime } from "@/lib/format";
import { useConfigMutation } from "@/lib/queries";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MarketCard } from "./MarketCard";
import { TradeTable } from "./TradeTable";

interface AnalyticsTabsProps {
	stats: PaperStats | null;
	trades: PaperTradeEntry[];
	byMarket?: Record<string, MarketBreakdown>;
	config: {
		strategy: StrategyConfig;
		paperRisk: RiskConfig;
		liveRisk: RiskConfig;
	};
	markets: MarketSnapshot[];
	liveTrades: TradeRecord[];
	viewMode: ViewMode;
}

interface StrategyFormValues {
	edgeThresholdEarly: number;
	edgeThresholdMid: number;
	edgeThresholdLate: number;
	minProbEarly: number;
	minProbMid: number;
	minProbLate: number;
	blendVol: number;
	blendTa: number;
	maxTradeSizeUsdc: number;
	maxOpenPositions: number;
	dailyMaxLossUsdc: number;
	regimeCHOP: number;
	regimeRANGE: number;
	regimeTREND_ALIGNED: number;
	regimeTREND_OPPOSED: number;
}

const COLORS = {
	positive: "#34d399",
	negative: "#f87171",
	pending: "#fbbf24",
	axis: "#71717a",
	grid: "#2f2f3a",
	tipBg: "#1a1a2e",
};

function toStrategyFormValues(
	strategyRaw: StrategyConfig,
	riskRaw: RiskConfig,
): StrategyFormValues {
	const blend = strategyRaw.blendWeights;
	const regime = strategyRaw.regimeMultipliers;
	return {
		edgeThresholdEarly: asNumber(strategyRaw.edgeThresholdEarly, 0),
		edgeThresholdMid: asNumber(strategyRaw.edgeThresholdMid, 0),
		edgeThresholdLate: asNumber(strategyRaw.edgeThresholdLate, 0),
		minProbEarly: asNumber(strategyRaw.minProbEarly, 0),
		minProbMid: asNumber(strategyRaw.minProbMid, 0),
		minProbLate: asNumber(strategyRaw.minProbLate, 0),
		blendVol: asNumber(blend.vol, 0),
		blendTa: asNumber(blend.ta, 0),
		maxTradeSizeUsdc: asNumber(riskRaw.maxTradeSizeUsdc, 0),
		maxOpenPositions: asNumber(riskRaw.maxOpenPositions, 0),
		dailyMaxLossUsdc: asNumber(riskRaw.dailyMaxLossUsdc, 0),
		regimeCHOP: asNumber(regime.CHOP, 1),
		regimeRANGE: asNumber(regime.RANGE, 1),
		regimeTREND_ALIGNED: asNumber(regime.TREND_ALIGNED, 1),
		regimeTREND_OPPOSED: asNumber(regime.TREND_OPPOSED, 1),
	};
}

function buildStatsFromTrades(trades: PaperTradeEntry[]): PaperStats {
	let wins = 0;
	let losses = 0;
	let pending = 0;
	let totalPnl = 0;
	for (const trade of trades) {
		if (!trade.resolved) {
			pending += 1;
			continue;
		}
		if (trade.won) wins += 1;
		else losses += 1;
		totalPnl += trade.pnl ?? 0;
	}
	const resolved = wins + losses;
	return {
		totalTrades: trades.length,
		wins,
		losses,
		pending,
		winRate: resolved > 0 ? wins / resolved : 0,
		totalPnl: Number(totalPnl.toFixed(2)),
	};
}

function buildMarketFromTrades(
	trades: PaperTradeEntry[],
): Record<string, MarketBreakdown> {
	const marketMap = new Map<string, MarketBreakdown>();
	for (const trade of trades) {
		const current = marketMap.get(trade.marketId) ?? {
			wins: 0,
			losses: 0,
			pending: 0,
			winRate: 0,
			totalPnl: 0,
			tradeCount: 0,
		};
		current.tradeCount += 1;
		if (!trade.resolved) current.pending += 1;
		else if (trade.won) current.wins += 1;
		else current.losses += 1;
		current.totalPnl += trade.pnl ?? 0;
		marketMap.set(trade.marketId, current);
	}

	const result: Record<string, MarketBreakdown> = {};
	for (const [market, item] of marketMap.entries()) {
		const resolved = item.wins + item.losses;
		result[market] = {
			...item,
			winRate: resolved > 0 ? item.wins / resolved : 0,
			totalPnl: Number(item.totalPnl.toFixed(2)),
		};
	}
	return result;
}

export function AnalyticsTabs({
	stats,
	trades,
	byMarket,
	config,
	markets,
	liveTrades,
	viewMode,
}: AnalyticsTabsProps) {
	const configMutation = useConfigMutation(viewMode);
	const riskConfig = viewMode === "paper" ? config.paperRisk : config.liveRisk;
	const [form, setForm] = useState<StrategyFormValues>(() =>
		toStrategyFormValues(config.strategy, riskConfig),
	);
	const [saveStatus, setSaveStatus] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		if (!saveStatus) return;
		const timer = setTimeout(() => setSaveStatus(null), SAVE_STATUS_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [saveStatus]);

	useEffect(() => {
		setForm(
			toStrategyFormValues(
				config.strategy,
				viewMode === "paper" ? config.paperRisk : config.liveRisk,
			),
		);
	}, [config.strategy, config.paperRisk, config.liveRisk, viewMode]);

	const derivedStats = useMemo(() => buildStatsFromTrades(trades), [trades]);
	const mergedStats = useMemo(
		() => stats ?? derivedStats,
		[stats, derivedStats],
	);

	const marketStats = useMemo(() => {
		const client = buildMarketFromTrades(trades);
		if (Object.keys(client).length > 0) return client;
		return byMarket ?? {};
	}, [byMarket, trades]);

	const pnlTimeline = useMemo(() => {
		const resolved = trades
			.filter((t) => t.resolved && t.pnl !== null)
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		let running = 0;
		return resolved.map((trade) => {
			running += trade.pnl ?? 0;
			return {
				ts: trade.timestamp,
				time: fmtTime(trade.timestamp),
				market: trade.marketId,
				side: trade.side,
				pnl: trade.pnl ?? 0,
				cumulative: Number(running.toFixed(2)),
			};
		});
	}, [trades]);

	const timelinePositive =
		(pnlTimeline[pnlTimeline.length - 1]?.cumulative ?? 0) >= 0;

	const marketRows = useMemo(() => {
		return Object.entries(marketStats)
			.map(([market, item]) => ({
				market,
				trades: item.tradeCount,
				wins: item.wins,
				losses: item.losses,
				pending: item.pending,
				winRate: item.winRate,
				winRatePct: Number((item.winRate * 100).toFixed(1)),
				pnl: Number(item.totalPnl.toFixed(2)),
				resolvedCount: item.wins + item.losses,
			}))
			.sort((a, b) => b.pnl - a.pnl);
	}, [marketStats]);

	const timingData = useMemo(() => {
		const buckets = TIMING_BUCKETS.map((name) => ({
			name,
			count: 0,
			wins: 0,
			resolved: 0,
			winRate: 0,
		}));

		for (const trade of trades) {
			const ts = new Date(trade.timestamp).getTime();
			if (!Number.isFinite(ts) || !Number.isFinite(trade.windowStartMs))
				continue;
			const minuteInWindow = (ts - trade.windowStartMs) / 60000;
			const index = Math.max(0, Math.min(4, Math.floor(minuteInWindow / 3)));
			const bucket = buckets[index];
			bucket.count += 1;
			if (trade.resolved) {
				bucket.resolved += 1;
				if (trade.won) bucket.wins += 1;
			}
		}

		for (const bucket of buckets) {
			bucket.winRate = bucket.resolved > 0 ? bucket.wins / bucket.resolved : 0;
		}
		return buckets;
	}, [trades]);

	const sideData = useMemo(() => {
		const up = trades.filter((t) => t.side === "UP").length;
		const down = trades.filter((t) => t.side === "DOWN").length;
		return [
			{ name: "UP", value: up, color: COLORS.positive },
			{ name: "DOWN", value: down, color: COLORS.negative },
		];
	}, [trades]);

	const sideTotal = sideData[0].value + sideData[1].value;
	const blendSum = form.blendVol + form.blendTa;
	const blendValid = Math.abs(blendSum - 1) < 0.001;

	const strategyView: StrategyConfig = {
		edgeThresholdEarly: form.edgeThresholdEarly,
		edgeThresholdMid: form.edgeThresholdMid,
		edgeThresholdLate: form.edgeThresholdLate,
		minProbEarly: form.minProbEarly,
		minProbMid: form.minProbMid,
		minProbLate: form.minProbLate,
		blendWeights: { vol: form.blendVol, ta: form.blendTa },
		regimeMultipliers: {
			CHOP: form.regimeCHOP,
			RANGE: form.regimeRANGE,
			TREND_ALIGNED: form.regimeTREND_ALIGNED,
			TREND_OPPOSED: form.regimeTREND_OPPOSED,
		},
	};

	const riskView: RiskConfig = {
		maxTradeSizeUsdc: form.maxTradeSizeUsdc,
		maxOpenPositions: form.maxOpenPositions,
		dailyMaxLossUsdc: form.dailyMaxLossUsdc,
	};

	function saveConfig() {
		if (!blendValid) {
			setSaveStatus({
				type: "error",
				message: "Blend weights must sum to 1.00",
			});
			return;
		}
		setSaveStatus(null);

		const payload: ConfigPayload = {
			strategy: strategyView,
			...(viewMode === "paper"
				? { paperRisk: riskView }
				: { liveRisk: riskView }),
		};

		configMutation.mutate(payload, {
			onSuccess: () => {
				setSaveStatus({
					type: "success",
					message: "Config saved successfully",
				});
			},
			onError: (error) => {
				setSaveStatus({
					type: "error",
					message:
						error instanceof Error
							? `Save failed: ${error.message}`
							: "Save failed",
				});
			},
		});
	}

	function numberInput(
		value: number,
		onValue: (n: number) => void,
		step = 0.01,
		min = 0,
		max?: number,
	) {
		return (
			<input
				type="number"
				className="h-8 w-full rounded-md border border-border bg-input/30 px-2 text-xs font-mono outline-none focus:border-emerald-400"
				value={Number.isFinite(value) ? value : 0}
				min={min}
				max={max}
				step={step}
				onChange={(e) => {
					const n = asNumber(e.target.value, 0);
					onValue(
						max !== undefined
							? Math.min(max, Math.max(min, n))
							: Math.max(min, n),
					);
				}}
			/>
		);
	}

	return (
		<Tabs defaultValue="overview" className="space-y-4">
			<div className="overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
				<TabsList className="w-max min-w-full sm:w-auto">
					<TabsTrigger value="overview">
						<LayoutDashboard className="size-3.5" /> Overview
					</TabsTrigger>
					<TabsTrigger value="markets">
						<BarChart3 className="size-3.5" /> Markets
					</TabsTrigger>
					<TabsTrigger value="timing">
						<Clock className="size-3.5" /> Timing
					</TabsTrigger>
					<TabsTrigger value="trades">
						<List className="size-3.5" /> Trades
					</TabsTrigger>
					<TabsTrigger value="strategy">
						<Settings2 className="size-3.5" /> Strategy
					</TabsTrigger>
				</TabsList>
			</div>

			<TabsContent value="overview" className="space-y-4">
				<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
					<StatCard
						label="Trades"
						value={String(mergedStats.totalTrades)}
						icon={<Hash className="w-3.5 h-3.5" />}
					/>
					<StatCard
						label="Win Rate"
						value={
							mergedStats.wins + mergedStats.losses > 0
								? `${(mergedStats.winRate * 100).toFixed(1)}%`
								: "-"
						}
						color={
							mergedStats.winRate >= 0.5
								? "text-emerald-400"
								: mergedStats.winRate > 0
									? "text-red-400"
									: ""
						}
						icon={<Target className="w-3.5 h-3.5" />}
					/>
					<StatCard
						label="Wins"
						value={String(mergedStats.wins)}
						color="text-emerald-400"
						icon={<TrendingUp className="w-3.5 h-3.5" />}
					/>
					<StatCard
						label="Losses"
						value={String(mergedStats.losses)}
						color="text-red-400"
						icon={<TrendingDown className="w-3.5 h-3.5" />}
					/>
					<StatCard
						label="Total P&L"
						value={`${mergedStats.totalPnl >= 0 ? "+" : ""}${mergedStats.totalPnl.toFixed(2)}`}
						suffix="USDC"
						color={
							mergedStats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
						}
						icon={<DollarSign className="w-3.5 h-3.5" />}
					/>
				</div>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							Cumulative P&L
						</CardTitle>
					</CardHeader>
					<CardContent className="h-48 sm:h-72">
						{pnlTimeline.length === 0 ? (
							<EmptyPlaceholder />
						) : (
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart data={pnlTimeline}>
									<defs>
										<linearGradient
											id="timelineGrad"
											x1="0"
											y1="0"
											x2="0"
											y2="1"
										>
											<stop
												offset="5%"
												stopColor={
													timelinePositive ? COLORS.positive : COLORS.negative
												}
												stopOpacity={0.35}
											/>
											<stop
												offset="95%"
												stopColor={
													timelinePositive ? COLORS.positive : COLORS.negative
												}
												stopOpacity={0}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
									<XAxis
										dataKey="time"
										tick={{ fontSize: 11, fill: COLORS.axis }}
										minTickGap={24}
									/>
									<YAxis
										tick={{ fontSize: 11, fill: COLORS.axis }}
										tickFormatter={(v: number) => `${v.toFixed(1)}`}
										width={52}
									/>
									<Tooltip
										cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }}
										contentStyle={{
											background: COLORS.tipBg,
											border: "1px solid #3f3f46",
											borderRadius: 8,
											fontSize: 12,
										}}
										labelFormatter={(_, payload) => {
											const row = payload?.[0]?.payload as
												| {
														ts: string;
														market: string;
														side: string;
														pnl: number;
												  }
												| undefined;
											if (!row) return "-";
											return `${fmtDateTime(row.ts)}  ${row.market} ${row.side}`;
										}}
										formatter={(value, key, item) => {
											const v = asNumber(value, 0);
											const payload = item.payload as { pnl: number };
											if (String(key) === "cumulative")
												return [
													`${v >= 0 ? "+" : ""}${v.toFixed(2)} USDC`,
													"Cumulative P&L",
												];
											return [
												`${payload.pnl >= 0 ? "+" : ""}${payload.pnl.toFixed(2)} USDC`,
												"Per-Trade P&L",
											];
										}}
									/>
									<Area
										type="monotone"
										dataKey="cumulative"
										stroke={
											timelinePositive ? COLORS.positive : COLORS.negative
										}
										fill="url(#timelineGrad)"
										strokeWidth={2}
									/>
								</AreaChart>
							</ResponsiveContainer>
						)}
					</CardContent>
				</Card>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{markets.map((m) => (
						<MarketCard key={m.id} market={m} />
					))}
				</div>
			</TabsContent>

			<TabsContent value="markets" className="space-y-4">
				<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
								Win Rate by Market
							</CardTitle>
						</CardHeader>
						<CardContent className="h-56 sm:h-72">
							{marketRows.length === 0 ? (
								<EmptyPlaceholder />
							) : (
								<ResponsiveContainer width="100%" height="100%">
									<BarChart
										data={marketRows}
										layout="vertical"
										margin={{ right: 56 }}
									>
										<CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
										<XAxis
											type="number"
											domain={[0, 100]}
											tick={{ fontSize: 11, fill: COLORS.axis }}
										/>
										<YAxis
											type="category"
											dataKey="market"
											tick={{ fontSize: 12, fill: "#d4d4d8" }}
											width={48}
										/>
										<Tooltip
											contentStyle={{
												background: COLORS.tipBg,
												border: "1px solid #3f3f46",
												borderRadius: 8,
												fontSize: 12,
											}}
											formatter={(value, _, item) => {
												const v = asNumber(value, 0);
												const p = item.payload as {
													wins: number;
													resolvedCount: number;
												};
												return [
													`${v.toFixed(1)}% (${p.wins}/${p.resolvedCount})`,
													"Win Rate",
												];
											}}
										/>
										<Bar
											dataKey="winRatePct"
											radius={[4, 4, 4, 4]}
											label={(props) => {
												const idx = Number(props.index);
												const row = marketRows[idx];
												if (!row) return null;
												return (
													<text
														x={Number(props.x) + Number(props.width) + 8}
														y={Number(props.y) + Number(props.height) / 2 + 4}
														fill="#d4d4d8"
														fontSize={11}
													>
														{`${row.wins}/${row.resolvedCount}`}
													</text>
												);
											}}
										>
											{marketRows.map((row) => (
												<Cell
													key={row.market}
													fill={
														row.winRate >= 0.5
															? COLORS.positive
															: COLORS.negative
													}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
								P&L by Market
							</CardTitle>
						</CardHeader>
						<CardContent className="h-56 sm:h-72">
							{marketRows.length === 0 ? (
								<EmptyPlaceholder />
							) : (
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={marketRows}>
										<CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
										<XAxis
											dataKey="market"
											tick={{ fontSize: 11, fill: COLORS.axis }}
										/>
										<YAxis
											tick={{ fontSize: 11, fill: COLORS.axis }}
											width={52}
										/>
										<Tooltip
											contentStyle={{
												background: COLORS.tipBg,
												border: "1px solid #3f3f46",
												borderRadius: 8,
												fontSize: 12,
											}}
											formatter={(value) => {
												const v = asNumber(value, 0);
												return [
													`${v >= 0 ? "+" : ""}${v.toFixed(2)} USDC`,
													"Total P&L",
												];
											}}
										/>
										<Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
											{marketRows.map((row) => (
												<Cell
													key={`${row.market}-pnl`}
													fill={
														row.pnl >= 0 ? COLORS.positive : COLORS.negative
													}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							)}
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							Market Comparison
						</CardTitle>
					</CardHeader>
					<CardContent>
						{marketRows.length === 0 ? (
							<EmptyPlaceholder />
						) : (
							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Market</TableHead>
											<TableHead className="text-right hidden sm:table-cell">
												Trades
											</TableHead>
											<TableHead className="text-right hidden sm:table-cell">
												W
											</TableHead>
											<TableHead className="text-right hidden sm:table-cell">
												L
											</TableHead>
											<TableHead className="text-right">WR%</TableHead>
											<TableHead className="text-right">P&L</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{marketRows.map((row) => (
											<TableRow key={`table-${row.market}`}>
												<TableCell className="font-mono text-xs font-medium">
													{row.market}
												</TableCell>
												<TableCell className="font-mono text-xs text-right hidden sm:table-cell">
													{row.trades}
												</TableCell>
												<TableCell className="font-mono text-xs text-right text-emerald-400 hidden sm:table-cell">
													{row.wins}
												</TableCell>
												<TableCell className="font-mono text-xs text-right text-red-400 hidden sm:table-cell">
													{row.losses}
												</TableCell>
												<TableCell className="font-mono text-xs text-right">
													{row.winRatePct.toFixed(1)}%
												</TableCell>
												<TableCell
													className={cn(
														"font-mono text-xs text-right",
														row.pnl >= 0 ? "text-emerald-400" : "text-red-400",
													)}
												>
													{row.pnl >= 0 ? "+" : ""}
													{row.pnl.toFixed(2)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</TabsContent>

			<TabsContent value="timing" className="space-y-4">
				<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
								Entry Timing Distribution
							</CardTitle>
						</CardHeader>
						<CardContent className="h-56 sm:h-72">
							{trades.length === 0 ? (
								<EmptyPlaceholder />
							) : (
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={timingData}>
										<CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
										<XAxis
											dataKey="name"
											tick={{ fontSize: 11, fill: COLORS.axis }}
										/>
										<YAxis
											allowDecimals={false}
											tick={{ fontSize: 11, fill: COLORS.axis }}
											width={40}
										/>
										<Tooltip
											contentStyle={{
												background: COLORS.tipBg,
												border: "1px solid #3f3f46",
												borderRadius: 8,
												fontSize: 12,
											}}
											formatter={(value, _, item) => {
												const v = Math.round(asNumber(value, 0));
												const p = item.payload as {
													winRate: number;
													wins: number;
													resolved: number;
												};
												return [
													`${v} trades, WR ${(p.winRate * 100).toFixed(1)}% (${p.wins}/${p.resolved})`,
													"Entries",
												];
											}}
										/>
										<Bar dataKey="count" radius={[4, 4, 0, 0]}>
											{timingData.map((item) => (
												<Cell
													key={`timing-${item.name}`}
													fill={
														item.resolved === 0
															? COLORS.pending
															: item.winRate >= 0.5
																? COLORS.positive
																: COLORS.negative
													}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
								Direction Distribution
							</CardTitle>
						</CardHeader>
						<CardContent className="h-56 sm:h-72">
							{sideTotal === 0 ? (
								<EmptyPlaceholder />
							) : (
								<>
									<ResponsiveContainer width="100%" height="84%">
										<PieChart>
											<Pie
												data={sideData}
												dataKey="value"
												nameKey="name"
												innerRadius={56}
												outerRadius={90}
												paddingAngle={3}
												label={({ name, percent }) =>
													`${name} ${(Number(percent) * 100).toFixed(0)}%`
												}
												labelLine={false}
												fontSize={11}
											>
												{sideData.map((item) => (
													<Cell key={`side-${item.name}`} fill={item.color} />
												))}
											</Pie>
											<Tooltip
												contentStyle={{
													background: COLORS.tipBg,
													border: "1px solid #3f3f46",
													borderRadius: 8,
													fontSize: 12,
												}}
												formatter={(value) => {
													const v = Math.round(asNumber(value, 0));
													return [`${v} trades`, "Count"];
												}}
											/>
										</PieChart>
									</ResponsiveContainer>
									<div className="mt-2 flex items-center justify-center gap-3 text-xs">
										<Badge
											variant="secondary"
											className="bg-emerald-500/15 text-emerald-400 font-mono"
										>
											UP {sideData[0].value}
										</Badge>
										<Badge
											variant="secondary"
											className="bg-red-500/15 text-red-400 font-mono"
										>
											DOWN {sideData[1].value}
										</Badge>
									</div>
								</>
							)}
						</CardContent>
					</Card>
				</div>
			</TabsContent>

			<TabsContent value="trades" className="space-y-4">
				<div>
					<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
						{viewMode === "paper" ? "Paper Trades" : "Live Trades"}
					</h2>
					<TradeTable trades={liveTrades} paperMode={viewMode === "paper"} />
				</div>
			</TabsContent>

			<TabsContent value="strategy" className="space-y-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							Current Strategy Config
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<div className="space-y-1">
								<span className="text-[11px] text-muted-foreground block">
									Edge Threshold
								</span>
								<div className="font-mono text-xs space-y-0.5">
									<div>
										EARLY:{" "}
										<span className="text-emerald-400">
											{(strategyView.edgeThresholdEarly * 100).toFixed(1)}%
										</span>
									</div>
									<div>
										MID:{" "}
										<span className="text-amber-400">
											{(strategyView.edgeThresholdMid * 100).toFixed(1)}%
										</span>
									</div>
									<div>
										LATE:{" "}
										<span className="text-red-400">
											{(strategyView.edgeThresholdLate * 100).toFixed(1)}%
										</span>
									</div>
								</div>
							</div>
							<div className="space-y-1">
								<span className="text-[11px] text-muted-foreground block">
									Min Probability
								</span>
								<div className="font-mono text-xs space-y-0.5">
									<div>
										EARLY: {(strategyView.minProbEarly * 100).toFixed(1)}%
									</div>
									<div>MID: {(strategyView.minProbMid * 100).toFixed(1)}%</div>
									<div>
										LATE: {(strategyView.minProbLate * 100).toFixed(1)}%
									</div>
								</div>
							</div>
							<div className="space-y-1">
								<span className="text-[11px] text-muted-foreground block">
									Blend Weights
								</span>
								<div className="font-mono text-xs space-y-0.5">
									<div>
										Volatility:{" "}
										{(strategyView.blendWeights.vol * 100).toFixed(1)}%
									</div>
									<div>
										Technical: {(strategyView.blendWeights.ta * 100).toFixed(1)}
										%
									</div>
								</div>
							</div>
							<div className="space-y-1">
								<span className="text-[11px] text-muted-foreground block">
									Risk Config
								</span>
								<div className="font-mono text-xs space-y-0.5">
									<div>Per Trade: ${riskView.maxTradeSizeUsdc}</div>
									<div>Max Positions: {riskView.maxOpenPositions}</div>
									<div>Daily Loss Limit: ${riskView.dailyMaxLossUsdc}</div>
								</div>
							</div>
						</div>
						<div className="pt-2 border-t border-border">
							<span className="text-[11px] text-muted-foreground block mb-2">
								Regime Multipliers
							</span>
							<div className="flex flex-wrap gap-3 font-mono text-xs">
								<span>
									CHOP:{" "}
									<span className="text-amber-400">
										x{strategyView.regimeMultipliers.CHOP}
									</span>
								</span>
								<span>
									RANGE:{" "}
									<span className="text-muted-foreground">
										x{strategyView.regimeMultipliers.RANGE}
									</span>
								</span>
								<span>
									ALIGNED:{" "}
									<span className="text-emerald-400">
										x{strategyView.regimeMultipliers.TREND_ALIGNED}
									</span>
								</span>
								<span>
									OPPOSED:{" "}
									<span className="text-red-400">
										x{strategyView.regimeMultipliers.TREND_OPPOSED}
									</span>
								</span>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
							Strategy Tuning
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<ParamField label="Edge EARLY">
								{numberInput(form.edgeThresholdEarly, (v) =>
									setForm((s) => ({ ...s, edgeThresholdEarly: v })),
								)}
							</ParamField>
							<ParamField label="Edge MID">
								{numberInput(form.edgeThresholdMid, (v) =>
									setForm((s) => ({ ...s, edgeThresholdMid: v })),
								)}
							</ParamField>
							<ParamField label="Edge LATE">
								{numberInput(form.edgeThresholdLate, (v) =>
									setForm((s) => ({ ...s, edgeThresholdLate: v })),
								)}
							</ParamField>
							<ParamField label="MinProb EARLY">
								{numberInput(form.minProbEarly, (v) =>
									setForm((s) => ({ ...s, minProbEarly: v })),
								)}
							</ParamField>
							<ParamField label="MinProb MID">
								{numberInput(form.minProbMid, (v) =>
									setForm((s) => ({ ...s, minProbMid: v })),
								)}
							</ParamField>
							<ParamField label="MinProb LATE">
								{numberInput(form.minProbLate, (v) =>
									setForm((s) => ({ ...s, minProbLate: v })),
								)}
							</ParamField>
						</div>

						<Separator />

						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<ParamField label="Blend Volatility">
								{numberInput(
									form.blendVol,
									(v) => setForm((s) => ({ ...s, blendVol: v })),
									0.01,
									0,
									1,
								)}
							</ParamField>
							<ParamField label="Blend Technical">
								{numberInput(
									form.blendTa,
									(v) => setForm((s) => ({ ...s, blendTa: v })),
									0.01,
									0,
									1,
								)}
							</ParamField>
							<div className="space-y-1">
								<span className="text-[11px] text-muted-foreground block">
									Weight Check
								</span>
								<div
									className={cn(
										"h-8 rounded-md border px-2 flex items-center text-xs font-mono",
										blendValid
											? "border-emerald-500/40 text-emerald-400"
											: "border-amber-500/40 text-amber-400",
									)}
								>
									vol + ta = {blendSum.toFixed(3)}
								</div>
							</div>
						</div>

						<Separator />

						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<ParamField label="Max Trade USDC">
								{numberInput(
									form.maxTradeSizeUsdc,
									(v) => setForm((s) => ({ ...s, maxTradeSizeUsdc: v })),
									0.1,
									0,
								)}
							</ParamField>
							<ParamField label="Max Positions">
								{numberInput(
									form.maxOpenPositions,
									(v) => setForm((s) => ({ ...s, maxOpenPositions: v })),
									1,
									0,
								)}
							</ParamField>
							<ParamField label="Daily Loss USDC">
								{numberInput(
									form.dailyMaxLossUsdc,
									(v) => setForm((s) => ({ ...s, dailyMaxLossUsdc: v })),
									0.1,
									0,
								)}
							</ParamField>
						</div>

						<Separator />

						<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
							<ParamField label="CHOP">
								{numberInput(form.regimeCHOP, (v) =>
									setForm((s) => ({ ...s, regimeCHOP: v })),
								)}
							</ParamField>
							<ParamField label="RANGE">
								{numberInput(form.regimeRANGE, (v) =>
									setForm((s) => ({ ...s, regimeRANGE: v })),
								)}
							</ParamField>
							<ParamField label="TREND_ALIGNED">
								{numberInput(form.regimeTREND_ALIGNED, (v) =>
									setForm((s) => ({ ...s, regimeTREND_ALIGNED: v })),
								)}
							</ParamField>
							<ParamField label="TREND_OPPOSED">
								{numberInput(form.regimeTREND_OPPOSED, (v) =>
									setForm((s) => ({ ...s, regimeTREND_OPPOSED: v })),
								)}
							</ParamField>
						</div>

						<div className="flex flex-wrap items-center gap-3 pt-1">
							<Button
								size="sm"
								className="w-full sm:w-auto"
								onClick={saveConfig}
								disabled={configMutation.isPending || !blendValid}
							>
								{configMutation.isPending ? (
									"Saving..."
								) : (
									<>
										<Save className="w-3.5 h-3.5 mr-1.5 inline-block" />
										Save Config
									</>
								)}
							</Button>
							{saveStatus && (
								<span
									className={cn(
										"text-xs",
										saveStatus.type === "success"
											? "text-emerald-400"
											: "text-red-400",
									)}
								>
									{saveStatus.message}
								</span>
							)}
						</div>
					</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	);
}

function ParamField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1">
			<span className="text-[11px] text-muted-foreground block">{label}</span>
			{children}
		</div>
	);
}

function EmptyPlaceholder() {
	return (
		<div className="h-full flex items-center justify-center text-xs text-muted-foreground">
			No data
		</div>
	);
}

function StatCard({
	label,
	value,
	color,
	suffix,
	icon,
}: {
	label: string;
	value: string;
	color?: string;
	suffix?: string;
	icon?: React.ReactNode;
}) {
	return (
		<Card>
			<CardContent className="py-3 px-4">
				<span className="text-[11px] text-muted-foreground flex items-center gap-1">
					{icon}
					{label}
				</span>
				<span className={cn("font-mono text-lg font-bold block", color)}>
					{value}
					{suffix && (
						<span className="text-xs font-normal text-muted-foreground ml-1">
							{suffix}
						</span>
					)}
				</span>
			</CardContent>
		</Card>
	);
}
