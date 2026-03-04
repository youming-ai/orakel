import { useMemo } from "react";
import type { PaperTradeEntry, TradeRecord } from "@/lib/api";
import { TradesTab } from "@/components/analytics/TradesTab";

export interface TradesPageProps {
	viewMode: "paper" | "live";
	liveTrades: TradeRecord[];
	paperTrades: PaperTradeEntry[];
}

// Convert TradeRecord (live trades) to PaperTradeEntry format
function liveTradesAsPaper(trades: TradeRecord[]): PaperTradeEntry[] {
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
}

export function TradesPage({ viewMode, liveTrades, paperTrades }: TradesPageProps) {
	const currentTrades = viewMode === "paper" ? paperTrades : liveTradesAsPaper(liveTrades);

	// Build market stats for TradesTab
	const marketStats = useMemo(() => {
		const client = new Map<string, { wins: number; losses: number; pending: number; winRate: number; totalPnl: number; tradeCount: number }>();

		for (const trade of currentTrades) {
			const current = client.get(trade.marketId) ?? {
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
			client.set(trade.marketId, current);
		}

		const result: Array<{
			market: string;
			trades: number;
			wins: number;
			losses: number;
			pending: number;
			winRate: number;
			winRatePct: number;
			pnl: number;
			resolvedCount: number;
		}> = [];
		for (const [market, item] of client.entries()) {
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
		const marketOrder = ["BTC", "ETH", "SOL", "XRP"];
		return result.sort((a, b) => {
			const aIndex = marketOrder.indexOf(a.market);
			const bIndex = marketOrder.indexOf(b.market);
			if (aIndex === -1 && bIndex === -1) return 0;
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			return aIndex - bIndex;
		});
	}, [currentTrades]);

	return (
		<main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-safe">
			<div className="rounded-xl border bg-card p-4 sm:p-6 shadow-sm">
				<TradesTab
					viewMode={viewMode}
					liveTrades={liveTrades}
					marketRows={marketStats}
				/>
			</div>
		</main>
	);
}
