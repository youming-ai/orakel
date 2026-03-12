import type { MarketInfo } from "../core/types.ts";
import type { WindowStateLabel } from "../core/types.ts";

export interface WindowTrackerState {
	slug: string;
	state: WindowStateLabel;
	startMs: number;
	endMs: number;
	marketInfo: MarketInfo | null;
	traded: boolean;
}

export function createWindowState(slug: string, startMs: number, endMs: number): WindowTrackerState {
	return { slug, state: "PENDING", startMs, endMs, marketInfo: null, traded: false };
}

export function advanceWindowState(
	current: WindowTrackerState,
	nowMs: number,
	resolutionConfirmed: boolean,
): WindowTrackerState {
	const next = { ...current };

	switch (current.state) {
		case "PENDING":
			if (nowMs >= current.startMs && nowMs < current.endMs) {
				next.state = "ACTIVE";
			}
			break;
		case "ACTIVE":
			if (nowMs >= current.endMs) {
				next.state = "CLOSING";
			}
			break;
		case "CLOSING":
			if (resolutionConfirmed) {
				next.state = "SETTLED";
			}
			break;
		case "SETTLED":
			break;
		case "REDEEMED":
			break;
	}

	return next;
}
