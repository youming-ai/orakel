import type { TradeRecord } from "@/lib/api";
import type { MarketRow, ViewMode } from "@/lib/types";
import { MarketComparisonTable } from "../MarketComparisonTable";
import { TradeTable } from "../TradeTable";

interface TradesTabProps {
	viewMode: ViewMode;
	liveTrades: TradeRecord[];
	marketRows: MarketRow[];
}

export function TradesTab({ viewMode, liveTrades, marketRows }: TradesTabProps) {
	return (
		<div className="space-y-4">
			<div>
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
					{viewMode === "paper" ? "Paper Trades" : "Live Trades"}
				</h2>
				<TradeTable trades={liveTrades} paperMode={viewMode === "paper"} />
			</div>
			<MarketComparisonTable rows={marketRows} />
		</div>
	);
}
