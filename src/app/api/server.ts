import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { env } from "../../core/env.ts";
import { createLogger } from "../../core/logger.ts";
import {
	getMarkets,
	getUpdatedAt,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
} from "../../core/state.ts";
import { liveAccount, paperAccount } from "../../trading/accountStats.ts";
import type { StateSnapshotPayload, WsMessage } from "../../types.ts";
import { corsMiddleware, rateLimit, requireAuth } from "./middleware.ts";
import { apiRoutes } from "./routes.ts";
import {
	addWsClient,
	registerWsEventForwarding,
	removeWsClient,
	upgradeWebSocket,
	websocket,
} from "./wsBroadcaster.ts";

const PORT = env.API_PORT;
const log = createLogger("api");

function buildInitialSnapshot(): StateSnapshotPayload {
	return {
		markets: getMarkets(),
		updatedAt: getUpdatedAt(),
		paperRunning: isPaperRunning(),
		liveRunning: isLiveRunning(),
		paperPendingStart: isPaperPendingStart(),
		paperPendingStop: isPaperPendingStop(),
		livePendingStart: isLivePendingStart(),
		livePendingStop: isLivePendingStop(),
		paperStats: paperAccount.getStats(),
		liveStats: liveAccount.getStats(),
		liveTodayStats: liveAccount.getTodayStats(),
		paperBalance: paperAccount.getBalance(),
		liveBalance: liveAccount.getBalance(),
		todayStats: paperAccount.getTodayStats(),
		stopLoss: paperAccount.isStopped() ? paperAccount.getStopReason() : null,
		liveStopLoss: liveAccount.isStopped() ? liveAccount.getStopReason() : null,
	};
}

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
	(c, next) => {
		if (!env.API_TOKEN) return next();
		const header = c.req.header("authorization");
		const queryToken = new URL(c.req.url).searchParams.get("token");
		const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
		if (!token || token !== env.API_TOKEN) {
			return c.json({ ok: false, error: "Unauthorized" }, 401);
		}
		return next();
	},
	upgradeWebSocket(() => ({
		onOpen(_event, ws) {
			addWsClient(ws.raw as WebSocket);
			const initialMessage: WsMessage<StateSnapshotPayload> = {
				type: "state:snapshot",
				data: buildInitialSnapshot(),
				ts: Date.now(),
				version: 0,
			};
			ws.send(JSON.stringify(initialMessage));
		},
		onClose(_event, ws) {
			removeWsClient(ws.raw as WebSocket);
		},
		onError(_event, ws) {
			removeWsClient(ws.raw as WebSocket);
		},
	})),
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
