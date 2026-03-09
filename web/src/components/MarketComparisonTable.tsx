import { BtcIcon, EthIcon } from "@/components/icons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MarketRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyPlaceholder } from "./EmptyPlaceholder";

function MarketCell({ market }: { market: string }) {
	const isBtc = market.startsWith("BTC");
	const isEth = market.startsWith("ETH");
	return (
		<span className="flex items-center gap-1.5">
			{isBtc && <BtcIcon size={14} />}
			{isEth && <EthIcon size={14} />}
			<span>{market}</span>
		</span>
	);
}

function WinRateBar({ winRate }: { winRate: number }) {
	const pct = Math.round(winRate * 100);
	return (
		<div className="flex items-center gap-1.5">
			<div className="w-12 h-1.5 bg-muted/30 rounded-full overflow-hidden hidden sm:block">
				<div
					className={cn("h-full rounded-full transition-all", pct >= 50 ? "bg-emerald-500/60" : "bg-red-500/60")}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className={cn("font-mono", pct >= 50 ? "text-emerald-400" : "text-red-400")}>{pct.toFixed(1)}%</span>
		</div>
	);
}

interface MarketComparisonTableProps {
	rows: MarketRow[];
}

export function MarketComparisonTable({ rows }: MarketComparisonTableProps) {
	if (rows.length === 0) {
		return <EmptyPlaceholder />;
	}

	const totalRow = rows.reduce(
		(acc, r) => ({
			trades: acc.trades + r.trades,
			wins: acc.wins + r.wins,
			losses: acc.losses + r.losses,
			pnl: acc.pnl + r.pnl,
		}),
		{ trades: 0, wins: 0, losses: 0, pnl: 0 },
	);
	const totalResolved = totalRow.wins + totalRow.losses;
	const totalWinRate = totalResolved > 0 ? totalRow.wins / totalResolved : 0;

	return (
		<div className="rounded-lg border overflow-hidden">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Market</TableHead>
						<TableHead className="text-right hidden sm:table-cell">Trades</TableHead>
						<TableHead className="text-right hidden sm:table-cell">W</TableHead>
						<TableHead className="text-right hidden sm:table-cell">L</TableHead>
						<TableHead className="text-right">WR%</TableHead>
						<TableHead className="text-right">P&L</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.market} className="hover:bg-muted/50 transition-colors">
							<TableCell className="font-mono text-xs font-medium">
								<MarketCell market={row.market} />
							</TableCell>
							<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{row.trades}</TableCell>
							<TableCell className="font-mono text-xs text-right text-emerald-400 hidden sm:table-cell">
								{row.wins}
							</TableCell>
							<TableCell className="font-mono text-xs text-right text-red-400 hidden sm:table-cell">
								{row.losses}
							</TableCell>
							<TableCell className="font-mono text-xs text-right">
								<WinRateBar winRate={row.winRate} />
							</TableCell>
							<TableCell
								className={cn(
									"font-mono text-xs text-right font-medium",
									row.pnl >= 0 ? "text-emerald-400" : "text-red-400",
								)}
							>
								{row.pnl >= 0 ? "+" : ""}
								{row.pnl.toFixed(2)}
							</TableCell>
						</TableRow>
					))}
					{/* Totals row */}
					{rows.length > 1 && (
						<TableRow className="border-t-2 border-border/60 bg-muted/20 font-medium">
							<TableCell className="font-mono text-xs font-semibold text-muted-foreground">Total</TableCell>
							<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{totalRow.trades}</TableCell>
							<TableCell className="font-mono text-xs text-right text-emerald-400 hidden sm:table-cell">
								{totalRow.wins}
							</TableCell>
							<TableCell className="font-mono text-xs text-right text-red-400 hidden sm:table-cell">
								{totalRow.losses}
							</TableCell>
							<TableCell className="font-mono text-xs text-right">
								<WinRateBar winRate={totalWinRate} />
							</TableCell>
							<TableCell
								className={cn(
									"font-mono text-xs text-right font-semibold",
									totalRow.pnl >= 0 ? "text-emerald-400" : "text-red-400",
								)}
							>
								{totalRow.pnl >= 0 ? "+" : ""}
								{totalRow.pnl.toFixed(2)}
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
