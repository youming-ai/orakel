import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useToastStore } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function Toaster() {
	const toasts = useToastStore((state) => state.toasts);
	const dismiss = useToastStore((state) => state.dismiss);

	if (toasts.length === 0) return null;

	return (
		<div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none px-4 sm:px-0">
			{toasts.map((t) => (
				<div
					key={t.id}
					className={cn(
						"flex items-start gap-3 p-4 rounded-lg border shadow-lg backdrop-blur-md pointer-events-auto",
						"animate-in slide-in-from-bottom-3 fade-in duration-300",
						t.type === "success" && "bg-emerald-950/70 border-emerald-500/30 text-emerald-400",
						t.type === "error" && "bg-red-950/70 border-red-500/30 text-red-400",
						t.type === "info" && "bg-card/80 border-border text-foreground",
					)}
				>
					{t.type === "success" && <CheckCircle2 className="size-5 shrink-0 mt-0.5" />}
					{t.type === "error" && <AlertTriangle className="size-5 shrink-0 mt-0.5" />}
					{t.type === "info" && <Info className="size-5 shrink-0 mt-0.5 text-muted-foreground" />}

					<div className="flex flex-col gap-0.5 flex-1 min-w-0">
						{t.title && <span className="font-semibold text-sm leading-tight">{t.title}</span>}
						<span className="text-xs text-current/80 leading-relaxed">{t.description}</span>
					</div>

					<button
						type="button"
						onClick={() => dismiss(t.id)}
						className="p-1 rounded-md opacity-40 hover:opacity-100 transition-opacity focus:outline-none shrink-0"
					>
						<X className="size-3.5" />
					</button>
				</div>
			))}
		</div>
	);
}
