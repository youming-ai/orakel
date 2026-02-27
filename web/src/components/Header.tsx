import { Activity, Clock, Loader2, Moon, Play, Sun, Wallet, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useUIStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface HeaderProps {
	viewMode: "paper" | "live";
	paperRunning: boolean;
	liveRunning: boolean;
	liveWalletReady: boolean;
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
		className: "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25",
	},
	starting: {
		label: "Starting…",
		className: "bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25",
	},
	running: {
		label: "Running",
		className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25",
	},
	stopping: {
		label: "Stopping…",
		className: "bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25",
	},
};

function StatusIndicator({ status }: { status: BotStatus }) {
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
	liveWalletReady,
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
	const isRunning = viewMode === "paper" ? paperRunning : liveRunning;
	const pendingStart = viewMode === "paper" ? paperPendingStart : livePendingStart;
	const pendingStop = viewMode === "paper" ? paperPendingStop : livePendingStop;
	const status = getBotStatus(isRunning, pendingStart, pendingStop);
	const isPending = status === "starting" || status === "stopping";
	const mutationPending = viewMode === "paper" ? paperMutationPending : liveMutationPending;
	const timeLeft = useCycleCountdown();
	const theme = useUIStore((s) => s.theme);
	const toggleTheme = useUIStore((s) => s.toggleTheme);

	const handleToggle = viewMode === "paper" ? onPaperToggle : onLiveToggle;
	const canToggle = viewMode === "paper" || liveRunning || liveWalletReady || isPending;
	const noWallet = viewMode === "live" && !canToggle;

	const cfg = statusConfig[canToggle ? status : "stopped"];

	return (
		<div className="sticky top-3 z-50 flex justify-center px-3 pointer-events-none">
			<header className="pointer-events-auto flex items-center justify-between px-3 sm:px-4 py-2 rounded-2xl backdrop-blur-xl bg-background/70 border border-border/50 shadow-lg w-full max-w-2xl overflow-hidden">
				{/* Logo */}
				<div className="flex items-center gap-1.5 cursor-default select-none shrink-0">
					<div className="flex items-center justify-center p-1 bg-primary/10 text-primary rounded-lg border border-primary/20">
						<Zap className="size-3.5" />
					</div>
					<span className="text-sm font-bold tracking-tight text-foreground hidden sm:block">Orakel</span>
				</div>

				{/* Right: Countdown + Status + Mode + Theme */}
				<div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
					<div className="flex items-center gap-1.5 shrink-0" title="Time until next 15-minute cycle boundary">
						<Clock className="size-3 text-muted-foreground" />
						<span className="font-mono text-xs font-semibold text-foreground/80 tabular-nums">{timeLeft}</span>
					</div>

					<div className="h-4 w-px bg-border/60 shrink-0 hidden sm:block" />

					<button
						type="button"
						onClick={canToggle ? handleToggle : undefined}
						disabled={!canToggle || mutationPending}
						className={cn(
							"flex items-center gap-1.5 h-7 px-2 sm:px-2.5 text-[10px] font-semibold tracking-wide uppercase rounded-lg transition-all shrink-0 border outline-none",
							noWallet
								? "bg-muted text-muted-foreground border-transparent cursor-not-allowed opacity-50"
								: cfg.className,
							isPending && "animate-pulse",
						)}
						title={
							noWallet
								? "Connect wallet first"
								: isPending
									? "Click to cancel"
									: `Click to ${isRunning ? "stop" : "start"}`
						}
					>
						{noWallet ? (
							<>
								<Wallet className="size-3" />
								<span className="hidden sm:inline">No Wallet</span>
							</>
						) : (
							<>
								<StatusIndicator status={status} />
								<span>{cfg.label}</span>
							</>
						)}
					</button>

					<div className="h-4 w-px bg-border/60 shrink-0 hidden sm:block" />

					<div className="flex items-center rounded-lg border border-border overflow-hidden h-7 bg-muted/20 shrink-0">
						<button
							type="button"
							onClick={() => onViewModeChange("paper")}
							className={cn(
								"px-2 sm:px-2.5 h-full text-[10px] font-semibold tracking-wide uppercase transition-all outline-none",
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
								"px-2 sm:px-2.5 h-full text-[10px] font-semibold tracking-wide uppercase transition-all outline-none",
								viewMode === "live"
									? "bg-emerald-500/20 text-emerald-500"
									: "bg-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							Live
						</button>
					</div>

					<button
						type="button"
						onClick={toggleTheme}
						aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
						className="flex items-center justify-center size-7 rounded-lg border border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors outline-none shrink-0"
						title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
					>
						{theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
					</button>
				</div>
			</header>
		</div>
	);
}
