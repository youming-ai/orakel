import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TradeRecord } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { modeBadge, sideBadge } from "@/lib/variants";
import { fmtTimestamp, getDisplayMode, getMarketCycleSlug, getPolymarketUrl, sideLabel } from "./utils";

interface TradeTableDesktopProps {
	pageTrades: TradeRecord[];
	paperMode: boolean;
}

export function TradeTableDesktop({ pageTrades, paperMode }: TradeTableDesktopProps) {
	return (
		<Card className="hidden sm:block p-0 overflow-hidden">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-20 hidden sm:table-cell">Date</TableHead>
						<TableHead className="w-20">Time</TableHead>
						<TableHead className="max-w-[220px]">Market</TableHead>
						<TableHead className="w-24">Side</TableHead>
						<TableHead className="w-16 text-right hidden sm:table-cell">Amount</TableHead>
						<TableHead className="w-16 text-right hidden sm:table-cell">Price</TableHead>
						<TableHead className="w-24 text-right hidden sm:table-cell">Asset Price</TableHead>
						<TableHead className="w-24 hidden sm:table-cell">Status</TableHead>
						<TableHead className="w-16 hidden sm:table-cell">Mode</TableHead>
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
										className={cn("text-[11px] px-1.5", sideBadge({ side: isUp ? "up" : "down" }))}
									>
										{text}
									</Badge>
								</TableCell>
								<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{t.amount}</TableCell>
								<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{t.price}</TableCell>
								<TableCell className="font-mono text-xs text-right hidden sm:table-cell">
									{t.currentPriceAtEntry ? `$${t.currentPriceAtEntry.toFixed(2)}` : "-"}
								</TableCell>
								<TableCell className="hidden sm:table-cell">
									<Badge variant="secondary" className="text-[11px] px-1.5">
										{t.status || "placed"}
									</Badge>
								</TableCell>
								<TableCell className="hidden sm:table-cell">
									<Badge
										variant="secondary"
										className={cn(
											"text-[11px] px-1.5",
											modeBadge({ mode: getDisplayMode(t, paperMode) === "PAPER" ? "paper" : "live" }),
										)}
									>
										{getDisplayMode(t, paperMode)}
									</Badge>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</Card>
	);
}
