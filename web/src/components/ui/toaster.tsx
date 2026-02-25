import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
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
                        "flex items-start gap-3 p-4 rounded-xl shadow-lg border pointer-events-auto animate-in slide-in-from-bottom-2 fade-in duration-300",
                        t.type === "success" && "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                        t.type === "error" && "bg-red-500/10 border-red-500/20 text-red-400",
                        t.type === "info" && "bg-muted/50 border-border shadow-md text-foreground"
                    )}
                >
                    {t.type === "success" && <CheckCircle2 className="size-5 shrink-0 mt-0.5" />}
                    {t.type === "error" && <AlertTriangle className="size-5 shrink-0 mt-0.5" />}
                    {t.type === "info" && <Info className="size-5 shrink-0 mt-0.5 text-muted-foreground" />}

                    <div className="flex flex-col gap-1 flex-1">
                        {t.title && <span className="font-semibold text-sm">{t.title}</span>}
                        <span className="text-xs opacity-90 leading-relaxed">{t.description}</span>
                    </div>

                    <button
                        onClick={() => dismiss(t.id)}
                        className="p-1 rounded-md opacity-50 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none"
                    >
                        <X className="size-4" />
                    </button>
                </div>
            ))}
        </div>
    );
}
