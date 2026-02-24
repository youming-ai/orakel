import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { CONFIG, reloadConfig } from "./config.ts";
import { READ_BACKEND, statements } from "./db.ts";
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
import {
	botEvents,
	clearLivePending,
	clearPaperPending,
	getLivePendingSince,
	getMarkets,
	getPaperPendingSince,
	getUpdatedAt,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
	setLivePendingStart,
	setLivePendingStop,
	setLiveRunning,
	setPaperPendingStart,
	setPaperPendingStop,
} from "./state.ts";
import {
	connectWallet,
	disconnectWallet,
	getClientStatus,
	getLiveDailyState,
	getPaperDailyState,
	getWalletAddress,
} from "./trader.ts";
import type { SignalNewPayload, StateSnapshotPayload, TradeExecutedPayload, WsMessage } from "./types.ts";

const PORT = env.API_PORT;

const log = createLogger("api");
const wsLog = createLogger("ws");
const LOGS_DIR = path.resolve("data");
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

// ---------------------------------------------------------------------------
// CSV helpers (unchanged)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === "," && !inQuotes) {
			result.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	result.push(current.trim());
	return result;
}

function parseCsv(filePath: string, limit = 200): Record<string, string>[] {
	const header = ["timestamp", "market", "side", "amount", "price", "orderId", "status", "mode"];
	try {
		const raw = fs.readFileSync(filePath, "utf8").trim();
		if (!raw) return [];
		const lines = raw.split("\n");
		const dataLines = lines[0]?.startsWith("timestamp") ? lines.slice(1) : lines;
		return dataLines
			.slice(-limit)
			.map((line) => {
				const vals = parseCsvLine(line);
				if (vals.length < 6) return null;
				const row: Record<string, string> = {};
				for (let i = 0; i < header.length; i++) {
					const key = header[i];
					if (key) row[key] = vals[i]?.trim() ?? "";
				}
				return row;
			})
			.filter((row): row is Record<string, string> => row !== null);
	} catch {
		return [];
	}
}

