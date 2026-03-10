import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { StateSnapshotPayload, WsMessage } from "../../contracts/stateTypes.ts";
import { env } from "../../core/env.ts";
import { createLogger } from "../../core/logger.ts";
import { corsMiddleware, rateLimit, requireAuth } from "./middleware.ts";
import { apiRoutes } from "./routes.ts";
import { buildStateSnapshotPayload } from "./statePayload.ts";
import {
	addWsClient,
	handleWsAuthMessage,
	registerWsEventForwarding,
	removeWsClient,
	upgradeWebSocket,
	websocket,
} from "./wsBroadcaster.ts";

const PORT = env.API_PORT;
const log = createLogger("api");

const app = new Hono();

app.use("/api/*", corsMiddleware);
app.use("/*", corsMiddleware);
app.use("/api/*", rateLimit);
app.use("/api/paper/*", requireAuth);
app.use("/api/live/*", requireAuth);
app.use("/api/config", requireAuth);
app.route("/api", apiRoutes);
app.get(
	"/ws",
	upgradeWebSocket((c) => {
		const header = c.req.header("authorization");
		const queryToken = new URL(c.req.url).searchParams.get("token");
		const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
		const preAuthenticated = !env.API_TOKEN || (!!token && token === env.API_TOKEN);

		return {
			onOpen(_event, ws) {
				addWsClient(ws.raw as WebSocket, preAuthenticated);
				if (preAuthenticated) {
					const initialMessage: WsMessage<StateSnapshotPayload> = {
						type: "state:snapshot",
						data: buildStateSnapshotPayload(),
						ts: Date.now(),
						version: 0,
					};
					ws.send(JSON.stringify(initialMessage));
				}
			},
			onMessage(event, ws) {
				const raw = ws.raw as WebSocket;
				if (typeof event.data === "string" && handleWsAuthMessage(raw, event.data)) {
					const initialMessage: WsMessage<StateSnapshotPayload> = {
						type: "state:snapshot",
						data: buildStateSnapshotPayload(),
						ts: Date.now(),
						version: 0,
					};
					ws.send(JSON.stringify(initialMessage));
				}
			},
			onClose(_event, ws) {
				removeWsClient(ws.raw as WebSocket);
			},
			onError(_event, ws) {
				removeWsClient(ws.raw as WebSocket);
			},
		};
	}),
);

app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));

export function startApiServer(): void {
	registerWsEventForwarding();
	log.info(`Starting dashboard server on port ${PORT}...`);
	Bun.serve({
		port: PORT,
		fetch: app.fetch,
		websocket,
	});
	log.info(`Dashboard server running on http://0.0.0.0:${PORT}`);
	log.info(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
}
