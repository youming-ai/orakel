import { createBunWebSocket } from "hono/bun";
import { createLogger } from "../core/logger.ts";
import { botEvents } from "../core/state.ts";
import type { SignalNewPayload, StateSnapshotPayload, TradeExecutedPayload, WsMessage } from "../types.ts";

const { upgradeWebSocket, websocket } = createBunWebSocket();

const wsLog = createLogger("ws");
const SNAPSHOT_THROTTLE_MS = 500;

const wsClients = new Set<WebSocket>();
let lastSnapshotSent = 0;
let wsListenersSetup = false;

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

function setupWsEventListeners(): void {
	if (wsListenersSetup) {
		return;
	}
	wsListenersSetup = true;
	wsLog.info("WS event listeners initialized");

	botEvents.on("state:snapshot", (msg: WsMessage<StateSnapshotPayload>) => {
		const now = Date.now();
		if (now - lastSnapshotSent < SNAPSHOT_THROTTLE_MS) return;
		lastSnapshotSent = now;
		pruneClosedWsClients();
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

export { broadcastToClients, setupWsEventListeners, upgradeWebSocket, websocket, wsClients };
