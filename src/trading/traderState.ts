import type { ClobClient } from "@polymarket/clob-client";
import type { Wallet } from "ethers";

export const traderState = {
	wallet: null as Wallet | null,
	client: null as ClobClient | null,
	openGtdOrders: new Set<string>(),
	heartbeatId: null as string | null,
	heartbeatTimer: null as ReturnType<typeof setInterval> | null,
	heartbeatFailures: 0,
	reconnectTimer: null as ReturnType<typeof setTimeout> | null,
	reconnectAttempts: 0,
	heartbeatReconnecting: false,
	paperTradeLock: Promise.resolve() as Promise<void>,
	liveTradeLock: Promise.resolve() as Promise<void>,
};

export const MAX_HEARTBEAT_FAILURES = 3;
export const MAX_RECONNECT_ATTEMPTS = 5;

export function withTradeLock<T>(mode: "paper" | "live", fn: () => Promise<T>): Promise<T> {
	const prev = mode === "paper" ? traderState.paperTradeLock : traderState.liveTradeLock;
	let releaseLock: (() => void) | undefined;
	const lockPromise = new Promise<void>((resolve) => {
		releaseLock = resolve;
	});

	if (mode === "paper") {
		traderState.paperTradeLock = lockPromise;
	} else {
		traderState.liveTradeLock = lockPromise;
	}

	return prev.then(fn).finally(() => {
		releaseLock?.();
	});
}
