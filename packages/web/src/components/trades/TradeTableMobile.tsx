import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TradeRecord } from "@/contracts/http";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { modeBadge, sideBadge } from "@/lib/variants";
import { MarketWithIcon } from "./MarketWithIcon";
import { fmtTimestamp, getDisplayMode, getMarketCycleSlug, getPolymarketUrl, sideLabel } from "./utils";

interface TradeTableMobileProps {
	pageTrades: TradeRecord[];
	paperMode: boolean;
}

export function TradeTableMobile({ pageTrades, paperMode }: TradeTableMobileProps) {
	return (
		<div className="grid grid-cols-1 gap-2.5 sm:hidden">
			{pageTrades.map((t) => {
				const { text, isUp } = sideLabel(t.side);
				const slug = getMarketCycleSlug(t.market, t.timestamp, t.marketSlug);
				const hasPnl = t.won !== null && t.pnl !== null;
				const pnlValue = hasPnl ? Number(t.pnl) : null;
				const isWon = t.won === 1;

				return (
					<Card
						key={t.orderId || `trade-${t.timestamp}-${t.market}`}
						className={cn(
							"p-3 transition-colors",
							hasPnl && (isWon ? "border-l-2 border-l-emerald-500/40" : "border-l-2 border-l-red-500/40"),
						)}
					>
						{/* Header row: Market + Side + Result */}
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-2 min-w-0">
								<span className="font-mono text-sm font-medium truncate">
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
								</span>
								<Badge
									variant="secondary"
									className={cn("text-[10px] px-1 py-0 shrink-0", sideBadge({ side: isUp ? "up" : "down" }))}
								>
									{text}
								</Badge>
							</div>
							<div className="flex items-center gap-1.5 shrink-0">
								{hasPnl && (
									<span className={cn("font-mono text-sm font-bold", isWon ? "text-emerald-400" : "text-red-400")}>
										{pnlValue !== null && pnlValue >= 0 ? "+" : ""}
										{pnlValue?.toFixed(2)}
									</span>
								)}
								{hasPnl ? (
									<Badge
										variant="secondary"
										className={cn(
											"text-[10px] px-1 py-0",
											isWon ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
										)}
									>
										{isWon ? "W" : "L"}
									</Badge>
								) : (
									<Badge variant="secondary" className="text-[10px] px-1 py-0">
										{t.status || "open"}
									</Badge>
								)}
							</div>
						</div>

						{/* Details row: timestamp + amount + entry */}
						<div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
							<span className="tabular-nums">
								{fmtDate(t.timestamp)} {fmtTimestamp(t.timestamp)}
							</span>
							<div className="flex items-center gap-2 font-mono">
								<span>
									{t.amount} @ {t.price}¢
								</span>
								{t.currentPriceAtEntry !== null && t.currentPriceAtEntry !== undefined && (
									<span className="text-muted-foreground/60">Spot ${Number(t.currentPriceAtEntry).toFixed(2)}</span>
								)}
							</div>
						</div>

						{/* Footer: mode */}
						<div className="flex items-center gap-1.5 mt-1.5">
							<Badge
								variant="secondary"
								className={cn(
									"text-[10px] px-1 py-0",
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
