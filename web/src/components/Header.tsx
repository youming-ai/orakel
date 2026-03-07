import { Activity, Loader2, Play, Zap } from "lucide-react";
import { Link, useLocation } from "react-router";

import { fmtPrice } from "@/lib/format";
import { useSnapshot } from "@/lib/store";
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

function BtcIcon({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12.5 2C7.81 2 4 5.81 4 10.5c0 4.69 3.81 8.5 8.5 8.5s8.5-3.81 8.5-8.5C21 5.81 17.19 2 12.5 2zm1.5 12.5h-1v1.5h-1v-1.5h-1v1.5H10v-1.5H8v-1h1v-5H8v-1h2V6h1v1.5h1V6h1v1.5c1.38 0 2.5 1.12 2.5 2.5 0 .74-.33 1.4-.84 1.85.51.45.84 1.11.84 1.85 0 1.38-1.12 2.5-2.5 2.5zm0-4.5c0-.55-.45-1-1-1h-2v2h2c.55 0 1-.45 1-1zm-3 3.5h2c.55 0 1-.45 1-1s-.45-1-1-1h-2v2z" />
		</svg>
	);
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
	const snapshot = useSnapshot();
	const market = snapshot?.markets?.[0];
	const marketBase = market?.ok ? market.id.split("-")[0] : null;
	const marketSpotPrice = market?.ok ? fmtPrice(market.id, market.spotPrice) : null;
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
		<div className="sticky top-3 z-50 mb-0.5 max-w-7xl mx-auto px-3 sm:px-6 pointer-events-none">
			<header className="pointer-events-auto flex items-center justify-between gap-2 px-3 sm:px-4 py-2 rounded-xl border bg-card shadow-md w-full overflow-hidden relative">
				<div className="flex items-center gap-2.5 cursor-default select-none min-w-0">
					<Link to="/" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity no-underline shrink-0">
						<div className="flex items-center justify-center p-1 bg-primary/10 text-primary rounded-md border border-primary/20">
							<Zap className="size-3.5" />
						</div>
						<span className="text-sm font-bold tracking-tight text-foreground">Orakel</span>
					</Link>
					{market?.ok && marketBase && marketSpotPrice && (
						<div className="hidden sm:flex items-center gap-1.5 shrink-0">
							<span className="h-4 w-px bg-border/60 shrink-0" />
							<BtcIcon className="size-4 text-orange-400" />
							<span className="text-sm font-semibold tracking-tight tabular-nums text-foreground leading-none">
								{marketSpotPrice}
							</span>
						</div>
					)}
					<div className="hidden md:flex items-center gap-2.5 shrink-0">
						<span className="h-4 w-px bg-border/60 shrink-0" />
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
				</div>

				<div className="absolute left-1/2 -translate-x-1/2 flex items-center rounded-md border overflow-hidden min-h-7 bg-muted/50 shrink-0">
					<button
						type="button"
						onClick={() => onViewModeChange("paper")}
						className={cn(
							"px-2.5 h-7 text-[11px] font-semibold tracking-wide uppercase transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
							viewMode === "paper"
								? "bg-amber-500/20 text-amber-500"
								: "bg-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						Paper
					</button>
					<div className="w-px self-stretch bg-border" />
					<button
						type="button"
						onClick={() => onViewModeChange("live")}
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

				<div className="flex items-center shrink-0">
					<button
						type="button"
						onClick={handleToggle}
						disabled={mutationPending}
						className={cn(
							"flex items-center justify-center size-9 sm:size-7 rounded-md transition-all shrink-0 border outline-none focus-visible:ring-2 focus-visible:ring-ring",
							cfg.className,
							isPending && "animate-pulse",
						)}
						title={cfg.label}
					>
						<StatusIcon status={status} />
					</button>
				</div>
			</header>
		</div>
	);
}
