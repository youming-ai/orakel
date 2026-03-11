import { Flame, Hash, Percent, Target, TrendingDown, TrendingUp } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/ui/card";
import type { ExtendedStats } from "@/lib/stats";

interface StatsGridProps {
	stats: ExtendedStats;
}

export function StatsGrid({ stats }: StatsGridProps) {
	const hasTrades = stats.wins + stats.losses > 0;
	const winRateDisplay = hasTrades ? `${(stats.winRate * 100).toFixed(1)}%` : "-";
	const winRateColor = stats.winRate >= 0.5 ? "text-emerald-400" : stats.winRate > 0 ? "text-red-400" : "";
	const winRateTrend = stats.winRate >= 0.5 ? "up" : "down";

	const streakLabel = stats.streak > 0 ? `${stats.streak}W` : stats.streak < 0 ? `${Math.abs(stats.streak)}L` : "-";
	const streakColor = stats.streak > 0 ? "text-emerald-400" : stats.streak < 0 ? "text-red-400" : "";

	return (
		<Card className="flex-1 overflow-hidden shadow-sm">
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-3 h-full">
				<StatCard label="Trades" value={String(stats.totalTrades)} icon={<Hash className="size-3.5" />} />
				<StatCard
					label="Win Rate"
					value={winRateDisplay}
					color={winRateColor}
					icon={<Target className="size-3.5" />}
					trend={hasTrades ? winRateTrend : "neutral"}
				/>
				<StatCard
					label="Wins"
					value={String(stats.wins)}
					color="text-emerald-400"
					icon={<TrendingUp className="size-3.5" />}
					trend="up"
				/>
				<StatCard
					label="Losses"
					value={String(stats.losses)}
					color="text-red-400"
					icon={<TrendingDown className="size-3.5" />}
					trend="down"
				/>
				<StatCard
					label="Avg P&L"
					value={hasTrades ? `${stats.avgPnl >= 0 ? "+" : ""}${stats.avgPnl.toFixed(2)}` : "-"}
					color={stats.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"}
					icon={<Percent className="size-3.5" />}
				/>
				<StatCard label="Streak" value={streakLabel} color={streakColor} icon={<Flame className="size-3.5" />} />
			</div>
		</Card>
	);
}
