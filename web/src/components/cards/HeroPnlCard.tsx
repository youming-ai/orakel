import { DollarSign } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface HeroPnlCardProps {
	totalPnl: number;
}

export function HeroPnlCard({ totalPnl }: HeroPnlCardProps) {
	return (
		<Card
			className={cn(
				"flex flex-col justify-center p-6 shrink-0 xl:w-72 shadow-sm",
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
				<span className="text-sm sm:text-lg font-bold opacity-60 ml-2 tracking-wide uppercase block sm:inline-block">
					USDC
				</span>
			</span>
		</Card>
	);
}