function parseSignalCsv(filePath: string, limit = 200): Record<string, string>[] {
	const signalHeader = [
		"timestamp",
		"entry_minute",
		"time_left_min",
		"regime",
		"signal",
		"vol_implied_up",
		"ta_raw_up",
		"blended_up",
		"blend_source",
		"volatility_15m",
		"price_to_beat",
		"binance_chainlink_delta",
		"orderbook_imbalance",
		"model_up",
		"model_down",
		"mkt_up",
		"mkt_down",
		"raw_sum",
		"arbitrage",
		"edge_up",
		"edge_down",
		"recommendation",
	];

	try {
		const raw = fs.readFileSync(filePath, "utf8").trim();
		if (!raw) return [];
		const lines = raw.split("\n");

		let startIdx = 0;
		if (lines.length > 0 && lines[0]?.startsWith("timestamp,entry_minute")) {
			startIdx = 1;
		}

		return lines
			.slice(startIdx)
			.slice(-limit)
			.map((line) => {
				const vals = parseCsvLine(line);
				if (vals.length < 5) return null;
				const row: Record<string, string> = {};
				for (let i = 0; i < signalHeader.length; i++) {
					const key = signalHeader[i];
					if (key) row[key] = vals[i]?.trim() ?? "";
				}
				return row;
			})
			.filter((row): row is Record<string, string> => row !== null);
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// API routes — chained for Hono RPC type inference
// ---------------------------------------------------------------------------

const apiRoutes = new Hono()

	.get("/health", (c) => {
		return c.json({ ok: true as const, timestamp: Date.now() });
	})

	.get("/state", (c) => {
		const status = getClientStatus();
		const todayStats = getTodayStats();
		const stopLoss = getStopReason();

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
			paperBalance: getPaperBalance(),
			liveWallet: {
				address: status.walletAddress ?? null,
				connected: status.walletLoaded,
				clientReady: status.clientReady,
			},
			paperPendingStart: isPaperPendingStart(),
			paperPendingStop: isPaperPendingStop(),
			livePendingStart: isLivePendingStart(),
			livePendingStop: isLivePendingStop(),
			paperPendingSince: getPaperPendingSince(),
			livePendingSince: getLivePendingSince(),
			stopLoss: isStopped() ? stopLoss : null,
			todayStats: todayStats,
		});
	})

	.get("/trades", (c) => {
		const mode = c.req.query("mode");

		if (READ_BACKEND === "sqlite") {
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
				})),
			);
		}

		const markets = ["BTC", "ETH", "SOL", "XRP"];
		const all: Record<string, string>[] = [];
		const modes = mode === "paper" || mode === "live" ? [mode] : ["paper", "live"];
		for (const m of markets) {
			for (const md of modes) {
				const rows = parseCsv(path.join(LOGS_DIR, md, `trades-${m}.csv`), 50);
				for (const row of rows) {
					row.market = m;
					if (!row.mode) row.mode = md;
					all.push(row);
				}
			}
		}
		all.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
		return c.json(all.slice(0, 100));
	})

	.get("/signals", (c) => {
		if (READ_BACKEND === "sqlite") {
			const rows = statements.getRecentSignals().all({
				$limit: 200,
			}) as SignalRowSqlite[];

			return c.json(
				rows.map((row) => ({
					timestamp: row.timestamp ?? "",
					entry_minute: row.entry_minute === null || row.entry_minute === undefined ? "" : String(row.entry_minute),
					time_left_min: row.time_left_min === null || row.time_left_min === undefined ? "" : String(row.time_left_min),
					regime: row.regime ?? "",
					signal: row.signal ?? "",
					vol_implied_up:
						row.vol_implied_up === null || row.vol_implied_up === undefined ? "" : String(row.vol_implied_up),
					ta_raw_up: row.ta_raw_up === null || row.ta_raw_up === undefined ? "" : String(row.ta_raw_up),
					blended_up: row.blended_up === null || row.blended_up === undefined ? "" : String(row.blended_up),
					blend_source: row.blend_source ?? "",
					volatility_15m:
						row.volatility_15m === null || row.volatility_15m === undefined ? "" : String(row.volatility_15m),
					price_to_beat: row.price_to_beat === null || row.price_to_beat === undefined ? "" : String(row.price_to_beat),
					binance_chainlink_delta:
						row.binance_chainlink_delta === null || row.binance_chainlink_delta === undefined
							? ""
							: String(row.binance_chainlink_delta),
					orderbook_imbalance:
						row.orderbook_imbalance === null || row.orderbook_imbalance === undefined
							? ""
							: String(row.orderbook_imbalance),
					model_up: row.model_up === null || row.model_up === undefined ? "" : String(row.model_up),
					model_down: row.model_down === null || row.model_down === undefined ? "" : String(row.model_down),
					mkt_up: row.mkt_up === null || row.mkt_up === undefined ? "" : String(row.mkt_up),
					mkt_down: row.mkt_down === null || row.mkt_down === undefined ? "" : String(row.mkt_down),
					raw_sum: row.raw_sum === null || row.raw_sum === undefined ? "" : String(row.raw_sum),
					arbitrage: row.arbitrage === null || row.arbitrage === undefined ? "" : String(row.arbitrage),
					edge_up: row.edge_up === null || row.edge_up === undefined ? "" : String(row.edge_up),
					edge_down: row.edge_down === null || row.edge_down === undefined ? "" : String(row.edge_down),
					recommendation: row.recommendation ?? "",
					market: row.market ?? "",
				})),
			);
		}

		const markets = ["BTC", "ETH", "SOL", "XRP"];
		const all: Record<string, string>[] = [];
		for (const m of markets) {
			const rows = parseSignalCsv(path.join(LOGS_DIR, `signals-${m}.csv`), 50);
			for (const row of rows) {
				row.market = m;
				all.push(row);
			}
		}
		all.sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
		return c.json(all.slice(0, 200));
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

			fs.writeFileSync("./config.json", JSON.stringify(updated, null, 2));

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
		setPaperPendingStart(true);
		return c.json({
			ok: true as const,
			paperPendingStart: true,
			message: "Starting at next cycle",
		});
	})

	.post("/paper/stop", (c) => {
		setPaperPendingStop(true);
		return c.json({
			ok: true as const,
			paperPendingStop: true,
			message: "Stopping after current cycle settlement",
		});
	})

	.post("/paper/cancel", (c) => {
		clearPaperPending();
		return c.json({
			ok: true as const,
			message: "Pending operation cancelled",
		});
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
		const remoteIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "";
		const isLocal =
			remoteIp === "" ||
			remoteIp === "127.0.0.1" ||
			remoteIp === "::1" ||
			remoteIp.startsWith("172.") ||
			remoteIp.startsWith("10.");
		if (!isLocal) {
			return c.json(
				{
					ok: false as const,
					error: "Forbidden: wallet connect only allowed from local/Docker network",
				},
				403,
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
		clearLivePending();
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
		setLivePendingStart(true);
		return c.json({
			ok: true as const,
			livePendingStart: true,
			message: "Starting at next cycle",
		});
	})

	.post("/live/stop", (c) => {
		setLivePendingStop(true);
		return c.json({
			ok: true as const,
			livePendingStop: true,
			message: "Stopping after current cycle settlement",
		});
	})

	.post("/live/cancel", (c) => {
		clearLivePending();
		return c.json({
			ok: true as const,
			message: "Pending operation cancelled",
		});
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
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const rateLimit = createMiddleware(async (c, next) => {
	const key = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "anon";
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

			const snapshot: StateSnapshotPayload = {
				markets: getMarkets(),
				updatedAt: getUpdatedAt(),
				paperRunning: isPaperRunning(),
				liveRunning: isLiveRunning(),
				paperPendingStart: isPaperPendingStart(),
				paperPendingStop: isPaperPendingStop(),
				livePendingStart: isLivePendingStart(),
				livePendingStop: isLivePendingStop(),
				paperStats: getPaperStats(),
			};

			const initialMessage: WsMessage<StateSnapshotPayload> = {
				type: "state:snapshot",
				data: snapshot,
				ts: Date.now(),
				version: 0,
			};

			ws.send(JSON.stringify(initialMessage));
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
