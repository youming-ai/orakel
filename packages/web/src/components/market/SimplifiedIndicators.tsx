import type { MarketSnapshot } from "@/contracts/http";
import { cn } from "@/lib/utils";

interface SimplifiedIndicatorsProps {
	market: MarketSnapshot;
}

export function SimplifiedIndicators({ market: m }: SimplifiedIndicatorsProps) {
	const delta = m.spotDelta;
	const deltaColor = delta === null ? "text-muted-foreground" : delta >= 0 ? "text-emerald-400" : "text-red-400";
	const edgePct = m.edge === null ? null : m.edge * 100;
	const edgeColor = edgePct === null ? "text-muted-foreground" : edgePct >= 0 ? "text-emerald-400" : "text-red-400";
	const biasColor = m.predictDirection === "LONG" ? "text-emerald-400" : "text-red-400";

	return (
		<div className="flex items-center justify-between text-[11px]">
			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">Bias</span>
				<span className={cn("font-mono font-medium", biasColor)}>{m.predictDirection}</span>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">Edge</span>
				<span className={cn("font-mono font-medium", edgeColor)}>
					{edgePct === null ? "-" : `${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(1)}%`}
				</span>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">Delta</span>
				<span className={cn("font-mono font-medium", deltaColor)}>
					{delta === null ? "-" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
				</span>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[11px] uppercase text-muted-foreground">Action</span>
				<span className="font-mono font-medium">{m.action}</span>
			</div>
		</div>
	);
}
