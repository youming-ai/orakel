import { createBunWebSocket } from "hono/bun";
import type {
	BalanceSnapshotPayload,
	SignalNewPayload,
	StateSnapshotPayload,
	TradeExecutedPayload,
	WsMessage,
} from "../../contracts/stateTypes.ts";
import { env } from "../../core/env.ts";
import { createLogger } from "../../core/logger.ts";
import { botEvents } from "../../core/state.ts";

const wsLog = createLogger("ws");
const SNAPSHOT_THROTTLE_MS = 500;
const AUTH_TIMEOUT_MS = 10_000;

const { upgradeWebSocket, websocket } = createBunWebSocket();
const authenticatedClients = new Set<WebSocket>();
const pendingAuthClients = new Map<WebSocket, ReturnType<typeof setTimeout>>();
let lastSnapshotSent = 0;
let eventForwardingRegistered = false;

function broadcastToClients(data: string): void {
	for (const ws of authenticatedClients) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(data);
			continue;
		}
		if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
			authenticatedClients.delete(ws);
		}
	}
}

function pruneClosedClients(): void {
	for (const ws of authenticatedClients) {
		if (ws.readyState !== WebSocket.OPEN) {
			authenticatedClients.delete(ws);
		}
	}
	for (const [ws, timer] of pendingAuthClients) {
		if (ws.readyState !== WebSocket.OPEN) {
			clearTimeout(timer);
			pendingAuthClients.delete(ws);
		}
	}
}

export function registerWsEventForwarding(): void {
	if (eventForwardingRegistered) return;
	eventForwardingRegistered = true;

	botEvents.on("state:snapshot", (msg: WsMessage<StateSnapshotPayload>) => {
		const now = Date.now();
		if (now - lastSnapshotSent < SNAPSHOT_THROTTLE_MS) return;
		lastSnapshotSent = now;
		broadcastToClients(JSON.stringify(msg));
	});

	botEvents.on("signal:new", (msg: WsMessage<SignalNewPayload>) => {
		broadcastToClients(JSON.stringify(msg));
	});

	botEvents.on("trade:executed", (msg: WsMessage<TradeExecutedPayload>) => {
		broadcastToClients(JSON.stringify(msg));
	});

	botEvents.on("balance:snapshot", (msg: WsMessage<BalanceSnapshotPayload>) => {
		broadcastToClients(JSON.stringify(msg));
	});
}

export function addWsClient(ws: WebSocket, preAuthenticated: boolean): void {
	if (preAuthenticated) {
		authenticatedClients.add(ws);
		wsLog.info("Client connected (pre-auth), total:", authenticatedClients.size);
	} else {
		const timer = setTimeout(() => {
			pendingAuthClients.delete(ws);
			if (ws.readyState === WebSocket.OPEN) {
				ws.close(4001, "Auth timeout");
			}
			wsLog.warn("Client auth timeout, disconnected");
		}, AUTH_TIMEOUT_MS);
		pendingAuthClients.set(ws, timer);
		wsLog.info("Client connected (pending auth), total:", authenticatedClients.size + pendingAuthClients.size);
	}
}

export function authenticateWsClient(ws: WebSocket): boolean {
	const timer = pendingAuthClients.get(ws);
	if (timer === undefined) return false;
	clearTimeout(timer);
	pendingAuthClients.delete(ws);
	authenticatedClients.add(ws);
	wsLog.info("Client authenticated, total:", authenticatedClients.size);
	return true;
}

export function handleWsAuthMessage(ws: WebSocket, data: string): boolean {
	if (!env.API_TOKEN) return false;
	try {
		const msg: unknown = JSON.parse(data);
		if (
			msg &&
			typeof msg === "object" &&
			"type" in msg &&
			(msg as Record<string, unknown>).type === "auth" &&
			"token" in msg &&
			(msg as Record<string, unknown>).token === env.API_TOKEN
		) {
			return authenticateWsClient(ws);
		}
	} catch {
		return false;
	}
	return false;
}

export function removeWsClient(ws: WebSocket): void {
	authenticatedClients.delete(ws);
	const timer = pendingAuthClients.get(ws);
	if (timer !== undefined) {
		clearTimeout(timer);
		pendingAuthClients.delete(ws);
	}
	pruneClosedClients();
	wsLog.info("Client disconnected, total:", authenticatedClients.size);
}

export { upgradeWebSocket, websocket };
