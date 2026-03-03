import { useMemo } from "react";
import type { PaperTradeEntry, TradeRecord } from "@/lib/api";
import { useDashboardStateWithWs, useLiveReset, usePaperClearStop, usePaperReset, usePaperStats, useTrades } from "@/lib/queries";
import { useUIStore } from "@/lib/store";
import { OverviewTab } from "./analytics/OverviewTab";
import { AppErrorBoundary } from "./AppErrorBoundary";

function DashboardContent() {
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: state } = useDashboardStateWithWs();
	const { data: trades = [] } = useTrades(viewMode);
	const { data: paperStatsData } = usePaperStats(viewMode === "paper");

	const paperTrades = paperStatsData?.trades ?? [];

	// Convert TradeRecord (live trades) to PaperTradeEntry format for OverviewTab
	const liveTradesAsPaper = useMemo<PaperTradeEntry[]>(() => {
		if (!Array.isArray(trades)) return [];
		return trades.map((t: TradeRecord) => ({
			id: t.orderId,
			marketId: t.market,
			windowStartMs: new Date(t.timestamp).getTime(),
			side: (t.side.includes("UP") ? "UP" : "DOWN") as "UP" | "DOWN",
			price: Number.parseFloat(t.price) || 0,
			size: Number.parseFloat(t.amount) || 0,
			priceToBeat: 0,
			currentPriceAtEntry: null,
			timestamp: t.timestamp,
			resolved: t.status === "settled" || t.status === "won" || t.status === "lost" || t.won !== null,
			won: t.won === null ? null : Boolean(t.won),
			pnl: t.pnl,
			settlePrice: null,
		}));
	}, [trades]);

	// Calculate merged stats for OverviewTab
	const mergedStats = useMemo(() => {
		const currentTrades = viewMode === "paper" ? paperTrades : liveTradesAsPaper;
		let wins = 0;
		let losses = 0;
		let pending = 0;
		let totalPnl = 0;
		for (const trade of currentTrades) {
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
			totalTrades: currentTrades.length,
			wins,
			losses,
			pending,
			winRate: resolved > 0 ? wins / resolved : 0,
			totalPnl: Number(totalPnl.toFixed(2)),
		};
	}, [paperTrades, liveTradesAsPaper, viewMode]);

	// Calculate PnL timeline for OverviewTab
	const pnlTimeline = useMemo(() => {
		const currentTrades = viewMode === "paper" ? paperTrades : liveTradesAsPaper;
		const resolved = currentTrades
			.filter((t) => t.resolved && t.pnl !== null)
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

		let running = 0;
		return resolved.map((trade) => {
			running += trade.pnl ?? 0;
			return {
				ts: trade.timestamp,
				time: new Date(trade.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
				market: trade.marketId,
				side: trade.side,
				pnl: trade.pnl ?? 0,
				cumulative: Number(running.toFixed(2)),
			};
		});
	}, [paperTrades, liveTradesAsPaper, viewMode]);

	const timelinePositive = (pnlTimeline[pnlTimeline.length - 1]?.cumulative ?? 0) >= 0;
	const clearStopMutation = usePaperClearStop();
	const paperResetMutation = usePaperReset();
	const liveResetMutation = useLiveReset();
	const resetMutation = viewMode === "paper" ? paperResetMutation : liveResetMutation;

	if (!state) {
		return null; // Loading state handled by App.tsx
	}

	return (
		<AppErrorBoundary>
			<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-safe">
				<OverviewTab
					stopLoss={viewMode === "paper" ? state.stopLoss : undefined}
					viewMode={viewMode}
					todayStats={viewMode === "paper" ? state.todayStats : state.liveTodayStats}
					clearStopMutation={clearStopMutation}
					resetMutation={resetMutation}
					mergedStats={mergedStats}
					pnlTimeline={pnlTimeline}
					timelinePositive={timelinePositive}
					markets={state.markets ?? []}
				/>
			</main>
		</AppErrorBoundary>
	);
}

export function Dashboard() {
	return <DashboardContent />;
}
