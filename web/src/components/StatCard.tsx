import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
	label: string;
	value: string;
	color?: string;
	suffix?: string;
	icon?: React.ReactNode;
}

export function StatCard({ label, value, color, suffix, icon }: StatCardProps) {
	return (
		<Card>
			<CardContent className="py-3 px-4">
				<span className="text-[11px] text-muted-foreground flex items-center gap-1">
					{icon}
					{label}
				</span>
				<span className={cn("font-mono text-lg font-bold block", color)}>
					{value}
					{suffix && (
						<span className="text-xs font-normal text-muted-foreground ml-1">
							{suffix}
						</span>
					)}
				</span>
			</CardContent>
		</Card>
	);
}
