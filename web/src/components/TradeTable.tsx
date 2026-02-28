import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TradeRecord } from "@/lib/api";
import { TRADE_TABLE_PAGE_SIZE } from "@/lib/constants";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

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

const WINDOW_SEC = 15 * 60;

function getMarketCycleSlug(market: string, timestamp: string): string | null {
	if (!market || !timestamp) return null;
	const tsSec = Math.floor(new Date(timestamp).getTime() / 1000);
	if (Number.isNaN(tsSec)) return null;
	const windowStart = Math.floor(tsSec / WINDOW_SEC) * WINDOW_SEC;
	return `${market.toLowerCase()}-updown-15m-${windowStart}`;
}

function getPolymarketUrl(slug: string): string {
	return `https://polymarket.com/event/${slug}`;
}

export const TradeTable = memo(function TradeTable({ trades, paperMode }: TradeTableProps) {
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
		return <div className="text-center py-8 text-sm text-muted-foreground">No trades yet</div>;
	}

	const totalPages = Math.ceil(trades.length / TRADE_TABLE_PAGE_SIZE);
	const start = (page - 1) * TRADE_TABLE_PAGE_SIZE;
	const end = start + TRADE_TABLE_PAGE_SIZE;
	const pageTrades = trades.slice(start, end);

	return (
		<div className="space-y-3">
			{/* Mobile View: Stacked Cards */}
			<div className="grid grid-cols-1 gap-3 sm:hidden">
				{pageTrades.map((t, i) => {
					const { text, isUp } = sideLabel(t.side);
					const slug = getMarketCycleSlug(t.market, t.timestamp);
					return (
						<div
							key={`${t.orderId}-${i}`}
							className="p-3 border border-border/60 rounded-lg bg-card/50 flex flex-col gap-2 relative"
						>
							<div className="flex items-start justify-between">
								<div className="flex flex-col">
									<span className="text-xs text-muted-foreground">
										{fmtDate(t.timestamp)} {fmtTimestamp(t.timestamp)}
									</span>
									<span className="font-mono text-sm font-medium mt-0.5 max-w-[200px] truncate">
										{slug ? (
											<a
												href={getPolymarketUrl(slug)}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors hover:underline"
											>
												{slug}
												<ExternalLink className="size-3 shrink-0" />
											</a>
										) : (
											t.market
										)}
									</span>
								</div>
								<Badge
									variant="secondary"
									className={cn(
										"text-[10px] px-1.5 shrink-0 uppercase tracking-widest",
										isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
									)}
								>
									{text}
								</Badge>
							</div>

							<div className="grid grid-cols-2 gap-2 mt-1 text-xs">
								<div className="flex flex-col bg-muted/20 border border-border/30 p-2 rounded-md">
									<span className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wide">Amount</span>
									<span className="font-mono">
										{t.amount} {isUp ? "YES" : "NO"}
									</span>
								</div>
								<div className="flex flex-col bg-muted/20 border border-border/30 p-2 rounded-md">
									<span className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wide">Price</span>
									<span className="font-mono">{t.price}</span>
								</div>
							</div>

							<div className="flex items-center gap-2 mt-1">
								<Badge
									variant="outline"
									className="text-[10px] px-1.5 font-normal bg-background/50 text-muted-foreground"
								>
									status: {t.status || "placed"}
								</Badge>
								{paperMode && (
									<Badge
										variant="secondary"
										className="text-[10px] px-1.5 bg-amber-500/15 text-amber-400 border-amber-500/30"
									>
										PAPER
									</Badge>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{/* Desktop View: Table */}
			<div className="rounded-md border hidden sm:block">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-20 hidden sm:table-cell">Date</TableHead>
							<TableHead className="w-20">Time</TableHead>
							<TableHead className="max-w-[220px]">Market</TableHead>
							<TableHead className="w-24">Side</TableHead>
							<TableHead className="w-16 text-right hidden sm:table-cell">Amount</TableHead>
							<TableHead className="w-16 text-right hidden sm:table-cell">Price</TableHead>
							<TableHead className="w-24 hidden sm:table-cell">Status</TableHead>
							{paperMode && <TableHead className="w-16 hidden sm:table-cell">Mode</TableHead>}
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
									<TableCell className="font-mono text-xs">{fmtTimestamp(t.timestamp)}</TableCell>
									<TableCell className="font-mono text-xs font-medium max-w-[220px] truncate">
										{(() => {
											const slug = getMarketCycleSlug(t.market, t.timestamp);
											if (!slug) return t.market;
											return (
												<a
													href={getPolymarketUrl(slug)}
													target="_blank"
													rel="noopener noreferrer"
													className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors hover:underline"
												>
													{slug}
													<ExternalLink className="size-3 shrink-0" />
												</a>
											);
										})()}
									</TableCell>
									<TableCell>
										<Badge
											variant="secondary"
											className={cn(
												"text-[11px] px-1.5",
												isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
											)}
										>
											{text}
										</Badge>
									</TableCell>
									<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{t.amount}</TableCell>
									<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{t.price}</TableCell>
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
});
