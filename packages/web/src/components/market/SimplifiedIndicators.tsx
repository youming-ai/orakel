import type { MarketSnapshot } from "@/contracts/http";
import { cn } from "@/lib/utils";

interface SimplifiedIndicatorsProps {
	market: MarketSnapshot;
}

export function SimplifiedIndicators({ market: m }: SimplifiedIndicatorsProps) {
	const activeHaDots = Math.min(Math.max(m.haConsecutive ?? 0, 0), 3);
	const haDotColor = m.haColor === "green" ? "bg-emerald-500" : "bg-red-500";

	const rsiValue = m.rsi;
	const rsiColor =
		rsiValue === null
			? "text-muted-foreground"
			: rsiValue > 70
				? "text-red-400"
				: rsiValue < 30
					? "text-emerald-400"
					: "text-muted-foreground";

	const vwapPosition = (m.vwapSlope ?? 0) > 0 ? "Above" : "Below";
	const imbalanceValue = m.orderbookImbalance;
	const imbalanceColor =
		imbalanceValue === null ? "text-muted-foreground" : imbalanceValue >= 0 ? "text-emerald-400" : "text-red-400";

	return (
		<div className="flex items-center justify-between text-[11px]">
			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">HA</span>
				<div className="flex items-center gap-0.5">
					{["ha-a", "ha-b", "ha-c"].map((dotKey, i) => (
						<div
							key={dotKey}
							className={cn("h-1.5 w-1.5 rounded-full", i < activeHaDots ? haDotColor : "bg-muted/40")}
						/>
					))}
				</div>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">RSI</span>
				<span className={cn("font-mono font-medium", rsiColor)}>{rsiValue === null ? "-" : rsiValue.toFixed(1)}</span>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">VWAP</span>
				<span className="font-mono font-medium">{vwapPosition}</span>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">Imb</span>
				<span className={cn("font-mono font-medium", imbalanceColor)}>
					{imbalanceValue === null ? "-" : `${(imbalanceValue * 100).toFixed(0)}%`}
				</span>
			</div>
		</div>
	);
}
