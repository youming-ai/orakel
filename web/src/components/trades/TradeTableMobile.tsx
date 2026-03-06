import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TradeRecord } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { modeBadge, sideBadge } from "@/lib/variants";
import { fmtTimestamp, getDisplayMode, getMarketCycleSlug, getPolymarketUrl, sideLabel } from "./utils";

interface TradeTableMobileProps {
	pageTrades: TradeRecord[];
	paperMode: boolean;
}

export function TradeTableMobile({ pageTrades, paperMode }: TradeTableMobileProps) {
	return (
		<div className="grid grid-cols-1 gap-3 sm:hidden">
			{pageTrades.map((t) => {
				const { text, isUp } = sideLabel(t.side);
				const slug = getMarketCycleSlug(t.market, t.timestamp);
				return (
					<Card key={t.orderId || `trade-${t.timestamp}-${t.market}`} className="p-3">
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
									sideBadge({ side: isUp ? "up" : "down" }),
								)}
							>
								{text}
							</Badge>
						</div>

						<div className="grid grid-cols-2 gap-2 mt-3 text-xs">
							<div className="flex flex-col bg-muted/50 border rounded-md p-2">
								<span className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wide">Amount</span>
								<span className="font-mono">
									{t.amount} {isUp ? "YES" : "NO"}
								</span>
							</div>
							<div className="flex flex-col bg-muted/50 border rounded-md p-2">
								<span className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wide">Entry</span>
								<span className="font-mono">{t.price}¢</span>
							</div>
						</div>

						{t.currentPriceAtEntry !== null && t.currentPriceAtEntry !== undefined && (
							<div className="grid grid-cols-2 gap-2 mt-2 text-xs">
								<div className="flex flex-col bg-muted/50 border rounded-md p-2">
									<span className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wide">Spot</span>
									<span className="font-mono">${Number(t.currentPriceAtEntry).toFixed(2)}</span>
								</div>
								{t.won !== null && t.pnl !== null && (
									<div className="flex flex-col bg-muted/50 border rounded-md p-2">
										<span className="text-muted-foreground mb-0.5 text-[10px] uppercase tracking-wide">P&L</span>
										<span className={`font-mono font-semibold ${t.won ? "text-emerald-400" : "text-red-400"}`}>
											{t.won ? "+" : ""}{Number(t.pnl).toFixed(2)}
										</span>
									</div>
								)}
							</div>
						)}

						<div className="flex items-center gap-2 mt-3">
							<Badge
								variant="outline"
								className="text-[10px] px-1.5 font-normal bg-background/50 text-muted-foreground"
							>
								status: {t.status || "placed"}
							</Badge>
							<Badge
								variant="secondary"
								className={cn(
									"text-[10px] px-1.5",
									modeBadge({ mode: getDisplayMode(t, paperMode) === "PAPER" ? "paper" : "live" }),
								)}
							>
								{getDisplayMode(t, paperMode)}
							</Badge>
						</div>
					</Card>
				);
			})}
		</div>
	);
}
