import { cn } from "@/lib/utils";
import { ConnectWallet } from "./ConnectWallet";

interface HeaderProps {
  viewMode: "paper" | "live";
  paperRunning: boolean;
  liveRunning: boolean;
  onViewModeChange: (mode: "paper" | "live") => void;
  onPaperToggle: () => Promise<void>;
  onLiveToggle: () => Promise<void>;
}

export function Header({ viewMode, paperRunning, liveRunning, onViewModeChange, onPaperToggle, onLiveToggle }: HeaderProps) {
  const isRunning = viewMode === "paper" ? paperRunning : liveRunning;
  const handleToggle = viewMode === "paper" ? onPaperToggle : onLiveToggle;

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-tight">Polymarket Bot</h1>

        <div className="flex items-center rounded-md border border-border overflow-hidden h-7">
          <button
            type="button"
            onClick={() => onViewModeChange("paper")}
            className={cn(
              "px-3 h-full text-xs font-medium transition-colors",
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
              "px-3 h-full text-xs font-medium transition-colors",
              viewMode === "live"
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Live
          </button>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            "flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-md transition-colors",
            isRunning
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
          )}
        >
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              isRunning ? "bg-emerald-400" : "bg-red-400"
            )}
          />
          {isRunning ? "Running" : "Stopped"}
        </button>
      </div>

      <div className="flex items-center">
        {viewMode === "live" ? (
          <ConnectWallet />
        ) : (
          <span className="text-xs text-muted-foreground">Paper Mode</span>
        )}
      </div>
    </header>
  );
}
