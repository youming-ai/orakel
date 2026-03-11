import { TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { TodayStats } from "@/contracts/http";
import type { ExtendedStats } from "@/lib/stats";
import { cn } from "@/lib/utils";

interface TodayStatsCardProps {
	todayStats: TodayStats;
	stats?: ExtendedStats;
}

export function TodayStatsCard({ todayStats, stats }: TodayStatsCardProps) {
	const hasBreakdown = stats && stats.wins + stats.losses > 0;
	const winRate = hasBreakdown ? (stats.winRate * 100).toFixed(0) : null;

	return (
		<Card className="border-border/50 shadow-sm">
			<div className="p-3">
				<div className="flex flex-col gap-2.5 sm:gap-3">
					{/* Top row: Today label + PnL + trades */}
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2 min-w-0">
							<Zap className="size-4 text-amber-400 shrink-0" />
							<span className="text-xs text-muted-foreground font-medium">Today</span>
						</div>
						<div className="flex items-center gap-3 sm:gap-4">
							<span
								className={cn(
									"font-mono text-sm font-semibold",
									todayStats.pnl >= 0 ? "text-emerald-400" : "text-red-400",
								)}
							>
								{todayStats.pnl >= 0 ? "+" : ""}
								{todayStats.pnl.toFixed(2)} USDC
							</span>
							{hasBreakdown && (
								<div className="hidden sm:flex items-center gap-2 text-[11px]">
									<span className="flex items-center gap-0.5 text-emerald-400">
										<TrendingUp className="size-3" />
										{stats.wins}
									</span>
									<span className="flex items-center gap-0.5 text-red-400">
										<TrendingDown className="size-3" />
										{stats.losses}
									</span>
									{winRate && (
										<span
											className={cn(
												"font-mono font-medium",
												stats.winRate >= 0.5 ? "text-emerald-400" : "text-red-400",
											)}
										>
											{winRate}%
										</span>
									)}
								</div>
							)}
							<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
								{todayStats.trades} trade{todayStats.trades !== 1 ? "s" : ""}
							</span>
						</div>
					</div>

					{/* Mobile breakdown */}
					{hasBreakdown && (
						<div className="flex items-center gap-3 text-[11px] sm:hidden">
							<span className="flex items-center gap-0.5 text-emerald-400">
								<TrendingUp className="size-3" />
								{stats.wins}W
							</span>
							<span className="flex items-center gap-0.5 text-red-400">
								<TrendingDown className="size-3" />
								{stats.losses}L
							</span>
							{winRate && (
								<span
									className={cn("font-mono font-medium", stats.winRate >= 0.5 ? "text-emerald-400" : "text-red-400")}
								>
									WR {winRate}%
								</span>
							)}
							{stats.pending > 0 && <span className="text-amber-400 font-mono">{stats.pending} pending</span>}
						</div>
					)}

					{/* Daily limit bar */}
					<DailyLimitBar todayStats={todayStats} />
				</div>
			</div>
		</Card>
	);
}

function DailyLimitBar({ todayStats }: { todayStats: TodayStats }) {
	const remainingPct = Math.max(0, (1 - Math.abs(todayStats.pnl) / todayStats.limit) * 100);
	const barWidth = Math.min(100, (Math.max(0, todayStats.limit + todayStats.pnl) / todayStats.limit) * 100);
	const isNearLimit = Math.abs(todayStats.pnl) / todayStats.limit > 0.7;

	return (
		<div className="flex items-center gap-2 w-full">
			<span className="text-[11px] text-muted-foreground shrink-0">Daily Limit</span>
			<div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
				<div
					className={cn(
						"h-full rounded-full transition-all duration-500",
						todayStats.pnl >= 0 ? "bg-emerald-400" : isNearLimit ? "bg-red-400" : "bg-amber-400",
					)}
					style={{ width: `${barWidth}%` }}
				/>
			</div>
			<span
				className={cn(
					"text-[11px] font-mono tabular-nums shrink-0",
					isNearLimit && todayStats.pnl < 0 ? "text-red-400" : "text-muted-foreground",
				)}
			>
				{remainingPct.toFixed(0)}%
			</span>
		</div>
	);
}
