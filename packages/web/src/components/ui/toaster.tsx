import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { TOAST_AUTO_DISMISS_MS } from "@/lib/constants";
import { useToastStore } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function Toaster() {
	const toasts = useToastStore((state) => state.toasts);
	const dismiss = useToastStore((state) => state.dismiss);

	if (toasts.length === 0) return null;

	return (
		<>
			<style>{`
				@keyframes toast-progress {
					from { width: 100%; }
					to { width: 0%; }
				}
			`}</style>
			<div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 w-full max-w-sm pointer-events-none px-4 sm:px-0">
				{toasts.map((t) => (
					<div
						key={t.id}
						className={cn(
							"relative flex items-start gap-3 p-4 rounded-xl border shadow-2xl backdrop-blur-xl pointer-events-auto overflow-hidden",
							"transition-all duration-200 ease-out",
							!t.exiting && "animate-in slide-in-from-bottom-4 fade-in duration-300 ease-out",
							t.exiting && "animate-out slide-out-to-bottom-4 fade-out duration-200 ease-in",
							t.type === "success" && "bg-emerald-950/80 border-emerald-500/40 text-emerald-300 shadow-emerald-500/10",
							t.type === "error" && "bg-red-950/80 border-red-500/40 text-red-300 shadow-red-500/10",
							t.type === "info" && "bg-card/90 border-border/60 text-foreground shadow-black/20",
						)}
					>
						{/* Subtle top glow line */}
						<div
							className={cn(
								"absolute top-0 left-4 right-4 h-px opacity-60",
								t.type === "success" && "bg-gradient-to-r from-transparent via-emerald-400 to-transparent",
								t.type === "error" && "bg-gradient-to-r from-transparent via-red-400 to-transparent",
								t.type === "info" && "bg-gradient-to-r from-transparent via-white/30 to-transparent",
							)}
						/>

						{/* Icon */}
						<div
							className={cn(
								"shrink-0 mt-0.5",
								t.type === "success" && "text-emerald-400",
								t.type === "error" && "text-red-400",
								t.type === "info" && "text-muted-foreground",
							)}
						>
							{t.type === "success" && <CheckCircle2 className="size-5" />}
							{t.type === "error" && <AlertTriangle className="size-5" />}
							{t.type === "info" && <Info className="size-5" />}
						</div>

						{/* Content */}
						<div className="flex flex-col gap-0.5 flex-1 min-w-0">
							{t.title && <span className="font-semibold text-sm leading-snug tracking-tight">{t.title}</span>}
							<span className="text-xs leading-relaxed opacity-80">{t.description}</span>
						</div>

						{/* Dismiss button */}
						<button
							type="button"
							onClick={() => dismiss(t.id)}
							className="p-1.5 -m-1.5 rounded-lg opacity-30 hover:opacity-100 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-white/20 shrink-0 hover:bg-white/5"
						>
							<X className="size-3.5" />
						</button>

						{/* Progress bar */}
						{!t.exiting && (
							<div
								className={cn(
									"absolute bottom-0 left-0 h-0.5",
									t.type === "success" && "bg-emerald-400/60",
									t.type === "error" && "bg-red-400/60",
									t.type === "info" && "bg-foreground/30",
								)}
								style={{
									animation: `toast-progress ${TOAST_AUTO_DISMISS_MS}ms linear forwards`,
								}}
							/>
						)}
					</div>
				))}
			</div>
		</>
	);
}
