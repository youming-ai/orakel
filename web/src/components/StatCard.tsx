import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { LiquidGlassCard } from "./ui/liquid-glass";

interface StatCardProps {
	label: string;
	value: string;
	color?: string;
	suffix?: string;
	icon?: React.ReactNode;
	trend?: "up" | "down" | "neutral";
}

export function StatCard({ label, value, color, suffix, icon, trend }: StatCardProps) {
	return (
		<LiquidGlassCard className="flex flex-col gap-2 p-4">
			<span className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
				{icon && <span className="opacity-70">{icon}</span>}
				{label}
			</span>
			<div className="flex items-center gap-1.5">
				<span className={cn("font-mono text-2xl font-bold tracking-tight block", color || "text-foreground")}>
					{value}
					{suffix && <span className="text-[10px] font-semibold text-muted-foreground/70 ml-1.5 tracking-wide uppercase">{suffix}</span>}
				</span>
				{trend === "up" && <ArrowUpRight className="size-4 text-emerald-400 stroke-[3] ml-1 opacity-90" />}
				{trend === "down" && <ArrowDownRight className="size-4 text-red-400 stroke-[3] ml-1 opacity-90" />}
				{trend === "neutral" && <Minus className="size-4 text-muted-foreground/60 stroke-[3] ml-1 opacity-60" />}
			</div>
		</LiquidGlassCard>
	);
}
