import { TradeTable } from "../TradeTable";
import type { PaperTradeEntry, TradeRecord } from "@/lib/api";
import type { ViewMode } from "@/lib/types";

interface TradesTabProps {
    viewMode: ViewMode;
    trades: PaperTradeEntry[];
    liveTrades: TradeRecord[];
}

export function TradesTab({ viewMode, trades, liveTrades }: TradesTabProps) {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    {viewMode === "paper" ? "Paper Trades" : "Live Trades"}
                </h2>
                <TradeTable
                    trades={viewMode === "paper" ? trades : liveTrades}
                    paperMode={viewMode === "paper"}
                />
            </div>
        </div>
    );
}
