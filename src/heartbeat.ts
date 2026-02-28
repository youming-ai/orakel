import type { ClobClient } from "@polymarket/clob-client";
import { createLogger } from "./logger.ts";
import { isLiveRunning, setLiveRunning } from "./state.ts";

const log = createLogger("trader");

// Polymarket cancels all open orders if no heartbeat received within 10s (5s buffer).
// We send heartbeats every 5 seconds while live trading has active GTD orders.
// FOK orders fill immediately and don't need heartbeat.
const openGtdOrders = new Set<string>(); // Track open GTD order IDs
let heartbeatId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatFailures = 0;
const MAX_HEARTBEAT_FAILURES = 3;

// Reconnection state for heartbeat
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let heartbeatReconnecting = false;
let heartbeatClient: ClobClient | null = null;

export function setHeartbeatClient(c: ClobClient | null): void {
	heartbeatClient = c;
}

export function startHeartbeat(): boolean {
	if (heartbeatTimer) return true; // already running
	if (!heartbeatClient) {
		// Client not initialized is expected when in paper mode or before wallet connection
		log.debug("Cannot start heartbeat: client not initialized");
		return false;
	}
	heartbeatFailures = 0;
	reconnectAttempts = 0;
	heartbeatReconnecting = false;
	heartbeatTimer = setInterval(async () => {
		if (!heartbeatClient) {
			stopHeartbeat();
			return;
		}
		// Only send heartbeat if we have open GTD orders
		if (openGtdOrders.size === 0) {
			return;
		}
		try {
			const resp = await heartbeatClient.postHeartbeat(heartbeatId ?? undefined);
			heartbeatId = resp.heartbeat_id;
			heartbeatFailures = 0;
			reconnectAttempts = 0; // Reset reconnect attempts on success
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			heartbeatFailures++;
			if (heartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
				log.error(`Heartbeat failed ${heartbeatFailures} consecutive times, stopping live trading:`, msg);
				stopHeartbeat();

				// Attempt reconnection with exponential backoff
				if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
					heartbeatReconnecting = true;
					const backoffMs = Math.min(30_000, 5_000 * 2 ** reconnectAttempts);
					reconnectAttempts++;
					log.info(
						`Attempting heartbeat reconnection ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${backoffMs}ms`,
					);
					// Keep liveRunning flag true during reconnection so the
					// reconnect callback can actually proceed.
					reconnectTimer = setTimeout(async () => {
						if (heartbeatClient && isLiveRunning()) {
							log.info("Attempting to restart heartbeat...");
							const success = startHeartbeat();
							if (success) {
								log.info("Heartbeat reconnection successful");
								reconnectAttempts = 0;
							}
						}
					}, backoffMs);
				} else {
					// All reconnect attempts exhausted — NOW stop live trading
					heartbeatReconnecting = false;
					setLiveRunning(false);
					log.error("Max heartbeat reconnection attempts reached, stopping live trading");
				}
			} else {
				log.warn(`Heartbeat failed (${heartbeatFailures}/${MAX_HEARTBEAT_FAILURES}):`, msg);
			}
		}
	}, 5_000);
	log.info("Heartbeat started");
	return true;
}

export function stopHeartbeat(): void {
	const wasRunning = heartbeatTimer !== null;
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	heartbeatId = null;
	heartbeatFailures = 0;
	reconnectAttempts = 0;
	openGtdOrders.clear(); // Clear open order tracking
	heartbeatReconnecting = false;
	if (wasRunning) log.info("Heartbeat stopped");
}

/** Register a GTD order for heartbeat tracking (FOK orders should not be tracked) */
export function registerOpenGtdOrder(orderId: string): void {
	openGtdOrders.add(orderId);
	log.debug(`Registered GTD order ${orderId.slice(0, 12)}... (total open: ${openGtdOrders.size})`);
}

/** Unregister a GTD order (e.g., when filled, cancelled, or expired) */
export function unregisterOpenGtdOrder(orderId: string): void {
	const deleted = openGtdOrders.delete(orderId);
	if (deleted) {
		log.debug(`Unregistered GTD order ${orderId.slice(0, 12)}... (total open: ${openGtdOrders.size})`);
	}
}

/** Get count of currently open GTD orders */
export function getOpenGtdOrderCount(): number {
	return openGtdOrders.size;
}

/** Check if heartbeat is in reconnection — live trades should be blocked */
export function isHeartbeatReconnecting(): boolean {
	return heartbeatReconnecting;
}

/**
 * Cancel all open orders via CLOB API at window boundary.
 * Prevents stale GTD orders from filling after the window ends.
 * Returns true if cancellation succeeded or no orders to cancel.
 */
export async function cancelAllOpenOrders(): Promise<boolean> {
	if (!heartbeatClient) return true;
	if (openGtdOrders.size === 0) return true;

	try {
		log.info(`Cancelling ${openGtdOrders.size} open GTD order(s) at window boundary`);
		await heartbeatClient.cancelAll();
		openGtdOrders.clear();
		log.info("All open orders cancelled successfully");
		return true;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Failed to cancel open orders at window boundary:", msg);
		return false;
	}
}
