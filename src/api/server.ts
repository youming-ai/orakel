import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { env } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import { getMarkets, getUpdatedAt, isLiveRunning, isPaperRunning } from "../core/state.ts";
import { getPaperStats } from "../trading/paperStats.ts";
import { getLiveStats, getLiveTodayStats } from "../trading/trader.ts";
import type { StateSnapshotPayload, WsMessage } from "../types.ts";
import { getApiConfigSnapshot } from "./configSnapshot.ts";
import { rateLimit, requireAuth } from "./middleware.ts";
import { apiRoutes } from "./routes.ts";
import { setupWsEventListeners, upgradeWebSocket, websocket, wsClients } from "./ws.ts";

const PORT = env.API_PORT;

const log = createLogger("api");
const app = new Hono();

app.use("/api/*", rateLimit);
app.use("/api/*", cors());
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
			wsClients.add(ws.raw as WebSocket);
			log.info("WS client connected, total:", wsClients.size);

			// Fetch live stats from chain (async) before sending snapshot
			getLiveStats()
				.then((liveStats) => {
					const configSnapshot = getApiConfigSnapshot();
					const snapshot: StateSnapshotPayload = {
						markets: getMarkets(),
						updatedAt: getUpdatedAt(),
						paperRunning: isPaperRunning(),
						liveRunning: isLiveRunning(),
						paperStats: getPaperStats(),
						liveStats,
						liveTodayStats: getLiveTodayStats(configSnapshot.liveDailyLossLimitUsdc),
					};

					const initialMessage: WsMessage<StateSnapshotPayload> = {
						type: "state:snapshot",
						data: snapshot,
						ts: Date.now(),
						version: 0,
					};

					ws.send(JSON.stringify(initialMessage));
				})
				.catch((err) => {
					log.error("Failed to fetch live stats for WS snapshot:", err);
					const configSnapshot = getApiConfigSnapshot();
					// Send fallback snapshot with empty liveStats so client is not left blank
					const fallbackSnapshot: StateSnapshotPayload = {
						markets: getMarkets(),
						updatedAt: getUpdatedAt(),
						paperRunning: isPaperRunning(),
						liveRunning: isLiveRunning(),
						paperStats: getPaperStats(),
						liveStats: { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, totalPnl: 0 },
						liveTodayStats: getLiveTodayStats(configSnapshot.liveDailyLossLimitUsdc),
					};
					const fallbackMsg: WsMessage<StateSnapshotPayload> = {
						type: "state:snapshot",
						data: fallbackSnapshot,
						ts: Date.now(),
						version: 0,
					};
					ws.send(JSON.stringify(fallbackMsg));
				});
		},
		onClose(_event, ws) {
			wsClients.delete(ws.raw as WebSocket);
			log.info("WS client disconnected, total:", wsClients.size);
		},
		onError(_event, ws) {
			wsClients.delete(ws.raw as WebSocket);
		},
	})),
);

// SPA static file serving (production only — dev uses Vite proxy)
app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));

export function startApiServer(): void {
	setupWsEventListeners();
	log.info(`Starting dashboard server on port ${PORT}...`);
	Bun.serve({
		port: PORT,
		fetch: app.fetch,
		websocket,
	});
	log.info(`Dashboard server running on http://0.0.0.0:${PORT}`);
	log.info(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
}

export type { AppType } from "./routes.ts";
