import { ExternalLink, Hourglass, Rocket, Skull } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TradeRecord } from "@/contracts/http";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { modeBadge, sideBadge } from "@/lib/variants";
import { MarketWithIcon } from "./MarketWithIcon";
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
						<TableHead className="w-20">Date</TableHead>
						<TableHead className="w-20">Time</TableHead>
						<TableHead className="max-w-[220px]">Market</TableHead>
						<TableHead className="w-24 text-right">Asset Price</TableHead>
						<TableHead className="w-20">Side</TableHead>
						<TableHead className="w-28 text-right">Position</TableHead>
						<TableHead className="w-24 text-right">Outcome</TableHead>
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
								<TableCell className="font-mono text-xs text-right">
									<span className="text-muted-foreground">$</span>
									<span>{t.amount}</span>
									<span className="text-muted-foreground mx-0.5">×</span>
									<span>{t.price}¢</span>
								</TableCell>
								<TableCell className="align-middle">
									{t.won !== null && t.won !== undefined ? (
										<div
											className={cn(
												"inline-flex items-center gap-1.5 px-2 py-1 rounded-full",
												t.won ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400",
											)}
										>
											{t.won ? <Rocket className="size-3.5" /> : <Skull className="size-3.5" />}
											{pnlValue !== null && (
												<span className="font-mono text-xs font-medium">
													{pnlValue >= 0 ? "+" : ""}
													{pnlValue.toFixed(2)}
												</span>
											)}
										</div>
									) : (
										<div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-400/10 text-amber-400">
											<Hourglass className="size-3.5" />
											<span className="text-xs text-muted-foreground">-</span>
										</div>
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
