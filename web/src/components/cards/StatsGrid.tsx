import { Hash, Target, TrendingDown, TrendingUp } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/ui/card";
import type { PaperStats } from "@/contracts/http";

interface StatsGridProps {
	stats: PaperStats;
}

export function StatsGrid({ stats }: StatsGridProps) {
	const hasTrades = stats.wins + stats.losses > 0;
	const winRateDisplay = hasTrades ? `${(stats.winRate * 100).toFixed(1)}%` : "-";
	const winRateColor = stats.winRate >= 0.5 ? "text-emerald-400" : stats.winRate > 0 ? "text-red-400" : "";
	const winRateTrend = stats.winRate >= 0.5 ? "up" : "down";

	return (
		<Card className="flex-1 overflow-hidden shadow-sm">
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-4 h-full">
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
			</div>
		</Card>
	);
}
