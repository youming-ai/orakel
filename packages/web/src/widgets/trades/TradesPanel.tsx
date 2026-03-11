import { useMemo } from "react";
import { TradesTab } from "@/components/analytics/TradesTab";
import { useLiveStats, usePaperStats, useTrades } from "@/lib/queries";
import { buildMarketFromTrades } from "@/lib/stats";
import { useUIStore } from "@/lib/store";
import type { MarketRow } from "@/lib/types";

export function TradesPanel() {
	const viewMode = useUIStore((s) => s.viewMode);
	const { data: trades = [] } = useTrades(viewMode);
	const { data: paperStatsData } = usePaperStats(viewMode === "paper");
	const { data: liveStatsData } = useLiveStats(viewMode === "live");
	const statsData = viewMode === "paper" ? paperStatsData : liveStatsData;

	const marketStats = useMemo((): MarketRow[] => {
		const statsTrades = statsData?.trades ?? [];
		const byMarket = buildMarketFromTrades(statsTrades);
		const result: MarketRow[] = [];
		for (const [market, item] of Object.entries(byMarket)) {
			const resolved = item.wins + item.losses;
			result.push({
				market,
				trades: item.tradeCount,
				wins: item.wins,
				losses: item.losses,
				pending: item.pending,
				winRate: resolved > 0 ? item.wins / resolved : 0,
				winRatePct: resolved > 0 ? Number(((item.wins / resolved) * 100).toFixed(1)) : 0,
				pnl: Number(item.totalPnl.toFixed(2)),
				resolvedCount: resolved,
			});
		}
		const marketOrder = ["BTC-15m", "ETH-15m"];
		return result.sort((a, b) => {
			const aIndex = marketOrder.indexOf(a.market);
			const bIndex = marketOrder.indexOf(b.market);
			if (aIndex === -1 && bIndex === -1) return 0;
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		});
	}, [statsData]);

	return (
		<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-20 sm:pb-6">
			<div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
				<TradesTab viewMode={viewMode} liveTrades={trades} marketRows={marketStats} />
			</div>
		</main>
	);
}
