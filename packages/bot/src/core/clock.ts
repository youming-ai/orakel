import type { Phase } from "./types.ts";

export function computeWindowBounds(nowSec: number, windowSec: number): { startSec: number; endSec: number } {
	if (nowSec % windowSec === 0) {
		return { startSec: nowSec, endSec: nowSec + windowSec };
	}

	const endSec = Math.ceil(nowSec / windowSec) * windowSec;
	const startSec = endSec - windowSec;
	return { startSec, endSec };
}

export function computeSlug(endSec: number, slugPrefix: string): string {
	const sep = slugPrefix.endsWith("-") ? "" : "-";
	return `${slugPrefix}${sep}${endSec}`;
}

export function computeTimeLeftSeconds(nowMs: number, endMs: number): number {
	return Math.max(0, Math.round((endMs - nowMs) / 1000));
}

export function computePhase(timeLeftSeconds: number, phaseEarlySeconds: number, phaseLateSeconds: number): Phase {
	if (timeLeftSeconds > phaseEarlySeconds) return "EARLY";
	if (timeLeftSeconds <= phaseLateSeconds) return "LATE";
	return "MID";
}
