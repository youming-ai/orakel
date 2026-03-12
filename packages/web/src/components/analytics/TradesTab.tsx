import { ArrowDownRight, ArrowUpRight, Hash, Scale, Target } from "lucide-react";
import { useMemo } from "react";
import type { TradeRecord } from "@/contracts/http";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TradeTable } from "../TradeTable";

interface TradesTabProps {
	viewMode: ViewMode;
	liveTrades: TradeRecord[];
}

function TradeSummaryBar({ trades }: { trades: TradeRecord[] }) {
	const summary = useMemo(() => {
		let wins = 0;
		let losses = 0;
		let totalPnl = 0;
		let bestTrade = -Infinity;
		let worstTrade = Infinity;
		for (const t of trades) {
			if (t.won === 1) wins++;
			else if (t.won === 0) losses++;
			const pnl = t.pnl ?? 0;
			totalPnl += pnl;
			if (pnl > bestTrade) bestTrade = pnl;
			if (pnl < worstTrade) worstTrade = pnl;
		}
		const resolved = wins + losses;
		return {
			total: trades.length,
			wins,
			losses,
			resolved,
			winRate: resolved > 0 ? wins / resolved : 0,
			totalPnl,
			avgPnl: resolved > 0 ? totalPnl / resolved : 0,
			bestTrade: bestTrade === -Infinity ? 0 : bestTrade,
			worstTrade: worstTrade === Infinity ? 0 : worstTrade,
		};
	}, [trades]);

	if (trades.length === 0) return null;

	return (
		<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
			<MiniStat icon={<Hash className="size-3" />} label="Total" value={String(summary.total)} />
			<MiniStat
				icon={<Target className="size-3" />}
				label="Win Rate"
				value={summary.resolved > 0 ? `${(summary.winRate * 100).toFixed(1)}%` : "-"}
				color={summary.winRate >= 0.5 ? "text-emerald-400" : "text-red-400"}
			/>
			<MiniStat
				icon={<Scale className="size-3" />}
				label="P&L"
				value={`${summary.totalPnl >= 0 ? "+" : ""}${summary.totalPnl.toFixed(2)}`}
				color={summary.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
			/>
			<MiniStat
				label="Avg"
				value={summary.resolved > 0 ? `${summary.avgPnl >= 0 ? "+" : ""}${summary.avgPnl.toFixed(2)}` : "-"}
				color={summary.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}
			/>
			<MiniStat
				icon={<ArrowUpRight className="size-3" />}
				label="Best"
				value={summary.bestTrade > 0 ? `+${summary.bestTrade.toFixed(2)}` : "-"}
				color="text-emerald-400"
			/>
			<MiniStat
				icon={<ArrowDownRight className="size-3" />}
				label="Worst"
				value={summary.worstTrade < 0 ? summary.worstTrade.toFixed(2) : "-"}
				color="text-red-400"
			/>
		</div>
	);
}

function MiniStat({
	icon,
	label,
	value,
	color,
}: {
	icon?: React.ReactNode;
	label: string;
	value: string;
	color?: string;
}) {
	return (
		<div className="flex flex-col gap-0.5 rounded-lg bg-muted/30 border border-border/30 p-2 sm:p-2.5">
			<span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
				{icon}
				{label}
			</span>
			<span className={cn("font-mono text-sm font-semibold", color)}>{value}</span>
		</div>
	);
}

export function TradesTab({ viewMode, liveTrades }: TradesTabProps) {
	return (
		<div className="space-y-4">
			<div>
				<h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
					{viewMode === "paper" ? "Paper Trades" : "Live Trades"}
				</h2>
				<TradeSummaryBar trades={liveTrades} />
			</div>
			<TradeTable trades={liveTrades} paperMode={viewMode === "paper"} />
		</div>
	);
}
