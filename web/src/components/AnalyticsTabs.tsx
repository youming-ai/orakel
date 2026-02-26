import { BarChart3, LayoutDashboard, List, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
	ConfigPayload,
	MarketBreakdown,
	MarketSnapshot,
	PaperStats,
	PaperTradeEntry,
	RiskConfig,
	StopLossStatus,
	StrategyConfig,
	TodayStats,
	TradeRecord,
} from "@/lib/api";
import { TIMING_BUCKETS } from "@/lib/constants";
import { CHART_COLORS } from "@/lib/charts";
import { fmtTime, asNumber } from "@/lib/format";
import { useConfigMutation, usePaperClearStop } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { ViewMode } from "@/lib/types";

import { OverviewTab } from "./analytics/OverviewTab";
import { MarketsTab } from "./analytics/MarketsTab";
import { TradesTab } from "./analytics/TradesTab";
import { StrategyTab, type StrategyFormValues } from "./analytics/StrategyTab";

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
	stopLoss?: StopLossStatus;
	todayStats?: TodayStats;
}

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
	stopLoss,
	todayStats,
}: AnalyticsTabsProps) {
	const configMutation = useConfigMutation(viewMode);
	const clearStopMutation = usePaperClearStop();
	const riskConfig = viewMode === "paper" ? config.paperRisk : config.liveRisk;
	const [form, setForm] = useState<StrategyFormValues>(() =>
		toStrategyFormValues(config.strategy, riskConfig),
	);

	useEffect(() => {
		setForm(
			toStrategyFormValues(
				config.strategy,
				viewMode === "paper" ? config.paperRisk : config.liveRisk,
			),
		);
	}, [config.strategy, config.paperRisk, config.liveRisk, viewMode]);

	const derivedStats = useMemo(() => buildStatsFromTrades(trades), [trades]);
	const mergedStats = useMemo(() => {
		if (!stats) return derivedStats;
		return { ...stats, totalTrades: derivedStats.totalTrades };
	}, [stats, derivedStats]);

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
			{ name: "UP", value: up, color: CHART_COLORS.positive },
			{ name: "DOWN", value: down, color: CHART_COLORS.negative },
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

		const payload: ConfigPayload = {
			strategy: strategyView,
			...(viewMode === "paper"
				? { paperRisk: riskView }
				: { liveRisk: riskView }),
		};

		configMutation.mutate(payload, {
			onSuccess: () => {
				toast({
					type: "success",
					title: "Config Saved",
					description: "Configuration preserved for future cycles",
				});
			},
			onError: (error) => {
				toast({
					type: "error",
					title: "Save Failed",
					description:
						error instanceof Error
							? error.message
							: "An unknown error occurred",
				});
			},
		});
	}

	return (
		<Tabs defaultValue="overview" className="space-y-4">
			<div className="relative overflow-hidden -mx-3 px-3 sm:mx-0 sm:px-0">
				<div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none z-10 sm:hidden" />
				<div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10 sm:hidden" />
				<div className="overflow-x-auto scrollbar-hide py-1">
					<TabsList className="w-max min-w-full sm:w-auto h-11 border-b-0">
						<TabsTrigger value="overview">
							<LayoutDashboard className="size-3.5 mr-1.5" /> Overview
						</TabsTrigger>
						<TabsTrigger value="markets">
							<BarChart3 className="size-3.5 mr-1.5" /> Markets
						</TabsTrigger>
						<TabsTrigger value="trades">
							<List className="size-3.5 mr-1.5" /> Trades
						</TabsTrigger>
						<TabsTrigger value="strategy">
							<Settings2 className="size-3.5 mr-1.5" /> Strategy
						</TabsTrigger>
					</TabsList>
				</div>
			</div>

			<TabsContent value="overview" className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
				<OverviewTab
					stopLoss={stopLoss}
					viewMode={viewMode}
					todayStats={todayStats}
					clearStopMutation={clearStopMutation}
					mergedStats={mergedStats}
					pnlTimeline={pnlTimeline}
					timelinePositive={timelinePositive}
					markets={markets}
				/>
			</TabsContent>

			<TabsContent value="markets" className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
				<MarketsTab marketRows={marketRows} />
			</TabsContent>

			<TabsContent value="trades" className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
				<TradesTab
					viewMode={viewMode}
					trades={trades}
					liveTrades={liveTrades}
					tradesLength={trades.length}
					timingData={timingData}
					sideTotal={sideTotal}
					sideData={sideData}
				/>
			</TabsContent>

			<TabsContent value="strategy" className="space-y-4 animate-in fade-in zoom-in-[0.99] duration-300">
				<StrategyTab
					strategyView={strategyView}
					riskView={riskView}
					form={form}
					setForm={setForm}
					blendSum={blendSum}
					blendValid={blendValid}
					saveConfig={saveConfig}
					configMutation={configMutation}
				/>
			</TabsContent>
		</Tabs>
	);
}
