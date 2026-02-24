import { EventEmitter } from "node:events";
import type {
  MarketSnapshot,
  SignalNewPayload,
  StateSnapshotPayload,
  TradeExecutedPayload,
  WsMessage,
} from "./types.ts";

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
  // Cycle-aware pending start/stop states
  paperPendingStart: boolean;
  paperPendingStop: boolean;
  livePendingStart: boolean;
  livePendingStop: boolean;
  paperPendingSince: number | null;
  livePendingSince: number | null;
}

export const botEvents = new EventEmitter();

let _stateVersion = 0;

export function getStateVersion(): number {
  return _stateVersion;
}

export function incrementStateVersion(): number {
  _stateVersion += 1;
  return _stateVersion;
}

export function emitStateSnapshot(payload: StateSnapshotPayload): void {
  const version = incrementStateVersion();
  const message = {
    type: "state:snapshot",
    data: payload,
    ts: Date.now(),
    version,
  } satisfies WsMessage<StateSnapshotPayload>;

  try {
    botEvents.emit("state:snapshot", message);
  } catch {}
}

export function emitSignalNew(payload: SignalNewPayload): void {
  const version = incrementStateVersion();
  const message = {
    type: "signal:new",
    data: payload,
    ts: Date.now(),
    version,
  } satisfies WsMessage<SignalNewPayload>;

  try {
    botEvents.emit("signal:new", message);
  } catch {}
}

export function emitTradeExecuted(payload: TradeExecutedPayload): void {
  const version = incrementStateVersion();
  const message = {
    type: "trade:executed",
    data: payload,
    ts: Date.now(),
    version,
  } satisfies WsMessage<TradeExecutedPayload>;

  try {
    botEvents.emit("trade:executed", message);
  } catch {}
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
// Pending states for cycle-aware start/stop
let _paperPendingStart = false;
let _paperPendingStop = false;
let _livePendingStart = false;
let _livePendingStop = false;

// Timestamps for when pending was requested (for UI feedback)
let _paperPendingSince: number | null = null;
let _livePendingSince: number | null = null;
export function isPaperRunning(): boolean {
  return _paperRunning;
}
export function setPaperRunning(running: boolean): void {
  _paperRunning = running;
  if (running) {
    // Clear pending states when actually running
    _paperPendingStart = false;
    _paperPendingSince = null;
  }
}
export function isLiveRunning(): boolean {
  return _liveRunning;
}
export function setLiveRunning(running: boolean): void {
  _liveRunning = running;
  if (running) {
    _livePendingStart = false;
    _livePendingSince = null;
  }
}

// Pending start - bot will start at next cycle boundary
export function isPaperPendingStart(): boolean {
  return _paperPendingStart;
}

export function setPaperPendingStart(pending: boolean): void {
  _paperPendingStart = pending;
  _paperPendingSince = pending ? Date.now() : null;
  if (pending) _paperPendingStop = false;
}

export function isLivePendingStart(): boolean {
  return _livePendingStart;
}

export function setLivePendingStart(pending: boolean): void {
  _livePendingStart = pending;
  _livePendingSince = pending ? Date.now() : null;
  if (pending) _livePendingStop = false;
}

// Pending stop - bot will stop after current cycle settlement
export function isPaperPendingStop(): boolean {
  return _paperPendingStop;
}

export function setPaperPendingStop(pending: boolean): void {
  _paperPendingStop = pending;
  _paperPendingSince = pending ? Date.now() : null;
  if (pending) _paperPendingStart = false;
}

export function isLivePendingStop(): boolean {
  return _livePendingStop;
}

export function setLivePendingStop(pending: boolean): void {
  _livePendingStop = pending;
  _livePendingSince = pending ? Date.now() : null;
  if (pending) _livePendingStart = false;
}

export function getPaperPendingSince(): number | null {
  return _paperPendingSince;
}

export function getLivePendingSince(): number | null {
  return _livePendingSince;
}

// Clear all pending states (used when transitioning to actual running/stopped)
export function clearPaperPending(): void {
  _paperPendingStart = false;
  _paperPendingStop = false;
  _paperPendingSince = null;
}

export function clearLivePending(): void {
  _livePendingStart = false;
  _livePendingStop = false;
  _livePendingSince = null;
}
