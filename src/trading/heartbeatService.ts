import { CONFIG } from "../core/config.ts";
import { createLogger } from "../core/logger.ts";
import { emitTradeExecuted, isLiveRunning, setLiveRunning } from "../core/state.ts";
import { getAccount } from "./accountStats.ts";
import { MAX_HEARTBEAT_FAILURES, MAX_RECONNECT_ATTEMPTS, traderState, withTradeLock } from "./traderState.ts";
import { getClient, getWallet } from "./walletService.ts";

const log = createLogger("heartbeat-service");

export function startHeartbeat(): boolean {
	return startHeartbeatWithOptions();
}

function startHeartbeatWithOptions(options?: { preserveReconnectAttempts?: boolean }): boolean {
	const preserveReconnectAttempts = options?.preserveReconnectAttempts ?? false;

	if (traderState.heartbeatTimer) return true;
	if (!traderState.client) {
		log.warn("Cannot start heartbeat: client not initialized");
		return false;
	}

	traderState.heartbeatFailures = 0;
	if (!preserveReconnectAttempts) {
		traderState.reconnectAttempts = 0;
	}
	traderState.heartbeatReconnecting = false;
	traderState.heartbeatTimer = setInterval(async () => {
		if (!traderState.client) {
			stopHeartbeat({ clearOpenOrders: !isLiveRunning() });
			return;
		}
		if (traderState.openGtdOrders.size === 0) {
			return;
		}

		try {
			const resp = (await Promise.race([
				traderState.client.postHeartbeat(traderState.heartbeatId ?? undefined),
				new Promise<never>((_, reject) => {
					setTimeout(() => reject(new Error("heartbeat_timeout")), 8_000);
				}),
			])) as { heartbeat_id: string };
			traderState.heartbeatId = resp.heartbeat_id;
			traderState.heartbeatFailures = 0;
			traderState.reconnectAttempts = 0;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			traderState.heartbeatFailures++;
			if (traderState.heartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
				log.error(`Heartbeat failed ${traderState.heartbeatFailures} consecutive times, stopping live trading:`, msg);
				stopHeartbeat({ clearOpenOrders: false });

				if (traderState.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
					traderState.heartbeatReconnecting = true;
					const backoffMs = Math.min(30_000, 5_000 * 2 ** traderState.reconnectAttempts);
					traderState.reconnectAttempts++;
					log.info(
						`Attempting heartbeat reconnection ${traderState.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${backoffMs}ms`,
					);
					traderState.reconnectTimer = setTimeout(async () => {
						if (traderState.client && isLiveRunning()) {
							log.info("Attempting to restart heartbeat...");
							const success = startHeartbeatWithOptions({ preserveReconnectAttempts: true });
							if (success) {
								log.info("Heartbeat reconnection successful");
								traderState.reconnectAttempts = 0;
							}
						}
					}, backoffMs);
				} else {
					traderState.heartbeatReconnecting = false;
					setLiveRunning(false);
					log.error("Max heartbeat reconnection attempts reached, stopping live trading");
				}
			} else {
				log.warn(`Heartbeat failed (${traderState.heartbeatFailures}/${MAX_HEARTBEAT_FAILURES}):`, msg);
			}
		}
	}, 5_000);
	log.info("Heartbeat started");
	return true;
}

export function stopHeartbeat(options?: { clearOpenOrders?: boolean }): void {
	const wasRunning = traderState.heartbeatTimer !== null;
	const clearOpenOrders = options?.clearOpenOrders ?? true;
	if (traderState.heartbeatTimer) {
		clearInterval(traderState.heartbeatTimer);
		traderState.heartbeatTimer = null;
	}
	if (traderState.reconnectTimer) {
		clearTimeout(traderState.reconnectTimer);
		traderState.reconnectTimer = null;
	}
	traderState.heartbeatId = null;
	traderState.heartbeatFailures = 0;
	traderState.reconnectAttempts = 0;
	if (clearOpenOrders) {
		traderState.openGtdOrders.clear();
	}
	traderState.heartbeatReconnecting = false;
	if (wasRunning) log.info("Heartbeat stopped");
}

export function registerOpenGtdOrder(orderId: string): void {
	traderState.openGtdOrders.add(orderId);
	log.debug(`Registered GTD order ${orderId.slice(0, 12)}... (total open: ${traderState.openGtdOrders.size})`);
}

export function unregisterOpenGtdOrder(orderId: string): void {
	const deleted = traderState.openGtdOrders.delete(orderId);
	if (deleted) {
		log.debug(`Unregistered GTD order ${orderId.slice(0, 12)}... (total open: ${traderState.openGtdOrders.size})`);
	}
}

export function getOpenGtdOrderCount(): number {
	return traderState.openGtdOrders.size;
}

export function isHeartbeatReconnecting(): boolean {
	return traderState.heartbeatReconnecting;
}

export function canTrade(mode: "paper" | "live"): boolean {
	if (mode === "live") {
		if (!getClient()) {
			log.error("Client not initialized");
			return false;
		}
		if (!getWallet()) {
			log.error("No wallet available");
			return false;
		}
		if (traderState.heartbeatReconnecting) {
			log.warn("Heartbeat reconnecting — blocking live trade");
			return false;
		}
	}

	const account = getAccount(mode);
	const affordCheck = account.canTradeWithStopCheck();
	if (!affordCheck.canTrade) {
		log.error(`${mode} trade blocked: ${affordCheck.reason}`);
		return false;
	}
	return true;
}

export { emitTradeExecuted, withTradeLock };
