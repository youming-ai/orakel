import { Activity, Clock, Loader2, Play, Zap } from "lucide-react";
import { useEffect, useState } from "react";
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
		className: "bg-red-500/10 dark:bg-red-500/5 text-red-400 border-red-500/30 hover:bg-red-500/20 backdrop-blur-md",
	},
	starting: {
		label: "Starting…",
		className: "bg-amber-500/10 dark:bg-amber-500/5 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 backdrop-blur-md",
	},
	running: {
		label: "Running",
		className: "bg-emerald-500/10 dark:bg-emerald-500/5 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 backdrop-blur-md",
	},
	stopping: {
		label: "Stopping…",
		className: "bg-amber-500/10 dark:bg-amber-500/5 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 backdrop-blur-md",
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

function useCycleCountdown() {
	const [timeLeft, setTimeLeft] = useState("--:--");

	useEffect(() => {
		const update = () => {
			const now = new Date();
			const m = now.getMinutes();
			const s = now.getSeconds();
			const remainM = 14 - (m % 15);
			const remainS = 59 - s;
			setTimeLeft(`${String(remainM).padStart(2, "0")}:${String(remainS).padStart(2, "0")}`);
		};
		update();
		const timer = setInterval(update, 1000);
		return () => clearInterval(timer);
	}, []);

	return timeLeft;
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
	const isTradesActive = location.pathname === "/trades";
	const isRunning = viewMode === "paper" ? paperRunning : liveRunning;
	const pendingStart = viewMode === "paper" ? paperPendingStart : livePendingStart;
	const pendingStop = viewMode === "paper" ? paperPendingStop : livePendingStop;
	const status = getBotStatus(isRunning, pendingStart, pendingStop);
	const isPending = status === "starting" || status === "stopping";
	const mutationPending = viewMode === "paper" ? paperMutationPending : liveMutationPending;
	const timeLeft = useCycleCountdown();

	const handleToggle = viewMode === "paper" ? onPaperToggle : onLiveToggle;
	const cfg = statusConfig[status];

	return (
		<div className="sticky top-3 z-50 flex justify-center px-3 pointer-events-none">
			<header className="pointer-events-auto flex items-center justify-between gap-2 px-3 sm:px-4 py-2 rounded-2xl backdrop-blur-2xl backdrop-saturate-150 bg-white/[0.08] dark:bg-black/[0.5] border border-white/15 dark:border-white/5 shadow-2xl shadow-black/10 dark:shadow-black/40 w-full max-w-3xl overflow-hidden relative">
				{/* Animated gradient mesh background */}
				<div className="absolute inset-0 -z-20 opacity-20 dark:opacity-10">
					<div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-pink-500/20 animate-pulse" />
					<div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/20 via-cyan-500/20 to-blue-500/20 animate-pulse delay-1000" />
				</div>

				{/* Logo */}
				<div className="flex items-center gap-2 cursor-default select-none shrink-0">
					<Link to="/" className="flex items-center gap-1.5 hover:opacity-80 transition-opacity no-underline">
						<div className="flex items-center justify-center p-1 bg-primary/10 text-primary rounded-lg border border-primary/20 backdrop-blur-md">
							<Zap className="size-3.5" />
						</div>
						<span className="text-sm font-bold tracking-tight text-foreground">Orakel</span>
					</Link>
					<span className="text-xs text-muted-foreground">/</span>
					<Link
						to="/trades"
						className={cn(
							"text-xs text-muted-foreground hover:text-foreground transition-colors no-underline",
							isTradesActive && "text-foreground",
						)}
					>
						Trades
					</Link>
				</div>

				{/* Right: Countdown + Status + Wallet + Mode + Theme */}
				<div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
					<div className="flex items-center gap-1.5 shrink-0" title="Time until next 15-minute cycle boundary">
						<Clock className="size-3 text-muted-foreground" />
						<span className="font-mono text-xs font-semibold text-foreground/80 tabular-nums">{timeLeft}</span>
					</div>

					<div className="h-4 w-px bg-border/60 shrink-0 hidden sm:block" />

					<button
						type="button"
						onClick={handleToggle}
						disabled={mutationPending}
						className={cn(
							"flex items-center gap-1.5 h-7 px-2 sm:px-2.5 text-[10px] font-semibold tracking-wide uppercase rounded-lg transition-all shrink-0 border outline-none backdrop-blur-md",
							cfg.className,
							isPending && "animate-pulse",
						)}
						title={isPending ? "Click to cancel" : undefined}
					>
						<StatusIcon status={status} />
						<span>{cfg.label}</span>
					</button>

					<div className="h-4 w-px bg-border/60 shrink-0 hidden sm:block" />

					<div className="flex items-center rounded-lg border border-white/10 dark:border-white/5 overflow-hidden h-7 bg-white/5 dark:bg-black/20 backdrop-blur-md shrink-0">
						<button
							type="button"
							onClick={() => onViewModeChange("paper")}
							className={cn(
								"px-2 sm:px-2.5 h-full text-[10px] font-semibold tracking-wide uppercase transition-all outline-none backdrop-blur-sm",
								viewMode === "paper"
									? "bg-amber-500/20 text-amber-500"
									: "bg-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							Paper
						</button>
						<div className="w-px h-full bg-border" />
						<button
							type="button"
							onClick={() => onViewModeChange("live")}
							className={cn(
								"px-2 sm:px-2.5 h-full text-[10px] font-semibold tracking-wide uppercase transition-all outline-none backdrop-blur-sm",
								viewMode === "live"
									? "bg-emerald-500/20 text-emerald-500"
									: "bg-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							Live
						</button>
					</div>
				</div>
			</header>
		</div>
	);
}
