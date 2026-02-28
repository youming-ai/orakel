import { EventEmitter } from "node:events";
import { CONFIG } from "./config.ts";
import { createLogger } from "./logger.ts";
import type {
	BalanceSnapshotPayload,
	MarketSnapshot,
	SignalNewPayload,
	StateSnapshotPayload,
	TradeExecutedPayload,
	WsMessage,
} from "./types.ts";

const log = createLogger("state");

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
	} catch (err) {
		log.warn("Failed to emit state:snapshot:", err);
	}
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
	} catch (err) {
		log.warn("Failed to emit signal:new:", err);
	}
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
	} catch (err) {
		log.warn("Failed to emit trade:executed:", err);
	}
}

export function emitBalanceSnapshot(payload: BalanceSnapshotPayload): void {
	const version = incrementStateVersion();
	const message = {
		type: "balance:snapshot",
		data: payload,
		ts: Date.now(),
		version,
	} satisfies WsMessage<BalanceSnapshotPayload>;

	try {
		botEvents.emit("balance:snapshot", message);
	} catch (err) {
		log.warn("Failed to emit balance:snapshot:", err);
	}
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

let _onchainBalance: BalanceSnapshotPayload | null = null;

export function setOnchainBalance(payload: BalanceSnapshotPayload): void {
	_onchainBalance = payload;
}

export function getOnchainBalance(): BalanceSnapshotPayload | null {
	return _onchainBalance;
}

let _paperRunning = CONFIG.paperMode !== false;
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
