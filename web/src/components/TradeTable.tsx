import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { TradeRecord } from "@/lib/api";
import { TRADE_TABLE_PAGE_SIZE } from "@/lib/constants";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

interface TradeTableProps {
	trades: TradeRecord[];
	paperMode: boolean;
}

function fmtTimestamp(ts: string): string {
	if (!ts) return "-";
	return fmtTime(ts) || ts;
}

function sideLabel(side: string): { text: string; isUp: boolean } {
	const up = (side ?? "").includes("UP");
	return { text: up ? "BUY UP" : "BUY DOWN", isUp: up };
}

export function TradeTable({ trades, paperMode }: TradeTableProps) {
	const [page, setPage] = useState(1);

	// Reset page when trades change
	useEffect(() => {
		if (trades.length === 0) {
			setPage(1);
			return;
		}
		setPage(1);
	}, [trades.length]);

	if (trades.length === 0) {
		return (
			<div className="text-center py-8 text-sm text-muted-foreground">
				No trades yet
			</div>
		);
	}

	const totalPages = Math.ceil(trades.length / TRADE_TABLE_PAGE_SIZE);
	const start = (page - 1) * TRADE_TABLE_PAGE_SIZE;
	const end = start + TRADE_TABLE_PAGE_SIZE;
	const pageTrades = trades.slice(start, end);

	return (
		<div className="space-y-3">
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-20 hidden sm:table-cell">Date</TableHead>
							<TableHead className="w-20">Time</TableHead>
							<TableHead className="w-16">Market</TableHead>
							<TableHead className="w-24">Side</TableHead>
							<TableHead className="w-16 text-right hidden sm:table-cell">
								Amount
							</TableHead>
							<TableHead className="w-16 text-right hidden sm:table-cell">
								Price
							</TableHead>
							<TableHead className="w-24 hidden sm:table-cell">
								Status
							</TableHead>
							{paperMode && (
								<TableHead className="w-16 hidden sm:table-cell">
									Mode
								</TableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{pageTrades.map((t, i) => {
							const { text, isUp } = sideLabel(t.side);
							return (
								<TableRow key={`${t.orderId}-${i}`}>
									<TableCell className="font-mono text-xs text-muted-foreground hidden sm:table-cell">
										{fmtDate(t.timestamp)}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{fmtTimestamp(t.timestamp)}
									</TableCell>
									<TableCell className="font-mono text-xs font-medium">
										{t.market}
									</TableCell>
									<TableCell>
										<Badge
											variant="secondary"
											className={cn(
												"text-[11px] px-1.5",
												isUp
													? "bg-emerald-500/15 text-emerald-400"
													: "bg-red-500/15 text-red-400",
											)}
										>
											{text}
										</Badge>
									</TableCell>
									<TableCell className="font-mono text-xs text-right hidden sm:table-cell">
										{t.amount}
									</TableCell>
									<TableCell className="font-mono text-xs text-right hidden sm:table-cell">
										{t.price}
									</TableCell>
									<TableCell className="hidden sm:table-cell">
										<Badge variant="secondary" className="text-[11px] px-1.5">
											{t.status || "placed"}
										</Badge>
									</TableCell>
									{paperMode && (
										<TableCell className="hidden sm:table-cell">
											<Badge
												variant="secondary"
												className="text-[11px] px-1.5 bg-amber-500/15 text-amber-400 border-amber-500/30"
											>
												PAPER
											</Badge>
										</TableCell>
									)}
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

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
