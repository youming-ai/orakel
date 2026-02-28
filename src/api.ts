import fs from "node:fs";
import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { getAccountSummary, getAllPositions } from "./accountState.ts";
import { atomicWriteConfig, CONFIG, reloadConfig } from "./config.ts";
import { getDbDiagnostics, statements } from "./db.ts";
import { env } from "./env.ts";
import { createLogger } from "./logger.ts";
import {
	clearStopFlag,
	getMarketBreakdown,
	getPaperBalance,
	getPaperStats,
	getRecentPaperTrades,
	getStopReason,
	getTodayStats,
	isStopped,
} from "./paperStats.ts";
import { getReconStatus } from "./reconciler.ts";
import {
	botEvents,
	getMarkets,
	getUpdatedAt,
	isLiveRunning,
	isPaperRunning,
	setLiveRunning,
	setPaperRunning,
} from "./state.ts";
import {
	connectWallet,
	disconnectWallet,
	getClientStatus,
	getLiveDailyState,
	getLiveStats,
	getLiveTodayStats,
	getPaperDailyState,
	getWalletAddress,
} from "./trader.ts";
import type { SignalNewPayload, StateSnapshotPayload, TradeExecutedPayload, WsMessage } from "./types.ts";

const PORT = env.API_PORT;

const log = createLogger("api");
const wsLog = createLogger("ws");
const SNAPSHOT_THROTTLE_MS = 500;

interface TradeRowSqlite {
	timestamp: string;
	market: string;
	side: string;
	amount: number;
	price: number;
	order_id: string | null;
	status: string | null;
	mode: string;
	pnl: number | null;
	won: number | null;
}

interface SignalRowSqlite {
	timestamp: string;
	market: string;
	entry_minute: string | number | null;
	time_left_min: string | number | null;
	regime: string | null;
	signal: string | null;
	vol_implied_up: number | null;
	ta_raw_up: number | null;
	blended_up: number | null;
	blend_source: string | null;
	volatility_15m: number | null;
	price_to_beat: number | null;
	binance_chainlink_delta: number | null;
	orderbook_imbalance: number | null;
	model_up: number | null;
	model_down: number | null;
	mkt_up: number | null;
	mkt_down: number | null;
	raw_sum: number | null;
	arbitrage: number | null;
	edge_up: number | null;
	edge_down: number | null;
	recommendation: string | null;
}

const { upgradeWebSocket, websocket } = createBunWebSocket();
const wsClients = new Set<WebSocket>();
let lastSnapshotSent = 0;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert nullable value to string, defaulting to "" */
function str(v: string | number | null | undefined): string {
	return v === null || v === undefined ? "" : String(v);
}

// ---------------------------------------------------------------------------
// API routes — chained for Hono RPC type inference
// ---------------------------------------------------------------------------

