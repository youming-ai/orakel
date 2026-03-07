import { Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { TodayStats } from "@/contracts/http";
import { cn } from "@/lib/utils";

interface TodayStatsCardProps {
	todayStats: TodayStats;
}

export function TodayStatsCard({ todayStats }: TodayStatsCardProps) {
	return (
		<Card className="border-border/50 shadow-sm">
			<div className="p-3">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					<div className="flex items-center justify-between gap-3 sm:gap-4 min-w-0">
						<div className="flex items-center gap-2 sm:gap-3 min-w-0">
							<Zap className="size-4 text-amber-400" />
							<span className="text-xs text-muted-foreground">Today</span>
						</div>
						<span
							className={cn("font-mono text-sm font-medium", todayStats.pnl >= 0 ? "text-emerald-400" : "text-red-400")}
						>
							{todayStats.pnl >= 0 ? "+" : ""}
							{todayStats.pnl.toFixed(2)} USDC
						</span>
						<span className="shrink-0 text-xs text-muted-foreground">
							{todayStats.trades} trade{todayStats.trades !== 1 ? "s" : ""}
						</span>
					</div>
					<DailyLimitBar todayStats={todayStats} />
				</div>
			</div>
		</Card>
	);
}

function DailyLimitBar({ todayStats }: TodayStatsCardProps) {
	const remainingPct = (1 - Math.abs(todayStats.pnl) / todayStats.limit) * 100;
	const barWidth = Math.min(100, (Math.max(0, todayStats.limit + todayStats.pnl) / todayStats.limit) * 100);

	return (
		<div className="flex items-center gap-2 w-full sm:w-auto">
			<span className="text-xs text-muted-foreground shrink-0">Daily Limit:</span>
			<div className="h-2 w-full sm:w-24 bg-muted/30 rounded-full overflow-hidden">
				<div
					className={cn(
						"h-full rounded-full transition-all",
						todayStats.pnl >= 0
							? "bg-emerald-400"
							: Math.abs(todayStats.pnl) / todayStats.limit > 0.7
								? "bg-red-400"
								: "bg-amber-400",
					)}
					style={{ width: `${barWidth}%` }}
				/>
			</div>
			<span className="text-xs text-muted-foreground">{remainingPct.toFixed(0)}%</span>
		</div>
	);
}
