import { Filter, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Alert, useAlertStore, useFilteredHistory } from "@/lib/alerts";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/* ── Type Filter Dropdown ────────────────────────────────── */

type FilterType = "all" | "signal" | "trade" | "warning";

interface TypeFilterProps {
	value: FilterType;
	onChange: (value: FilterType) => void;
}

function TypeFilter({ value, onChange }: TypeFilterProps) {
	const options: { value: FilterType; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "signal", label: "Signals" },
		{ value: "trade", label: "Trades" },
		{ value: "warning", label: "Warnings" },
	];

	return (
		<div className="flex items-center gap-1.5">
			<Filter className="size-3.5 text-muted-foreground" />
			<div className="flex rounded-lg border border-border overflow-hidden h-7">
				{options.map((opt) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => onChange(opt.value)}
						className={cn(
							"px-2.5 h-full text-xs font-medium transition-colors outline-none",
							value === opt.value
								? "bg-primary/20 text-primary"
								: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
						)}
					>
						{opt.label}
					</button>
				))}
			</div>
		</div>
	);
}

/* ── Alert Type Badge ────────────────────────────────────── */

interface AlertTypeBadgeProps {
	type: Alert["type"];
}

function AlertTypeBadge({ type }: AlertTypeBadgeProps) {
	const config = {
		signal: { label: "Signal", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
		trade: { label: "Trade", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
		warning: { label: "Warning", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
	};

	const cfg = config[type];

	return <Badge className={cn("text-[10px] font-medium", cfg.className)}>{cfg.label}</Badge>;
}

/* ── Format Time ─────────────────────────────────────────── */

function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const isToday = date.toDateString() === now.toDateString();

	if (isToday) {
		return date.toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
	}

	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

/* ── Alert History ───────────────────────────────────────── */

export function AlertHistory() {
	const [filter, setFilter] = useState<FilterType>("all");
	const history = useFilteredHistory(filter);
	const clearHistory = useAlertStore((s) => s.clearHistory);

	const handleClearHistory = () => {
		clearHistory();
		toast({ type: "info", description: "Alert history cleared" });
	};

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="text-base">Alert History</CardTitle>
						<CardDescription>
							{history.length} alert{history.length !== 1 ? "s" : ""} recorded
						</CardDescription>
					</div>
					<div className="flex items-center gap-3">
						<TypeFilter value={filter} onChange={setFilter} />
						<Button
							variant="outline"
							size="xs"
							onClick={handleClearHistory}
							disabled={history.length === 0}
							className="gap-1.5"
						>
							<Trash2 className="size-3" />
							Clear
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{history.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
						<div className="text-sm">No alerts recorded</div>
						<div className="text-xs mt-1">
							{filter !== "all" ? "Try changing the filter" : "Alerts will appear here when triggered"}
						</div>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-24">Time</TableHead>
								<TableHead className="w-20">Market</TableHead>
								<TableHead className="w-20">Type</TableHead>
								<TableHead>Description</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{history.map((alert) => (
								<TableRow key={alert.id}>
									<TableCell className="text-xs font-mono text-muted-foreground tabular-nums">
										{formatTimestamp(alert.timestamp)}
									</TableCell>
									<TableCell>
										<Badge variant="outline" className="text-[10px]">
											{alert.marketId}
										</Badge>
									</TableCell>
									<TableCell>
										<AlertTypeBadge type={alert.type} />
									</TableCell>
									<TableCell>
										<div className="max-w-xs">
											<p className="text-sm font-medium truncate">{alert.title}</p>
											<p className="text-xs text-muted-foreground truncate">{alert.description}</p>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