const apiRoutes = new Hono()

	.get("/health", (c) => {
		return c.json({
			ok: true as const,
			timestamp: Date.now(),
			uptime: Math.floor(process.uptime()),
			memory: {
				rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
				heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
			},
		});
	})

	.get("/db/diagnostics", (c) => {
		return c.json({
			ok: true as const,
			diagnostics: getDbDiagnostics(),
		});
	})

	.get("/state", async (c) => {
		const status = getClientStatus();
		const todayStats = getTodayStats();
		const stopLoss = getStopReason();
		const liveStats = await getLiveStats();

		return c.json({
			markets: getMarkets(),
			updatedAt: getUpdatedAt(),
			wallet: { address: getWalletAddress(), connected: status.clientReady },
			paperDaily: getPaperDailyState(),
			liveDaily: getLiveDailyState(),
			config: {
				strategy: CONFIG.strategy,
				paperRisk: CONFIG.paperRisk,
				liveRisk: CONFIG.liveRisk,
			},
			paperRunning: isPaperRunning(),
			liveRunning: isLiveRunning(),
			paperStats: getPaperStats(),
			liveStats,
			paperBalance: getPaperBalance(),
			liveWallet: {
				address: status.walletAddress ?? null,
				connected: status.walletLoaded,
				clientReady: status.clientReady,
			},
			stopLoss: isStopped() ? stopLoss : null,
			todayStats: todayStats,
			liveTodayStats: getLiveTodayStats(),
		});
	})

	.get("/trades", (c) => {
		const mode = c.req.query("mode");

		const rows = (
			mode === "paper" || mode === "live"
				? statements.getRecentTrades().all({ $mode: mode, $limit: 100 })
				: statements.getAllRecentTrades().all({ $limit: 100 })
		) as TradeRowSqlite[];

		return c.json(
			rows.map((row) => ({
				timestamp: row.timestamp ?? "",
				market: row.market ?? "",
				side: row.side ?? "",
				amount: String(row.amount ?? ""),
				price: String(row.price ?? ""),
				orderId: row.order_id ?? "",
				status: row.status ?? "",
				mode: row.mode ?? "",
				pnl: row.pnl ?? null,
				won: row.won ?? null,
			})),
		);
	})

	.get("/signals", (c) => {
		const rows = statements.getRecentSignals().all({
			$limit: 200,
		}) as SignalRowSqlite[];

		return c.json(
			rows.map((row) => ({
				timestamp: row.timestamp ?? "",
				entry_minute: str(row.entry_minute),
				time_left_min: str(row.time_left_min),
				regime: row.regime ?? "",
				signal: row.signal ?? "",
				vol_implied_up: str(row.vol_implied_up),
				ta_raw_up: str(row.ta_raw_up),
				blended_up: str(row.blended_up),
				blend_source: row.blend_source ?? "",
				volatility_15m: str(row.volatility_15m),
				price_to_beat: str(row.price_to_beat),
				binance_chainlink_delta: str(row.binance_chainlink_delta),
				orderbook_imbalance: str(row.orderbook_imbalance),
				model_up: str(row.model_up),
				model_down: str(row.model_down),
				mkt_up: str(row.mkt_up),
				mkt_down: str(row.mkt_down),
				raw_sum: str(row.raw_sum),
				arbitrage: str(row.arbitrage),
				edge_up: str(row.edge_up),
				edge_down: str(row.edge_down),
				recommendation: row.recommendation ?? "",
				market: row.market ?? "",
			})),
		);
	})

	.get("/paper-stats", (c) => {
		return c.json({
			stats: getPaperStats(),
			trades: getRecentPaperTrades(),
			byMarket: getMarketBreakdown(),
			balance: getPaperBalance(),
			stopLoss: getStopReason(),
			todayStats: getTodayStats(),
		});
	})

	.put("/config", async (c) => {
		try {
			const body = await c.req.json();

			const currentConfig = JSON.parse(fs.readFileSync("./config.json", "utf8"));

			const updated: Record<string, unknown> = {};

			if (body.strategy && typeof body.strategy === "object") {
				updated.strategy = { ...currentConfig.strategy, ...body.strategy };
			} else {
				updated.strategy = currentConfig.strategy;
			}

			const currentPaper = currentConfig.paper && typeof currentConfig.paper === "object" ? currentConfig.paper : {};
			const currentPaperRisk = currentPaper.risk && typeof currentPaper.risk === "object" ? currentPaper.risk : {};
			if (body.paperRisk && typeof body.paperRisk === "object") {
				updated.paper = {
					...currentPaper,
					risk: { ...currentPaperRisk, ...body.paperRisk },
				};
			} else {
				updated.paper = currentPaper;
			}

			const currentLive = currentConfig.live && typeof currentConfig.live === "object" ? currentConfig.live : {};
			const currentLiveRisk = currentLive.risk && typeof currentLive.risk === "object" ? currentLive.risk : {};
			if (body.liveRisk && typeof body.liveRisk === "object") {
				updated.live = {
					...currentLive,
					risk: { ...currentLiveRisk, ...body.liveRisk },
				};
			} else {
				updated.live = currentLive;
			}

			await atomicWriteConfig("./config.json", updated);

			reloadConfig();

			return c.json({
				ok: true as const,
				config: {
					strategy: CONFIG.strategy,
					paperRisk: CONFIG.paperRisk,
					liveRisk: CONFIG.liveRisk,
				},
			});
		} catch (error) {
			return c.json(
				{
					ok: false as const,
					error: error instanceof Error ? error.message : "Failed to update config",
				},
				400,
			);
		}
	})

	.post("/paper/start", (c) => {
		setPaperRunning(true);
		return c.json({ ok: true as const, paperRunning: true });
	})

	.post("/paper/stop", (c) => {
		setPaperRunning(false);
		return c.json({ ok: true as const, paperRunning: false });
	})

	.post("/paper/clear-stop", (c) => {
		log.info(`POST /paper/clear-stop — manually clearing stop loss flag`);
		clearStopFlag();
		return c.json({
			ok: true as const,
			message: "Stop loss flag cleared",
		});
	})

	.post("/live/connect", async (c) => {
		if (!env.API_TOKEN) {
			log.warn(
				"WARNING: /live/connect called without API_TOKEN configured. Set API_TOKEN env var to protect this endpoint.",
			);
		}
		try {
			const body = await c.req.json();
			const privateKey = typeof body.privateKey === "string" ? body.privateKey : "";
			const result = await connectWallet(privateKey);
			return c.json({ ok: true as const, address: result.address });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			return c.json({ ok: false as const, error: msg }, 400);
		}
	})

	.post("/live/disconnect", (c) => {
		setLiveRunning(false);
		disconnectWallet();
		return c.json({ ok: true as const, liveRunning: false });
	})

	.post("/live/start", (c) => {
		const status = getClientStatus();
		if (!status.walletLoaded || !status.clientReady) {
			return c.json(
				{
					ok: false as const,
					error: "Wallet not connected. Use POST /api/live/connect first.",
				},
				400,
			);
		}
		setLiveRunning(true);
		return c.json({ ok: true as const, liveRunning: true });
	})

	.post("/live/stop", (c) => {
		setLiveRunning(false);
		return c.json({ ok: true as const, liveRunning: false });
	})

	.get("/live/balance", (c) => {
		const summary = getAccountSummary();
		if (!summary.walletAddress) {
			return c.json({ ok: false as const, error: "Account state not initialized" }, 503);
		}
		return c.json({ ok: true as const, data: summary });
	})

	.get("/live/positions", (c) => {
		return c.json({ ok: true as const, data: getAllPositions() });
	})

	.get("/live/recon-status", (c) => {
		return c.json({ ok: true as const, data: getReconStatus() });
	});

