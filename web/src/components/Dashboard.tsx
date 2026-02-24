import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createWsCacheHandler, useDashboardState, useLiveCancel, useLiveToggle, usePaperCancel, usePaperStats, usePaperToggle, useTrades } from "@/lib/queries";
import type { ViewMode } from "@/lib/types";
import { useWebSocket } from "@/lib/ws";
import { AnalyticsTabs } from "./AnalyticsTabs";
import { Header } from "./Header";
import { Web3Provider } from "./Web3Provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function DashboardContent() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("viewMode") as ViewMode) || "paper";
    }
    return "paper";
  });
  const [confirmAction, setConfirmAction] = useState<"start" | "stop" | null>(null);
  const queryClient = useQueryClient();

  // WebSocket cache handler - memoized to prevent infinite re-renders
  const wsCacheHandler = useMemo(
    () => createWsCacheHandler(queryClient),
    [queryClient]
  );

  // WebSocket connection
  useWebSocket({
    onMessage: wsCacheHandler,
    onConnect: () => console.log("[Dashboard] WebSocket connected"),
    onDisconnect: () => console.log("[Dashboard] WebSocket disconnected"),
  });

  const { data: state, error: stateError } = useDashboardState();
  const { data: trades = [] } = useTrades(viewMode);
  const { data: paperStatsData } = usePaperStats(viewMode === "paper");
  const paperToggle = usePaperToggle();
  const liveToggle = useLiveToggle();
  const paperCancel = usePaperCancel();
  const liveCancel = useLiveCancel();

  const paperTrades = paperStatsData?.trades ?? [];
  const paperByMarket = paperStatsData?.byMarket ?? {};

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("viewMode", mode);
    }
  }, []);


  const handlePaperToggle = useCallback(() => {
    if (!state) return;
    if (state.paperPendingStart || state.paperPendingStop) {
      paperCancel.mutate();
      return;
    }
    setConfirmAction(state.paperRunning ? "stop" : "start");
  }, [state, paperCancel]);

  const handleLiveToggle = useCallback(() => {
    if (!state) return;
    if (state.livePendingStart || state.livePendingStop) {
      liveCancel.mutate();
      return;
    }
    if (!state.liveRunning && !state.liveWallet?.clientReady) return;
    setConfirmAction(state.liveRunning ? "stop" : "start");
  }, [state, liveCancel]);


  const handleConfirm = useCallback(() => {
    if (!state || !confirmAction) return;
    if (viewMode === "paper") {
      paperToggle.mutate(confirmAction === "stop");
    } else {
      liveToggle.mutate(confirmAction === "stop");
    }
    setConfirmAction(null);
  }, [state, confirmAction, viewMode, paperToggle, liveToggle]);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-3">
          {stateError ? (
            <>
              <p className="text-sm text-red-400">
                Failed to connect: {stateError.message}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 px-4 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-accent transition-colors"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <div
                className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
                role="status"
                aria-label="Loading dashboard"
              />
              <p className="text-sm text-muted-foreground">Connecting to bot...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        viewMode={viewMode}
        paperRunning={state.paperRunning}
        liveRunning={state.liveRunning}
        liveWalletReady={state.liveWallet?.clientReady ?? false}
        paperPendingStart={state.paperPendingStart ?? false}
        paperPendingStop={state.paperPendingStop ?? false}
        livePendingStart={state.livePendingStart ?? false}
        livePendingStop={state.livePendingStop ?? false}
        onViewModeChange={handleViewModeChange}
        onPaperToggle={handlePaperToggle}
        onLiveToggle={handleLiveToggle}
      />
      <main className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-safe">
        <AnalyticsTabs
          stats={viewMode === "paper" ? state.paperStats : null}
          trades={viewMode === "paper" ? paperTrades : []}
          byMarket={viewMode === "paper" ? paperByMarket : {}}
          config={state.config}
          markets={state.markets}
          liveTrades={trades}
          viewMode={viewMode}
          stopLoss={viewMode === "paper" ? state.stopLoss : undefined}
          todayStats={viewMode === "paper" ? state.todayStats : undefined}
        />
      </main>


      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "start" ? "Start Bot" : "Stop Bot"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "start"
                ? `Start ${viewMode} trading? The bot will begin at the next 15-minute cycle boundary.`
                : `Stop ${viewMode} trading? The bot will finish the current cycle and settle before stopping.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              variant={confirmAction === "stop" ? "destructive" : "default"}
            >
              {confirmAction === "start" ? "Start" : "Stop"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Dashboard() {
  return (
    <Web3Provider>
      <DashboardContent />
    </Web3Provider>
  );
}
