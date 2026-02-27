import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
	label: string;
	value: string;
	color?: string;
	suffix?: string;
	icon?: React.ReactNode;
	trend?: "up" | "down" | "neutral";
	highlight?: boolean;
}

export function StatCard({ label, value, color, suffix, icon, trend, highlight }: StatCardProps) {
	return (
		<div className={cn("flex flex-col gap-1.5 p-4 bg-card", highlight && "bg-primary/5 ring-1 ring-primary/10")}>
			<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
				{icon && <span className="opacity-70">{icon}</span>}
				{label}
			</span>
			<div className="flex items-center gap-1.5">
				<span
					className={cn(
						"font-mono font-bold tracking-tight block",
						highlight ? "text-2xl" : "text-xl",
						color || "text-foreground",
					)}
				>
					{value}
					{suffix && (
						<span className="text-[10px] font-semibold text-muted-foreground ml-1.5 tracking-wide uppercase">
							{suffix}
						</span>
					)}
				</span>
				{trend === "up" && <ArrowUpRight className="size-3.5 text-emerald-400 stroke-[3] ml-1 opacity-80" />}
				{trend === "down" && <ArrowDownRight className="size-3.5 text-red-400 stroke-[3] ml-1 opacity-80" />}
				{trend === "neutral" && <Minus className="size-3.5 text-muted-foreground stroke-[3] ml-1 opacity-50" />}
			</div>
		</div>
	);
}
