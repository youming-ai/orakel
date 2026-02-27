import { Loader2, Moon, Sun, Wallet, Zap } from "lucide-react";
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

const statusConfig: Record<BotStatus, { label: string; dotClass: string; textClass: string }> = {
	stopped: {
		label: "Stopped",
		dotClass: "bg-red-400",
		textClass: "text-red-400",
	},
	starting: {
		label: "Starting…",
		dotClass: "bg-amber-400 animate-pulse",
		textClass: "text-amber-400",
	},
	running: {
		label: "Running",
		dotClass: "bg-emerald-400",
		textClass: "text-emerald-400",
	},
	stopping: {
		label: "Stopping…",
		dotClass: "bg-amber-400 animate-pulse",
		textClass: "text-amber-400",
	},
};

function StatusIndicator({ status }: { status: BotStatus }) {
	if (status === "running") {
		return (
			<span className="relative flex size-2">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
				<span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
			</span>
		);
	}
	if (status === "starting" || status === "stopping") {
		return <Loader2 className="size-3 animate-spin text-amber-400" />;
	}
	return <span className="inline-flex size-2 rounded-full bg-red-400" />;
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
	const theme = useUIStore((s) => s.theme);
	const toggleTheme = useUIStore((s) => s.toggleTheme);

	const handleToggle = viewMode === "paper" ? onPaperToggle : onLiveToggle;
	const canToggle = viewMode === "paper" || liveRunning || liveWalletReady || isPending;
	const noWallet = viewMode === "live" && !canToggle;

	const cfg = statusConfig[canToggle ? status : "stopped"];

	return (
		<div className="sticky top-3 z-50 flex justify-center px-3 pointer-events-none">
			<header className="pointer-events-auto flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2 rounded-2xl backdrop-blur-xl bg-background/70 border border-border/50 shadow-lg">
				{/* Logo */}
				<div className="flex items-center gap-1.5 cursor-default select-none shrink-0">
					<div className="flex items-center justify-center p-1 bg-primary/10 text-primary rounded-lg border border-primary/20">
						<Zap className="size-3.5" />
					</div>
					<span className="text-sm font-bold tracking-tight text-foreground hidden sm:block">Orakel</span>
				</div>

				{/* Mode + Status — combined section */}
				<div className="flex items-center gap-1.5 shrink-0">
					{/* Mode toggle */}
					<div className="flex items-center rounded-lg border border-border overflow-hidden h-7 bg-muted/20">
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

					{/* Status button */}
					<button
						type="button"
						onClick={canToggle ? handleToggle : undefined}
						disabled={!canToggle || mutationPending}
						className={cn(
							"flex items-center gap-1.5 h-7 px-2 sm:px-2.5 text-[10px] font-semibold tracking-wide uppercase rounded-lg transition-all shrink-0 outline-none",
							noWallet ? "text-muted-foreground cursor-not-allowed opacity-50" : "hover:bg-muted/40 cursor-pointer",
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
								<span className={cfg.textClass}>{cfg.label}</span>
							</>
						)}
					</button>
				</div>

				{/* Theme toggle */}
				<button
					type="button"
					onClick={toggleTheme}
					aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
					className="flex items-center justify-center size-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors outline-none shrink-0"
				>
					{theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
				</button>
			</header>
		</div>
	);
}
