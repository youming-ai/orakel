import { ArrowDownRight, ArrowUpRight, DollarSign, Scale } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface HeroPnlCardProps {
	totalPnl: number;
	bestTrade: number;
	worstTrade: number;
	profitFactor: number;
}

export function HeroPnlCard({ totalPnl, bestTrade, worstTrade, profitFactor }: HeroPnlCardProps) {
	const hasTrades = bestTrade !== 0 || worstTrade !== 0;

	return (
		<Card
			className={cn(
				"flex flex-col justify-center p-5 shadow-sm sm:p-6",
				totalPnl >= 0 ? "border-emerald-500/20" : "border-red-500/20",
			)}
		>
			<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
				<DollarSign className="size-4 opacity-70" />
				Total P&L
			</span>
			<span
				className={cn(
					"font-mono text-3xl sm:text-5xl font-black tracking-tighter truncate",
					totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
				)}
			>
				{totalPnl >= 0 ? "+" : ""}
				{totalPnl.toFixed(2)}
				<span className="text-sm sm:text-lg font-bold opacity-60 ml-2 tracking-wide uppercase">USDC</span>
			</span>

			{hasTrades && (
				<div className="flex items-center gap-3 sm:gap-4 mt-3 pt-3 border-t border-border/30">
					<div className="flex items-center gap-1.5 min-w-0">
						<ArrowUpRight className="size-3 text-emerald-400 shrink-0" />
						<span className="text-[11px] text-muted-foreground">Best</span>
						<span className="font-mono text-xs font-semibold text-emerald-400">+{bestTrade.toFixed(2)}</span>
					</div>
					<div className="flex items-center gap-1.5 min-w-0">
						<ArrowDownRight className="size-3 text-red-400 shrink-0" />
						<span className="text-[11px] text-muted-foreground">Worst</span>
						<span className="font-mono text-xs font-semibold text-red-400">{worstTrade.toFixed(2)}</span>
					</div>
					<div className="flex items-center gap-1.5 min-w-0 ml-auto">
						<Scale className="size-3 text-muted-foreground shrink-0" />
						<span className="text-[11px] text-muted-foreground">PF</span>
						<span
							className={cn(
								"font-mono text-xs font-semibold",
								profitFactor >= 1.5 ? "text-emerald-400" : profitFactor >= 1 ? "text-amber-400" : "text-red-400",
							)}
						>
							{profitFactor >= 999 ? "∞" : profitFactor.toFixed(2)}
						</span>
					</div>
				</div>
			)}
		</Card>
	);
}
