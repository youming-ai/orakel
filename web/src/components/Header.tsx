import { cn } from "@/lib/utils";
import { ConnectWallet } from "./ConnectWallet";
import { FileText, Zap, Play, Square, Wallet, Loader2 } from "lucide-react";

interface HeaderProps {
  viewMode: "paper" | "live";
  paperRunning: boolean;
  liveRunning: boolean;
  liveWalletReady: boolean;
  paperPendingStart: boolean;
  paperPendingStop: boolean;
  livePendingStart: boolean;
  livePendingStop: boolean;
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
    className: "bg-red-500/15 text-red-400 hover:bg-red-500/25",
  },
  starting: {
    label: "Starting…",
    className: "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25",
  },
  running: {
    label: "Running",
    className: "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25",
  },
  stopping: {
    label: "Stopping…",
    className: "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25",
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
      return <Square className="size-3 fill-current" />;
  }
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
  onViewModeChange,
  onPaperToggle,
  onLiveToggle,
}: HeaderProps) {
  const isRunning = viewMode === "paper" ? paperRunning : liveRunning;
  const pendingStart = viewMode === "paper" ? paperPendingStart : livePendingStart;
  const pendingStop = viewMode === "paper" ? paperPendingStop : livePendingStop;
  const status = getBotStatus(isRunning, pendingStart, pendingStop);
  const isPending = status === "starting" || status === "stopping";

  const handleToggle = viewMode === "paper" ? onPaperToggle : onLiveToggle;
  const canToggle = viewMode === "paper" || liveRunning || liveWalletReady || isPending;

  const cfg = statusConfig[canToggle ? status : "stopped"];

  return (
    <header className="sticky top-0 z-50 flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-6 py-3 sm:py-4 gap-2 sm:gap-0 backdrop-blur-md bg-background/80 border border-border rounded-b-xl shadow-lg mx-2 mt-2">

      <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-4">
          <svg className="w-8 h-8" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8B5CF6"/>
                <stop offset="50%" stopColor="#06B6D4"/>
                <stop offset="100%" stopColor="#10B981"/>
              </linearGradient>
              <linearGradient id="kGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06B6D4"/>
                <stop offset="100%" stopColor="#8B5CF6"/>
              </linearGradient>
            </defs>
            <circle cx="256" cy="256" r="240" fill="#0a0a0a"/>
            <circle cx="256" cy="256" r="180" fill="none" stroke="url(#ringGradient)" strokeWidth="24" strokeLinecap="round"/>
            <g stroke="url(#ringGradient)" strokeWidth="6" strokeLinecap="round">
              <line x1="256" y1="50" x2="256" y2="70"/>
              <line x1="462" y1="256" x2="442" y2="256"/>
              <line x1="256" y1="462" x2="256" y2="442"/>
              <line x1="50" y1="256" x2="70" y2="256"/>
            </g>
            <g transform="translate(256, 256)">
              <line x1="-40" y1="-90" x2="-40" y2="90" stroke="url(#kGradient)" strokeWidth="28" strokeLinecap="round"/>
              <line x1="-40" y1="-10" x2="60" y2="-90" stroke="url(#kGradient)" strokeWidth="28" strokeLinecap="round"/>
              <line x1="-40" y1="10" x2="60" y2="90" stroke="url(#kGradient)" strokeWidth="28" strokeLinecap="round"/>
            </g>
            <circle cx="256" cy="256" r="12" fill="#F59E0B"/>
          </svg>

          <div className="flex items-center rounded-md border border-border overflow-hidden h-7">
            <button
              type="button"
              onClick={() => onViewModeChange("paper")}
              className={cn(
                "px-3 h-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background outline-none",
                viewMode === "paper"
                  ? "bg-amber-500/20 text-amber-400 border-r border-amber-500/30"
                  : "bg-transparent text-muted-foreground hover:text-foreground border-r border-border"
              )}
            >
              Paper
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("live")}
              className={cn(
                "px-3 h-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background outline-none",
                viewMode === "live"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Live
            </button>
          </div>
        </div>


        <div className="flex sm:hidden items-center">
          {viewMode === "live" ? (
            <ConnectWallet />
          ) : (
            <span className="text-xs text-muted-foreground">Paper</span>
          )}
        </div>
      </div>


      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={canToggle ? handleToggle : undefined}
          disabled={!canToggle}
          className={cn(
            "flex items-center gap-1.5 h-9 sm:h-7 px-3 text-xs font-medium rounded-md transition-colors min-w-[88px] justify-center focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background outline-none",
            !canToggle
              ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
              : cfg.className,
            isPending && "animate-pulse"
          )}
          title={
            !canToggle
              ? "Connect wallet first"
              : isPending
                ? "Click to cancel"
                : undefined
          }
        >
          {!canToggle ? (
            <Wallet className="size-3" />
          ) : (
            <StatusIcon status={status} />
          )}
          {!canToggle ? "No Wallet" : cfg.label}
        </button>


        <div className="hidden sm:flex items-center">
          {viewMode === "live" ? (
            <ConnectWallet />
          ) : (
            <span className="text-xs text-muted-foreground">Paper Mode</span>
          )}
        </div>
      </div>
    </header>
  );
}
