import { Card } from "@/components/ui/card";
import type { ExtendedStats } from "@/lib/stats";
import { cn } from "@/lib/utils";

interface StatsGridProps {
	stats: ExtendedStats;
}

export function StatsGrid({ stats }: StatsGridProps) {
	const hasTrades = stats.wins + stats.losses > 0;
	const avgPnlDisplay = hasTrades ? `${stats.avgPnl >= 0 ? "+" : ""}${stats.avgPnl.toFixed(2)}` : "-";
	const avgPnlColor = hasTrades ? (stats.avgPnl >= 0 ? "text-emerald-400" : "text-red-400") : "text-muted-foreground";
	const streakLabel = stats.streak > 0 ? `${stats.streak}W` : stats.streak < 0 ? `${Math.abs(stats.streak)}L` : "-";
	const streakColor =
		stats.streak > 0 ? "text-emerald-400" : stats.streak < 0 ? "text-red-400" : "text-muted-foreground";

	return (
		<Card className="overflow-hidden p-1.5 shadow-sm sm:p-2">
			<div className="grid grid-cols-2 gap-1.5 sm:gap-2">
				<MiniStatCell label="Wins" value={String(stats.wins)} color="text-emerald-400" />
				<MiniStatCell label="Losses" value={String(stats.losses)} color="text-red-400" />
				<MiniStatCell label="Avg P&L" value={avgPnlDisplay} color={avgPnlColor} />
				<MiniStatCell label="Streak" value={streakLabel} color={streakColor} />
			</div>
		</Card>
	);
}

function MiniStatCell({ label, value, color }: { label: string; value: string; color?: string }) {
	return (
		<div className="rounded-md border border-border/40 bg-card p-2 sm:p-2.5">
			<p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
			<p className={cn("mt-1 font-mono text-sm font-semibold", color)}>{value}</p>
		</div>
	);
}
