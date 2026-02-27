import { AlertTriangle, Bell, TrendingDown, TrendingUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type Alert, useAlertStore } from "@/lib/alerts";
import { cn } from "@/lib/utils";

/* ── Alert Card ─────────────────────────────────────────── */

interface AlertCardProps {
	alert: Alert;
	onDismiss: (id: string) => void;
}

function AlertCard({ alert, onDismiss }: AlertCardProps) {
	const typeConfig = {
		signal: {
			className: "border-blue-500/30 bg-blue-500/10",
			badgeVariant: "default" as const,
			badgeClass: "bg-blue-500/20 text-blue-400 border-blue-500/30",
			icon: TrendingUp,
		},
		trade: {
			className: "border-emerald-500/30 bg-emerald-500/10",
			badgeVariant: "default" as const,
			badgeClass: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
			icon: TrendingDown,
		},
		warning: {
			className: "border-amber-500/30 bg-amber-500/10",
			badgeVariant: "default" as const,
			badgeClass: "bg-amber-500/20 text-amber-400 border-amber-500/30",
			icon: AlertTriangle,
		},
	};

	const config = typeConfig[alert.type];
	const Icon = config.icon;
	const timeAgo = formatTimeAgo(alert.timestamp);

	return (
		<div
			className={cn(
				"relative flex flex-col gap-2 p-3 rounded-lg border shadow-lg backdrop-blur-sm transition-all",
				"animate-in slide-in-from-right-full duration-300",
				config.className,
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0">
					<Icon className="size-4 shrink-0 text-current opacity-70" />
					<Badge className={cn("text-[10px] font-medium", config.badgeClass)}>{alert.marketId}</Badge>
				</div>
				<button
					type="button"
					onClick={() => onDismiss(alert.id)}
					className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors outline-none"
					aria-label="Dismiss alert"
				>
					<X className="size-3.5 text-muted-foreground" />
				</button>
			</div>

			<div className="min-w-0">
				<p className="text-sm font-medium text-foreground truncate">{alert.title}</p>
				<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.description}</p>
			</div>

			<div className="flex items-center justify-between text-[10px] text-muted-foreground">
				<span className="uppercase font-medium">{alert.type}</span>
				<span>{timeAgo}</span>
			</div>
		</div>
	);
}

/* ── Alert System ─────────────────────────────────────────── */

export function AlertSystem() {
	const alerts = useAlertStore((s) => s.alerts);
	const dismissAlert = useAlertStore((s) => s.dismissAlert);

	if (alerts.length === 0) {
		return null;
	}

	return (
		<div className="fixed top-16 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
			<div className="pointer-events-auto">
				<div className="flex items-center gap-2 mb-2 px-1">
					<Bell className="size-3.5 text-muted-foreground" />
					<span className="text-xs font-medium text-muted-foreground">
						{alerts.length} active alert{alerts.length !== 1 ? "s" : ""}
					</span>
				</div>
				<div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1 scrollbar-thin">
					{alerts.map((alert) => (
						<AlertCard key={alert.id} alert={alert} onDismiss={dismissAlert} />
					))}
				</div>
			</div>
		</div>
	);
}

/* ── Utility Functions ───────────────────────────────────── */

function formatTimeAgo(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);

	if (seconds < 60) {
		return "just now";
	}

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}

	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}

	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
