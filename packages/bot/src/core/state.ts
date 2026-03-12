import { createLogger } from "./logger.ts";

const log = createLogger("state");

let _paperRunning = false;
let _liveRunning = false;
let _paperPendingStart = false;
let _paperPendingStop = false;
let _livePendingStart = false;
let _livePendingStop = false;

export function isPaperRunning(): boolean {
	return _paperRunning;
}

export function isLiveRunning(): boolean {
	return _liveRunning;
}

export function isPaperPendingStart(): boolean {
	return _paperPendingStart;
}

export function isPaperPendingStop(): boolean {
	return _paperPendingStop;
}

export function isLivePendingStart(): boolean {
	return _livePendingStart;
}

export function isLivePendingStop(): boolean {
	return _livePendingStop;
}

export function requestPaperStart(): void {
	_paperPendingStart = true;
	log.info("Paper start requested");
}

export function requestPaperStop(): void {
	_paperPendingStop = true;
	log.info("Paper stop requested");
}

export function requestLiveStart(): void {
	_livePendingStart = true;
	log.info("Live start requested");
}

export function requestLiveStop(): void {
	_livePendingStop = true;
	log.info("Live stop requested");
}

export function applyPendingStarts(): boolean {
	let changed = false;
	if (_paperPendingStart && !_paperRunning) {
		_paperRunning = true;
		_paperPendingStart = false;
		log.info("Paper trading started");
		changed = true;
	}
	if (_livePendingStart && !_liveRunning) {
		_liveRunning = true;
		_livePendingStart = false;
		log.info("Live trading started");
		changed = true;
	}
	return changed;
}

export function applyPendingStops(): boolean {
	let changed = false;
	if (_paperPendingStop && _paperRunning) {
		_paperRunning = false;
		_paperPendingStop = false;
		log.info("Paper trading stopped");
		changed = true;
	}
	if (_livePendingStop && _liveRunning) {
		_liveRunning = false;
		_livePendingStop = false;
		log.info("Live trading stopped");
		changed = true;
	}
	return changed;
}

export function getStateSnapshot() {
	return {
		paperRunning: _paperRunning,
		liveRunning: _liveRunning,
		paperPendingStart: _paperPendingStart,
		paperPendingStop: _paperPendingStop,
		livePendingStart: _livePendingStart,
		livePendingStop: _livePendingStop,
	};
}

/** Reset all state - for testing only */
export function resetState(): void {
	_paperRunning = false;
	_liveRunning = false;
	_paperPendingStart = false;
	_paperPendingStop = false;
	_livePendingStart = false;
	_livePendingStop = false;
}
