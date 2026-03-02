import { useEffect, useMemo, useState } from "react";
import type {
	ConfigPayload,
	MarketBreakdown,
	MarketSnapshot,
	PaperStats,
	PaperTradeEntry,
	RiskConfig,
	StopLossStatus,
	StrategyConfig,
	TimeframeId,
	TodayStats,
	TradeRecord,
} from "@/lib/api";
import { CHART_COLORS } from "@/lib/charts";
import { TIMEFRAME_WINDOW_MINUTES, TIMING_BUCKETS_BY_TF } from "@/lib/constants";
import { asNumber, fmtTime } from "@/lib/format";
import { useConfigMutation, usePaperClearStop } from "@/lib/queries";
import { useUIStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";

import { OverviewTab } from "./analytics/OverviewTab";
import { type StrategyFormValues, StrategyTab } from "./analytics/StrategyTab";
import { TradesTab } from "./analytics/TradesTab";

type TfFilter = "all" | TimeframeId;

interface AnalyticsTabsProps {
	stats: PaperStats | null;
	trades: PaperTradeEntry[];
	byMarket?: Record<string, MarketBreakdown>;
	config: {
		strategy: StrategyConfig;
		strategies?: Partial<Record<TimeframeId, StrategyConfig>>;
		enabledTimeframes?: TimeframeId[];
		paperRisk: RiskConfig;
		liveRisk: RiskConfig;
	};
	markets: MarketSnapshot[];
	liveTrades: TradeRecord[];
	viewMode: ViewMode;
	stopLoss?: StopLossStatus;
	todayStats?: TodayStats;
}

function toStrategyFormValues(strategyRaw: StrategyConfig, riskRaw: RiskConfig): StrategyFormValues {
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

function buildMarketFromTrades(trades: PaperTradeEntry[]): Record<string, MarketBreakdown> {
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

// Timeframe filter button styles
function tfFilterColor(tf: string, selected: boolean): string {
	if (!selected) return "bg-muted/30 border-border/50 text-muted-foreground hover:bg-muted/50";
	if (tf === "1h") return "bg-blue-500/20 border-blue-500/40 text-blue-400";
	if (tf === "4h") return "bg-purple-500/20 border-purple-500/40 text-purple-400";
	if (tf === "all") return "bg-emerald-500/20 border-emerald-500/40 text-emerald-400";
	return "bg-zinc-500/20 border-zinc-500/40 text-zinc-300";
}

export function AnalyticsTabs({
	stats,
	trades,
	byMarket,
	config,
	markets,
	liveTrades,
	viewMode,
	stopLoss,
	todayStats,
}: AnalyticsTabsProps) {
	const configMutation = useConfigMutation(viewMode);
	const clearStopMutation = usePaperClearStop();
	const enabledTimeframes: TimeframeId[] = config.enabledTimeframes ?? ["15m"];
	const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframeId>(enabledTimeframes[0] ?? "15m");

	const analyticsTab = useUIStore((s) => s.analyticsTab);
	// TF filter for trades/stats (separate from strategy TF selector)
	const [tfFilter, setTfFilter] = useState<TfFilter>("all");

	// Resolve strategy for selected timeframe: per-TF override > fallback to default
	const activeStrategy = config.strategies?.[selectedTimeframe] ?? config.strategy;
	const riskConfig = viewMode === "paper" ? config.paperRisk : config.liveRisk;
	const [form, setForm] = useState<StrategyFormValues>(() => toStrategyFormValues(activeStrategy, riskConfig));

	useEffect(() => {
		const strat = config.strategies?.[selectedTimeframe] ?? config.strategy;
		setForm(toStrategyFormValues(strat, viewMode === "paper" ? config.paperRisk : config.liveRisk));
	}, [config.strategy, config.strategies, config.paperRisk, config.liveRisk, viewMode, selectedTimeframe]);

	// === TF-filtered data ===
	const filteredTrades = useMemo(() => {
		if (tfFilter === "all") return trades;
		return trades.filter((t) => (t.timeframe ?? "15m") === tfFilter);
	}, [trades, tfFilter]);

	const filteredLiveTrades = useMemo(() => {
		if (tfFilter === "all") return liveTrades;
		return liveTrades.filter((t) => (t.timeframe ?? "15m") === tfFilter);
	}, [liveTrades, tfFilter]);

	const derivedStats = useMemo(() => buildStatsFromTrades(filteredTrades), [filteredTrades]);
	const mergedStats = useMemo(() => {
		// When filtering by TF, always use derived stats (server stats are aggregated)
		if (tfFilter !== "all") return derivedStats;
		if (!stats) return derivedStats;
		return { ...stats, totalTrades: derivedStats.totalTrades };
	}, [stats, derivedStats, tfFilter]);

	const marketStats = useMemo(() => {
		const client = buildMarketFromTrades(filteredTrades);
		if (Object.keys(client).length > 0) return client;
		if (tfFilter !== "all") return {};
		return byMarket ?? {};
	}, [byMarket, filteredTrades, tfFilter]);

	const pnlTimeline = useMemo(() => {
		const resolved = filteredTrades
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
				timeframe: trade.timeframe ?? "15m",
				pnl: trade.pnl ?? 0,
				cumulative: Number(running.toFixed(2)),
			};
		});
	}, [filteredTrades]);

	const timelinePositive = (pnlTimeline[pnlTimeline.length - 1]?.cumulative ?? 0) >= 0;

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

	// TF-aware timing buckets
	const timingData = useMemo(() => {
		const tfKey = tfFilter === "all" ? "all" : tfFilter;
		const bucketLabels = TIMING_BUCKETS_BY_TF[tfKey] ?? TIMING_BUCKETS_BY_TF.all;
		const windowMinutes = tfFilter === "all" ? 15 : (TIMEFRAME_WINDOW_MINUTES[tfFilter] ?? 15);
		const bucketSize = windowMinutes / 5;

		const buckets = bucketLabels.map((name) => ({
			name,
			count: 0,
			wins: 0,
			resolved: 0,
			winRate: 0,
		}));

		for (const trade of filteredTrades) {
			const ts = new Date(trade.timestamp).getTime();
			if (!Number.isFinite(ts) || !Number.isFinite(trade.windowStartMs)) continue;
			const minuteInWindow = (ts - trade.windowStartMs) / 60000;
			const index = Math.max(0, Math.min(4, Math.floor(minuteInWindow / bucketSize)));
			const bucket = buckets[index];
			if (!bucket) continue;
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
	}, [filteredTrades, tfFilter]);

	const sideData = useMemo(() => {
		const up = filteredTrades.filter((t) => t.side === "UP").length;
		const down = filteredTrades.filter((t) => t.side === "DOWN").length;
		return [
			{ name: "UP", value: up, color: CHART_COLORS.positive },
			{ name: "DOWN", value: down, color: CHART_COLORS.negative },
		];
	}, [filteredTrades]);

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
		limitDiscount: riskConfig.limitDiscount,
		minLiquidity: riskConfig.minLiquidity,
		maxTradesPerWindow: riskConfig.maxTradesPerWindow,
	};

	function saveConfig() {
		if (!blendValid) {
			toast({
				type: "error",
				title: "Configuration Invalid",
				description: "Blend weights must sum to 1.00",
			});
			return;
		}

		// V2: save per-timeframe strategy
		const payload: ConfigPayload = {
			strategies: { [selectedTimeframe]: strategyView },
			timeframe: selectedTimeframe,
			strategy: strategyView,
			...(viewMode === "paper" ? { paperRisk: riskView } : { liveRisk: riskView }),
		};

		configMutation.mutate(payload, {
			onSuccess: () => {
				toast({
					type: "success",
					title: "Config Saved",
					description: `Strategy for ${selectedTimeframe} saved`,
				});
			},
			onError: (error) => {
				toast({
					type: "error",
					title: "Save Failed",
					description: error instanceof Error ? error.message : "An unknown error occurred",
				});
			},
		});
	}

	// TF filter options: "all" + enabled timeframes
	const tfFilterOptions: TfFilter[] = useMemo(() => ["all", ...enabledTimeframes] as TfFilter[], [enabledTimeframes]);

	return (
		<div className="space-y-4">
			{/* TF filter */}
			<div className="flex items-center gap-1">
				<span className="text-[9px] text-muted-foreground/60 font-semibold uppercase tracking-wider mr-1">TF</span>
				{tfFilterOptions.map((tf) => (
					<button
						key={tf}
						type="button"
						onClick={() => setTfFilter(tf)}
						className={cn(
							"px-2 py-1 text-[10px] font-mono font-semibold rounded border transition-colors",
							tfFilterColor(tf, tfFilter === tf),
						)}
					>
						{tf === "all" ? "All" : tf}
					</button>
				))}
			</div>

			{analyticsTab === "overview" && (
				<div className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
					<OverviewTab
						stopLoss={stopLoss}
						viewMode={viewMode}
						todayStats={todayStats}
						clearStopMutation={clearStopMutation}
						mergedStats={mergedStats}
						pnlTimeline={pnlTimeline}
						timelinePositive={timelinePositive}
						markets={markets}
						tfFilter={tfFilter}
					/>
				</div>
			)}

			{analyticsTab === "trades" && (
				<div className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
					<TradesTab
						viewMode={viewMode}
						liveTrades={filteredLiveTrades}
						tradesLength={filteredTrades.length}
						timingData={timingData}
						sideTotal={sideTotal}
						sideData={sideData}
						marketRows={marketRows}
						tfFilter={tfFilter}
					/>
				</div>
			)}

			{analyticsTab === "strategy" && (
				<div className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
					<StrategyTab
						strategyView={strategyView}
						riskView={riskView}
						form={form}
						setForm={setForm}
						blendSum={blendSum}
						blendValid={blendValid}
						saveConfig={saveConfig}
						configMutation={configMutation}
						selectedTimeframe={selectedTimeframe}
						enabledTimeframes={enabledTimeframes}
						onTimeframeChange={setSelectedTimeframe}
					/>
				</div>
			)}
		</div>
	);
}
