export interface MarketSnapshot {
  id: string;
  label: string;
  ok: boolean;
  error?: string;

  // Prices
  spotPrice: number | null;
  currentPrice: number | null;
  priceToBeat: number | null;

  // Polymarket prices
  marketUp: number | null;
  marketDown: number | null;
  rawSum: number | null;
  arbitrage: boolean;

  // Prediction
  predictLong: number | null;
  predictShort: number | null;
  predictDirection: "LONG" | "SHORT" | "NEUTRAL";

  // Indicators
  haColor: string | null;
  haConsecutive: number;
  rsi: number | null;
  macd: { macd: number; signal: number; hist: number; histDelta: number | null } | null;
  vwapSlope: number | null;

  // Timing
  timeLeftMin: number | null;
  phase: string | null;

  // Decision
  action: string;
  side: string | null;
  edge: number | null;
  strength: string | null;
  reason: string | null;

  // Extra
  volatility15m: number | null;
  blendSource: string | null;
  volImpliedUp: number | null;
  binanceChainlinkDelta: number | null;
  orderbookImbalance: number | null;
}

export interface DashboardState {
  markets: MarketSnapshot[];
  updatedAt: string;
  wallet: { address: string | null; connected: boolean };
  paperDaily: { pnl: number; trades: number; date: string };
  liveDaily: { pnl: number; trades: number; date: string };
  config: {
    strategy: Record<string, unknown>;
    paperRisk: Record<string, unknown>;
    liveRisk: Record<string, unknown>;
  };
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

let _markets: MarketSnapshot[] = [];
let _updatedAt: string = new Date().toISOString();

export function updateMarkets(snapshots: MarketSnapshot[]): void {
  _markets = snapshots;
  _updatedAt = new Date().toISOString();
}

export function getMarkets(): MarketSnapshot[] {
  return _markets;
}

export function getUpdatedAt(): string {
  return _updatedAt;
}

let _paperRunning = true;
let _liveRunning = false;

export function isPaperRunning(): boolean {
  return _paperRunning;
}

export function setPaperRunning(running: boolean): void {
  _paperRunning = running;
}

export function isLiveRunning(): boolean {
  return _liveRunning;
}

export function setLiveRunning(running: boolean): void {
  _liveRunning = running;
}
