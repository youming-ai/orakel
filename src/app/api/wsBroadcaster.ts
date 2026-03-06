import { createBunWebSocket } from "hono/bun";
import type {
	SignalNewPayload,
	StateSnapshotPayload,
	TradeExecutedPayload,
	WsMessage,
} from "../../contracts/stateTypes.ts";
import { createLogger } from "../../core/logger.ts";
import { botEvents } from "../../core/state.ts";

const wsLog = createLogger("ws");
const SNAPSHOT_THROTTLE_MS = 500;

const { upgradeWebSocket, websocket } = createBunWebSocket();
const wsClients = new Set<WebSocket>();
let lastSnapshotSent = 0;
let eventForwardingRegistered = false;

function broadcastToClients(data: string): void {
	for (const ws of wsClients) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(data);
			continue;
		}
		if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
			wsClients.delete(ws);
		}
	}
}

function pruneClosedWsClients(): void {
	for (const ws of wsClients) {
		if (ws.readyState !== WebSocket.OPEN) {
			wsClients.delete(ws);
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

	botEvents.on("balance:snapshot", (msg: unknown) => {
		broadcastToClients(JSON.stringify(msg));
	});
}

export function addWsClient(ws: WebSocket): void {
	wsClients.add(ws);
	wsLog.info("Client connected, total:", wsClients.size);
}

export function removeWsClient(ws: WebSocket): void {
	wsClients.delete(ws);
	pruneClosedWsClients();
	wsLog.info("Client disconnected, total:", wsClients.size);
}

export { upgradeWebSocket, websocket };