// ---------------------------------------------------------------------------
// Export route type for hono/client RPC
// ---------------------------------------------------------------------------

export type AppType = typeof apiRoutes;

// ---------------------------------------------------------------------------
// Main app: CORS middleware + API routes + static file serving
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth middleware — protects mutation endpoints when API_TOKEN is set
// ---------------------------------------------------------------------------

const requireAuth = createMiddleware(async (c, next) => {
	if (!env.API_TOKEN) return next();

	const header = c.req.header("authorization");
	if (!header?.startsWith("Bearer ")) {
		return c.json({ ok: false, error: "Unauthorized: Bearer token required" }, 401);
	}
	if (header.slice(7) !== env.API_TOKEN) {
		return c.json({ ok: false, error: "Unauthorized: invalid token" }, 401);
	}
	return next();
});

const rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT = 600; // Increased from 180 to 600 (10 requests/second)
const RATE_WINDOW_MS = 60_000;

const rateLimit = createMiddleware(async (c, next) => {
	// Use real socket IP, but trust x-forwarded-for when request comes from local/Docker network
	const socketIp =
		(c.env as { requestIP?: (req: Request) => { address: string } | null })?.requestIP?.(c.req.raw)?.address ?? "";
	const isLocalSocket =
		!socketIp ||
		socketIp === "127.0.0.1" ||
		socketIp === "::1" ||
		socketIp === "::ffff:127.0.0.1" ||
		socketIp.startsWith("172.") ||
		socketIp.startsWith("10.");
	const key = isLocalSocket
		? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || socketIp || "local"
		: socketIp;
	const now = Date.now();
	let bucket = rateBuckets.get(key);
	if (!bucket || now - bucket.lastRefill >= RATE_WINDOW_MS) {
		bucket = { tokens: RATE_LIMIT, lastRefill: now };
	}
	if (bucket.tokens <= 0) {
		return c.json({ ok: false, error: "Rate limit exceeded" }, 429);
	}
	bucket.tokens--;
	rateBuckets.set(key, bucket);
	return next();
});

setInterval(() => {
	const cutoff = Date.now() - RATE_WINDOW_MS * 2;
	for (const [k, v] of rateBuckets) {
		if (v.lastRefill < cutoff) rateBuckets.delete(k);
	}
}, RATE_WINDOW_MS);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

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
			wsLog.info("Client connected, total:", wsClients.size);

			// Fetch live stats from chain (async) before sending snapshot
			getLiveStats()
				.then((liveStats) => {
					const snapshot: StateSnapshotPayload = {
						markets: getMarkets(),
						updatedAt: getUpdatedAt(),
						paperRunning: isPaperRunning(),
						liveRunning: isLiveRunning(),
						paperStats: getPaperStats(),
						liveStats,
						liveTodayStats: getLiveTodayStats(),
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
					wsLog.error("Failed to fetch live stats for WS snapshot:", err);
					// Send fallback snapshot with empty liveStats so client is not left blank
					const fallbackSnapshot: StateSnapshotPayload = {
						markets: getMarkets(),
						updatedAt: getUpdatedAt(),
						paperRunning: isPaperRunning(),
						liveRunning: isLiveRunning(),
						paperStats: getPaperStats(),
						liveStats: { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, totalPnl: 0 },
						liveTodayStats: getLiveTodayStats(),
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
			pruneClosedWsClients();
			wsLog.info("Client disconnected, total:", wsClients.size);
		},
		onError(_event, ws) {
			wsClients.delete(ws.raw as WebSocket);
			pruneClosedWsClients();
		},
	})),
);

// SPA static file serving (production only — dev uses Vite proxy)
app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));

export function startApiServer(): void {
	log.info(`Starting dashboard server on port ${PORT}...`);
	Bun.serve({
		port: PORT,
		fetch: app.fetch,
		websocket,
	});
	log.info(`Dashboard server running on http://0.0.0.0:${PORT}`);
	log.info(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
}
