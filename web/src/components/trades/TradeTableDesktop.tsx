import { ExternalLink } from "lucide-react";
import { BtcIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TradeRecord } from "@/contracts/http";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { modeBadge, sideBadge } from "@/lib/variants";
import { fmtTimestamp, getDisplayMode, getMarketCycleSlug, getPolymarketUrl, sideLabel } from "./utils";

function MarketWithIcon({ market, slug }: { market: string; slug: string | null }) {
	const isBtc = market.startsWith("BTC");
	const displayText = slug || market;
	return (
		<span className="flex items-center gap-1.5">
			{isBtc && <BtcIcon size={14} />}
			<span>{displayText}</span>
		</span>
	);
}

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
						<TableHead className="w-20">Date</TableHead>
						<TableHead className="w-20">Time</TableHead>
						<TableHead className="max-w-[220px]">Market</TableHead>
						<TableHead className="w-24 text-right">Asset Price</TableHead>
						<TableHead className="w-24">Side</TableHead>
						<TableHead className="w-16 text-right">Amount</TableHead>
						<TableHead className="w-16 text-right">Price</TableHead>
						<TableHead className="w-20 text-right">P&L</TableHead>
						<TableHead className="w-20">Result</TableHead>
						<TableHead className="w-16">Mode</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{pageTrades.map((t) => {
						const { text, isUp } = sideLabel(t.side);
						const hasPnl = t.pnl !== null && t.pnl !== undefined;
						const pnlValue = hasPnl ? Number(t.pnl) : null;
						return (
							<TableRow
								key={t.orderId || `trade-${t.timestamp}-${t.market}`}
								className="hover:bg-muted/50 transition-colors"
							>
								<TableCell className="font-mono text-xs text-muted-foreground">{fmtDate(t.timestamp)}</TableCell>
								<TableCell className="font-mono text-xs">{fmtTimestamp(t.timestamp)}</TableCell>
								<TableCell className="font-mono text-xs font-medium max-w-[220px] truncate">
									{(() => {
										const slug = getMarketCycleSlug(t.market, t.timestamp, t.marketSlug);
										return (
											<a
												href={slug ? getPolymarketUrl(slug) : undefined}
												target="_blank"
												rel="noopener noreferrer"
												className={cn(
													"inline-flex items-center gap-1 transition-colors",
													slug && "text-blue-400 hover:text-blue-300 hover:underline",
												)}
											>
												<MarketWithIcon market={t.market} slug={slug} />
												{slug && <ExternalLink className="size-3 shrink-0" />}
											</a>
										);
									})()}
								</TableCell>
								<TableCell className="font-mono text-xs text-right">
									{t.currentPriceAtEntry ? `$${t.currentPriceAtEntry.toFixed(2)}` : "-"}
								</TableCell>
								<TableCell>
									<Badge
										variant="secondary"
										className={cn("text-[11px] px-1.5", sideBadge({ side: isUp ? "up" : "down" }))}
									>
										{text}
									</Badge>
								</TableCell>
								<TableCell className="font-mono text-xs text-right">{t.amount}</TableCell>
								<TableCell className="font-mono text-xs text-right">{t.price}</TableCell>
								<TableCell className="font-mono text-xs text-right font-medium">
									{pnlValue !== null ? (
										<span className={pnlValue >= 0 ? "text-emerald-400" : "text-red-400"}>
											{pnlValue >= 0 ? "+" : ""}
											{pnlValue.toFixed(2)}
										</span>
									) : (
										<span className="text-muted-foreground">-</span>
									)}
								</TableCell>
								<TableCell>
									{t.won !== null && t.won !== undefined ? (
										<Badge
											variant="secondary"
											className={cn(
												"text-[11px] px-1.5",
												t.won ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
											)}
										>
											{t.won ? "Won" : "Lost"}
										</Badge>
									) : (
										<Badge variant="secondary" className="text-[11px] px-1.5">
											{t.status || "placed"}
										</Badge>
									)}
								</TableCell>
								<TableCell>
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
