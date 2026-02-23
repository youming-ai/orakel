import { useCallback, useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { AnalyticsTabs } from "./AnalyticsTabs";
import { Header } from "./Header";
import { MarketCard } from "./MarketCard";
import { TradeTable } from "./TradeTable";
import { Web3Provider } from "./Web3Provider";

interface DashboardState {
  markets: MarketSnapshot[];
  updatedAt: string;
  wallet: { address: string | null; connected: boolean };
  paperDaily: { pnl: number; trades: number; date: string };
  liveDaily: { pnl: number; trades: number; date: string };
  config: { strategy: Record<string, unknown>; paperRisk: Record<string, unknown>; liveRisk: Record<string, unknown> };
  paperRunning: boolean;
  liveRunning: boolean;
  paperStats: {
    totalTrades: number;
    wins: number;
    losses: number;
    pending: number;
    winRate: number;
    totalPnl: number;
  } | null;
  paperBalance: { initial: number; current: number; maxDrawdown: number } | null;
  liveWallet: { address: string | null; connected: boolean; clientReady: boolean };
}

interface MarketSnapshot {
  id: string;
  label: string;
  ok: boolean;
  error?: string;
  spotPrice: number | null;
  currentPrice: number | null;
  priceToBeat: number | null;
  marketUp: number | null;
  marketDown: number | null;
  rawSum: number | null;
  arbitrage: boolean;
  predictLong: number | null;
  predictShort: number | null;
  predictDirection: "LONG" | "SHORT" | "NEUTRAL";
  haColor: string | null;
  haConsecutive: number;
  rsi: number | null;
  macd: { macd: number; signal: number; hist: number; histDelta: number | null } | null;
  vwapSlope: number | null;
  timeLeftMin: number | null;
  phase: string | null;
  action: string;
  side: string | null;
  edge: number | null;
  strength: string | null;
  reason: string | null;
  volatility15m: number | null;
  blendSource: string | null;
  volImpliedUp: number | null;
  binanceChainlinkDelta: number | null;
  orderbookImbalance: number | null;
}

interface TradeRecord {
  timestamp: string;
  market: string;
  side: string;
  amount: string;
  price: string;
  orderId: string;
  status: string;
}

interface PaperTrade {
  id: string;
  marketId: string;
  windowStartMs: number;
  side: "UP" | "DOWN";
  price: number;
  size: number;
  priceToBeat: number;
  currentPriceAtEntry: number | null;
  timestamp: string;
  resolved: boolean;
  won: boolean | null;
  pnl: number | null;
  settlePrice: number | null;
}

interface MarketBreakdown {
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  totalPnl: number;
  tradeCount: number;
}

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>([]);
  const [paperByMarket, setPaperByMarket] = useState<Record<string, MarketBreakdown>>({});
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"paper" | "live">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("viewMode") as "paper" | "live") || "paper";
    }
    return "paper";
  });

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DashboardState = await res.json();
      setState(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/trades");
      if (!res.ok) return;
      const data: TradeRecord[] = await res.json();
      setTrades(data);
    } catch {}
  }, []);

  const fetchPaperStats = useCallback(async () => {
    try {
      const res = await fetch("/api/paper-stats");
      if (!res.ok) return;
      const data = await res.json() as {
        stats?: DashboardState["paperStats"];
        trades?: PaperTrade[];
        byMarket?: Record<string, MarketBreakdown>;
        recentTrades?: PaperTrade[];
      };
      if (data.stats) {
        setState((prev) => (prev ? { ...prev, paperStats: data.stats ?? prev.paperStats } : prev));
      }
      if (data.trades) setPaperTrades(data.trades);
      else if (data.recentTrades) setPaperTrades(data.recentTrades);
      if (data.byMarket) setPaperByMarket(data.byMarket);
    } catch {}
  }, []);

  const handleViewModeChange = useCallback((mode: "paper" | "live") => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("viewMode", mode);
    }
  }, []);

  const handlePaperToggle = useCallback(async () => {
    const endpoint = state?.paperRunning ? "/api/paper/stop" : "/api/paper/start";
    try {
      await fetch(endpoint, { method: "POST" });
      await fetchState();
    } catch (e) {
      console.error("Paper toggle error:", e);
    }
  }, [state?.paperRunning, fetchState]);

  const handleLiveToggle = useCallback(async () => {
    const endpoint = state?.liveRunning ? "/api/live/stop" : "/api/live/start";
    try {
      await fetch(endpoint, { method: "POST" });
      await fetchState();
    } catch (e) {
      console.error("Live toggle error:", e);
    }
  }, [state?.liveRunning, fetchState]);

  useEffect(() => {
    fetchState();
    fetchTrades();
    fetchPaperStats();
    const stateInterval = setInterval(fetchState, 2000);
    const tradeInterval = setInterval(fetchTrades, 10000);
    const paperInterval = setInterval(fetchPaperStats, 10000);
    return () => {
      clearInterval(stateInterval);
      clearInterval(tradeInterval);
      clearInterval(paperInterval);
    };
  }, [fetchState, fetchTrades, fetchPaperStats]);

  if (!state) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-3">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <p className="text-sm text-muted-foreground">{error ? `Error: ${error}` : "Connecting to bot..."}</p>
        </div>
      </div>
    );
  }

  return (
    <Web3Provider>
    <div className="min-h-screen bg-background">
      <Header
        viewMode={viewMode}
        paperRunning={state.paperRunning}
        liveRunning={state.liveRunning}
        onViewModeChange={handleViewModeChange}
        onPaperToggle={handlePaperToggle}
        onLiveToggle={handleLiveToggle}
      />

      <main className="p-6 space-y-6 max-w-7xl mx-auto">
        {viewMode === "paper" && (
          <AnalyticsTabs
            stats={state.paperStats}
            trades={paperTrades}
            byMarket={paperByMarket}
            config={state.config}
            onConfigSaved={async () => {
              await Promise.all([fetchState(), fetchPaperStats()]);
            }}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {state.markets.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>

        <Separator />

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {viewMode === "paper" ? "Paper Trades" : "Live Trades"}
          </h2>
          <TradeTable trades={trades} paperMode={viewMode === "paper"} />
        </div>
      </main>
    </div>
    </Web3Provider>
  );
}
