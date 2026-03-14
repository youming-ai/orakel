import { ExternalLink, Hourglass, Rocket, Skull } from "lucide-react";
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
		<div className="grid grid-cols-1 gap-2 sm:hidden">
			{pageTrades.map((t) => {
				const { text, isUp } = sideLabel(t.side);
				const slug = getMarketCycleSlug(t.market, t.timestamp, t.marketSlug);
				const hasPnl = t.won !== null && t.pnl !== null;
				const pnlValue = hasPnl ? Number(t.pnl) : null;
				const isWon = t.won === 1;
				const displayMode = getDisplayMode(t, paperMode);

				return (
					<Card
						key={t.orderId || `trade-${t.timestamp}-${t.market}`}
						className={cn(
							"p-2.5 transition-colors",
							hasPnl && (isWon ? "border-l-2 border-l-emerald-500/40" : "border-l-2 border-l-red-500/40"),
						)}
					>
						<div className="flex items-center justify-between gap-1.5">
							<div className="flex items-center gap-1.5 min-w-0">
								<a
									href={slug ? getPolymarketUrl(slug) : undefined}
									target="_blank"
									rel="noopener noreferrer"
									className={cn(
										"inline-flex items-center gap-1 font-mono text-xs font-medium truncate transition-colors",
										slug && "text-blue-400 hover:text-blue-300",
									)}
								>
									<MarketWithIcon market={t.market} slug={slug} />
									{slug && <ExternalLink className="size-2.5 shrink-0" />}
								</a>
								<Badge
									variant="secondary"
									className={cn("text-[9px] px-1 py-0 shrink-0", sideBadge({ side: isUp ? "up" : "down" }))}
								>
									{text}
								</Badge>
								{displayMode === "PAPER" && (
									<Badge
										variant="secondary"
										className={cn("text-[9px] px-1 py-0 shrink-0", modeBadge({ mode: "paper" }))}
									>
										P
									</Badge>
								)}
							</div>
							<div className="flex items-center gap-1 shrink-0">
								{hasPnl && (
									<span className={cn("font-mono text-xs font-bold", isWon ? "text-emerald-400" : "text-red-400")}>
										{pnlValue !== null && pnlValue >= 0 ? "+" : ""}
										{pnlValue?.toFixed(2)}
									</span>
								)}
								{hasPnl ? (
									<span className={cn("inline-flex items-center h-4", isWon ? "text-emerald-400" : "text-red-400")}>
										{isWon ? <Rocket className="size-4" /> : <Skull className="size-4" />}
									</span>
								) : (
									<span className="inline-flex items-center h-4 text-amber-400">
										<Hourglass className="size-4" />
									</span>
								)}
							</div>
						</div>

						<div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground font-mono tabular-nums">
							<span>
								{fmtDate(t.timestamp)} {fmtTimestamp(t.timestamp)}
							</span>
							<span>
								${t.amount} × {t.price}¢
							</span>
						</div>
					</Card>
				);
			})}
		</div>
	);
}
