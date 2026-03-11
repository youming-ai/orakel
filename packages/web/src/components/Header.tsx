import { Activity, Loader2, Play, Zap } from "lucide-react";
import { Link, useLocation } from "react-router";

import { cn } from "@/lib/utils";

interface HeaderProps {
	viewMode: "paper" | "live";
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperMutationPending: boolean;
	liveMutationPending: boolean;
	onViewModeChange: (mode: "paper" | "live") => void;
	onPaperToggle: () => void;
	onLiveToggle: () => void;
}

type BotStatus = "stopped" | "starting" | "running" | "stopping";

function getBotStatus(running: boolean, pendingStart: boolean, pendingStop: boolean): BotStatus {
	if (pendingStart) return "starting";
	if (pendingStop) return "stopping";
	if (running) return "running";
	return "stopped";
}

const statusConfig: Record<BotStatus, { label: string; className: string }> = {
	stopped: {
		label: "Stopped",
		className: "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20",
	},
	starting: {
		label: "Starting…",
		className: "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20",
	},
	running: {
		label: "Running",
		className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20",
	},
	stopping: {
		label: "Stopping…",
		className: "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20",
	},
};

function StatusIcon({ status }: { status: BotStatus }) {
	switch (status) {
		case "stopped":
			return <Play className="size-3 fill-current" />;
		case "starting":
		case "stopping":
			return <Loader2 className="size-3 animate-spin" />;
		case "running":
			return (
				<div className="relative flex items-center justify-center">
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
					<Activity className="size-3 text-emerald-400 relative" />
				</div>
			);
	}
}

export function Header({
	viewMode,
	paperRunning,
	liveRunning,
	paperPendingStart,
	paperPendingStop,
	livePendingStart,
	livePendingStop,
	paperMutationPending,
	liveMutationPending,
	onViewModeChange,
	onPaperToggle,
	onLiveToggle,
}: HeaderProps) {
	const location = useLocation();
	const isTradesActive = location.pathname === "/logs";
	const isRunning = viewMode === "paper" ? paperRunning : liveRunning;
	const pendingStart = viewMode === "paper" ? paperPendingStart : livePendingStart;
	const pendingStop = viewMode === "paper" ? paperPendingStop : livePendingStop;
	const status = getBotStatus(isRunning, pendingStart, pendingStop);
	const isPending = status === "starting" || status === "stopping";
	const mutationPending = viewMode === "paper" ? paperMutationPending : liveMutationPending;

	const handleToggle = viewMode === "paper" ? onPaperToggle : onLiveToggle;
	const cfg = statusConfig[status];

	return (
		<header className="sticky top-3 z-50 mb-0.5 max-w-7xl mx-auto px-3 sm:px-6">
			<div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 rounded-xl border bg-card shadow-md w-full overflow-hidden relative">
				<nav aria-label="Main navigation" className="flex items-center gap-2.5 cursor-default select-none min-w-0">
					<Link to="/" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity no-underline shrink-0">
						<div className="flex items-center justify-center p-1 bg-primary/10 text-primary rounded-md border border-primary/20">
							<Zap className="size-3.5" aria-hidden="true" />
						</div>
						<span className="text-sm font-bold tracking-tight text-foreground">Orakel</span>
					</Link>
					<div className="hidden md:flex items-center gap-2.5 shrink-0">
						<div className="h-4 w-px bg-border/60 shrink-0" />
						<Link
							to="/logs"
							className={cn(
								"text-xs text-muted-foreground hover:text-foreground transition-colors no-underline shrink-0",
								isTradesActive && "text-foreground",
							)}
						>
							logs
						</Link>
					</div>
				</nav>

				<div className="absolute left-1/2 -translate-x-1/2 flex items-center rounded-md border overflow-hidden min-h-7 bg-muted/50 shrink-0">
					<button
						type="button"
						onClick={() => onViewModeChange("paper")}
						aria-pressed={viewMode === "paper"}
						className={cn(
							"px-2.5 h-7 text-[11px] font-semibold tracking-wide uppercase transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
							viewMode === "paper"
								? "bg-amber-500/20 text-amber-500"
								: "bg-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						Paper
					</button>
					<button
						type="button"
						onClick={() => onViewModeChange("live")}
						aria-pressed={viewMode === "live"}
						className={cn(
							"px-2.5 h-7 text-[11px] font-semibold tracking-wide uppercase transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
							viewMode === "live"
								? "bg-emerald-500/20 text-emerald-500"
								: "bg-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						Live
					</button>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					<span
						className="hidden sm:inline-block text-[11px] text-muted-foreground/60 font-mono"
						title={`Bot: ${cfg.label}`}
					>
						{cfg.label}
					</span>
					<button
						type="button"
						onClick={handleToggle}
						disabled={mutationPending}
						aria-label={`Bot status: ${cfg.label}. Click to toggle.`}
						aria-live="polite"
						className={cn(
							"flex items-center justify-center size-9 sm:size-7 rounded-md transition-all shrink-0 border outline-none focus-visible:ring-2 focus-visible:ring-ring",
							cfg.className,
							isPending && "animate-pulse",
							mutationPending && "cursor-not-allowed opacity-60",
						)}
					>
						<StatusIcon status={status} />
					</button>
				</div>
			</div>
		</header>
	);
}
