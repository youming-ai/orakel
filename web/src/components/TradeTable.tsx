import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TradeRecord } from "@/contracts/http";
import { TRADE_TABLE_PAGE_SIZE } from "@/lib/constants";
import { TradeTableDesktop } from "./trades/TradeTableDesktop";
import { TradeTableMobile } from "./trades/TradeTableMobile";

interface TradeTableProps {
	trades: TradeRecord[];
	paperMode: boolean;
	viewMode?: "paper" | "live";
}

export function TradeTable({ trades, paperMode, viewMode: _viewMode }: TradeTableProps) {
	const [page, setPage] = useState(1);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset page when trade count changes
	useEffect(() => {
		setPage(1);
	}, [trades.length]);

	if (trades.length === 0) {
		return <div className="text-center py-8 text-sm text-muted-foreground">No trades yet</div>;
	}

	const totalPages = Math.ceil(trades.length / TRADE_TABLE_PAGE_SIZE);
	const start = (page - 1) * TRADE_TABLE_PAGE_SIZE;
	const end = start + TRADE_TABLE_PAGE_SIZE;
	const pageTrades = trades.slice(start, end);

	return (
		<div className="space-y-3">
			<TradeTableMobile pageTrades={pageTrades} paperMode={paperMode} />
			<TradeTableDesktop pageTrades={pageTrades} paperMode={paperMode} />

			{totalPages > 1 && (
				<div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
					<span className="text-muted-foreground">
						{trades.length} total, page {page}/{totalPages}
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							className="flex-1 sm:flex-none h-9 sm:h-7 px-2 text-xs"
							disabled={page <= 1}
							onClick={() => setPage((p) => Math.max(1, p - 1))}
						>
							<ChevronLeft className="size-3" /> Prev
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="flex-1 sm:flex-none h-9 sm:h-7 px-2 text-xs"
							disabled={page >= totalPages}
							onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
						>
							Next <ChevronRight className="size-3" />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
