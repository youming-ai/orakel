import type { AccountStatsDto, WindowSnapshotDto } from "@orakel/shared/contracts";
import { createLogger } from "./logger.ts";

const log = createLogger("state");

// State container with version for optimistic locking
interface StateContainer {
	version: number;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
}

const state: StateContainer = {
	version: 0,
	paperRunning: false,
	liveRunning: false,
	paperPendingStart: false,
	paperPendingStop: false,
	livePendingStart: false,
	livePendingStop: false,
};

// Use async lock pattern for thread-safe updates
let stateLock = false;
const stateQueue: (() => void)[] = [];

async function withStateLock<T>(fn: () => T): Promise<T> {
	// Simple async lock - wait for lock to be released
	while (stateLock) {
		await new Promise<void>((resolve) => {
			stateQueue.push(resolve);
		});
	}

	stateLock = true;
	try {
		return fn();
	} finally {
		stateLock = false;
		// Release next waiter
		const next = stateQueue.shift();
		if (next) next();
	}
}

/** Cached data from the latest main loop tick — used by /api/status */
interface LatestTickData {
	currentWindow: WindowSnapshotDto | null;
	btcPrice: number | null;
	btcPriceAgeMs: number | null;
	paperStats: AccountStatsDto | null;
	liveStats: AccountStatsDto | null;
}

let _latestTick: LatestTickData = {
	currentWindow: null,
	btcPrice: null,
	btcPriceAgeMs: null,
	paperStats: null,
	liveStats: null,
};

export function isPaperRunning(): boolean {
	return state.paperRunning;
}

export function isLiveRunning(): boolean {
	return state.liveRunning;
}

export async function requestPaperStart(): Promise<void> {
	await withStateLock(() => {
		state.paperPendingStart = true;
		state.version++;
		log.info("Paper start requested", { version: state.version });
	});
}

export async function requestPaperStop(): Promise<void> {
	await withStateLock(() => {
		state.paperPendingStop = true;
		state.version++;
		log.info("Paper stop requested", { version: state.version });
	});
}

export async function requestLiveStart(): Promise<void> {
	await withStateLock(() => {
		state.livePendingStart = true;
		state.version++;
		log.info("Live start requested", { version: state.version });
	});
}

export async function requestLiveStop(): Promise<void> {
	await withStateLock(() => {
		state.livePendingStop = true;
		state.version++;
		log.info("Live stop requested", { version: state.version });
	});
}

export async function applyPendingStarts(): Promise<boolean> {
	return withStateLock(() => {
		let changed = false;

		if (state.paperPendingStart && !state.paperRunning) {
			state.paperRunning = true;
			state.paperPendingStart = false;
			state.version++;
			log.info("Paper trading started", { version: state.version });
			changed = true;
		}

		if (state.livePendingStart && !state.liveRunning) {
			state.liveRunning = true;
			state.livePendingStart = false;
			state.version++;
			log.info("Live trading started", { version: state.version });
			changed = true;
		}

		return changed;
	});
}

export async function applyPendingStops(): Promise<boolean> {
	return withStateLock(() => {
		let changed = false;

		if (state.paperPendingStop && state.paperRunning) {
			state.paperRunning = false;
			state.paperPendingStop = false;
			state.version++;
			log.info("Paper trading stopped", { version: state.version });
			changed = true;
		}

		if (state.livePendingStop && state.liveRunning) {
			state.liveRunning = false;
			state.livePendingStop = false;
			state.version++;
			log.info("Live trading stopped", { version: state.version });
			changed = true;
		}

		return changed;
	});
}

export function getStateSnapshot() {
	return {
		paperRunning: state.paperRunning,
		liveRunning: state.liveRunning,
		paperPendingStart: state.paperPendingStart,
		paperPendingStop: state.paperPendingStop,
		livePendingStart: state.livePendingStart,
		livePendingStop: state.livePendingStop,
		version: state.version,
	};
}

export function getLatestTickData(): LatestTickData {
	return _latestTick;
}

export function setLatestTickData(data: LatestTickData): void {
	_latestTick = data;
}

export function requestModeSwitch(targetMode: "paper" | "live"): void {
	if (targetMode === "live") {
		state.paperPendingStart = false;
		state.paperPendingStop = false;
	} else {
		state.livePendingStart = false;
		state.livePendingStop = false;
	}
}

// Backward-compatible sync versions (deprecated - use async versions)
export function requestPaperStartSync(): void {
	state.paperPendingStart = true;
	state.version++;
	log.info("Paper start requested (sync)", { version: state.version });
}

export function requestPaperStopSync(): void {
	state.paperPendingStop = true;
	state.version++;
	log.info("Paper stop requested (sync)", { version: state.version });
}

export function requestLiveStartSync(): void {
	state.livePendingStart = true;
	state.version++;
	log.info("Live start requested (sync)", { version: state.version });
}

export function requestLiveStopSync(): void {
	state.livePendingStop = true;
	state.version++;
	log.info("Live stop requested (sync)", { version: state.version });
}

export function applyPendingStartsSync(): boolean {
	let changed = false;
	if (state.paperPendingStart && !state.paperRunning) {
		state.paperRunning = true;
		state.paperPendingStart = false;
		state.version++;
		log.info("Paper trading started (sync)", { version: state.version });
		changed = true;
	}
	if (state.livePendingStart && !state.liveRunning) {
		state.liveRunning = true;
		state.livePendingStart = false;
		state.version++;
		log.info("Live trading started (sync)", { version: state.version });
		changed = true;
	}
	return changed;
}

export function applyPendingStopsSync(): boolean {
	let changed = false;
	if (state.paperPendingStop && state.paperRunning) {
		state.paperRunning = false;
		state.paperPendingStop = false;
		state.version++;
		log.info("Paper trading stopped (sync)", { version: state.version });
		changed = true;
	}
	if (state.livePendingStop && state.liveRunning) {
		state.liveRunning = false;
		state.livePendingStop = false;
		state.version++;
		log.info("Live trading stopped (sync)", { version: state.version });
		changed = true;
	}
	return changed;
}
