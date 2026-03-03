import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MarketRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyPlaceholder } from "./EmptyPlaceholder";

interface MarketComparisonTableProps {
	rows: MarketRow[];
}

export function MarketComparisonTable({ rows }: MarketComparisonTableProps) {
	if (rows.length === 0) {
		return <EmptyPlaceholder />;
	}

	return (
		<div className="rounded-md border">
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
						<TableRow key={row.market}>
							<TableCell className="font-mono text-xs font-medium">{row.market}</TableCell>
							<TableCell className="font-mono text-xs text-right hidden sm:table-cell">{row.trades}</TableCell>
							<TableCell className="font-mono text-xs text-right text-emerald-400 hidden sm:table-cell">
								{row.wins}
							</TableCell>
							<TableCell className="font-mono text-xs text-right text-red-400 hidden sm:table-cell">
								{row.losses}
							</TableCell>
							<TableCell className="font-mono text-xs text-right">{row.winRatePct.toFixed(1)}%</TableCell>
							<TableCell
								className={cn("font-mono text-xs text-right", row.pnl >= 0 ? "text-emerald-400" : "text-red-400")}
							>
								{row.pnl >= 0 ? "+" : ""}
								{row.pnl.toFixed(2)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
