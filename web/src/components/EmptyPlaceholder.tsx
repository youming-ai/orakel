import { Activity } from "lucide-react";

export function EmptyPlaceholder() {
	return (
		<div className="h-full w-full flex flex-col items-center justify-center p-6 text-muted-foreground bg-muted/5 rounded-lg border border-dashed border-border/50">
			<Activity className="size-8 mb-3 opacity-20" />
			<span className="text-[10px] font-medium uppercase tracking-widest opacity-60">Awaiting Signal</span>
		</div>
	);
}
