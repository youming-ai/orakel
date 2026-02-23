import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { CONFIG, reloadConfig } from "./config.ts";
import {
	getMarketBreakdown,
	getPaperBalance,
	getPaperStats,
	getRecentPaperTrades,
} from "./paperStats.ts";
import {
	getMarkets,
	getUpdatedAt,
	isLiveRunning,
	isPaperRunning,
	setLiveRunning,
	setPaperRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isLivePendingStart,
	isLivePendingStop,
	setPaperPendingStart,
	setPaperPendingStop,
	setLivePendingStart,
	setLivePendingStop,
	getPaperPendingSince,
	getLivePendingSince,
	clearPaperPending,
	clearLivePending,
} from "./state.ts";
import {
	connectWallet,
	disconnectWallet,
	getClientStatus,
	getLiveDailyState,
	getPaperDailyState,
	getWalletAddress,
} from "./trader.ts";

const PORT = Number(process.env.API_PORT) || 9999;
const LOGS_DIR = path.resolve("logs");

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
	const header = [
		"timestamp",
		"market",
		"side",
		"amount",
		"price",
		"orderId",
		"status",
		"mode",
	];
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

function parseSignalCsv(
	filePath: string,
	limit = 200,
): Record<string, string>[] {
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
		});
	})

	.get("/trades", (c) => {
		const mode = c.req.query("mode");
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
				updated.paper = { ...currentPaper, risk: { ...currentPaperRisk, ...body.paperRisk } };
			} else {
				updated.paper = currentPaper;
			}

			const currentLive = currentConfig.live && typeof currentConfig.live === "object" ? currentConfig.live : {};
			const currentLiveRisk = currentLive.risk && typeof currentLive.risk === "object" ? currentLive.risk : {};
			if (body.liveRisk && typeof body.liveRisk === "object") {
				updated.live = { ...currentLive, risk: { ...currentLiveRisk, ...body.liveRisk } };
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
					error:
						error instanceof Error ? error.message : "Failed to update config",
				},
				400,
			);
		}
	})

	.post("/paper/start", (c) => {
		setPaperPendingStart(true);
		return c.json({ ok: true as const, paperPendingStart: true, message: "Starting at next cycle" });
	})

	.post("/paper/stop", (c) => {
		setPaperPendingStop(true);
		return c.json({ ok: true as const, paperPendingStop: true, message: "Stopping after current cycle settlement" });
	})

	.post("/paper/cancel", (c) => {
		clearPaperPending();
		return c.json({ ok: true as const, message: "Pending operation cancelled" });
	})

	.post("/live/connect", async (c) => {
		const remoteIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "";
		const isLocal = remoteIp === "" || remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp.startsWith("172.") || remoteIp.startsWith("10.");
		if (!isLocal) {
			return c.json({ ok: false as const, error: "Forbidden: wallet connect only allowed from local/Docker network" }, 403);
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
				{ ok: false as const, error: "Wallet not connected. Use POST /api/live/connect first." },
				400,
			);
		}
		setLivePendingStart(true);
		return c.json({ ok: true as const, livePendingStart: true, message: "Starting at next cycle" });
	})

	.post("/live/stop", (c) => {
		setLivePendingStop(true);
		return c.json({ ok: true as const, livePendingStop: true, message: "Stopping after current cycle settlement" });
	})

	.post("/live/cancel", (c) => {
		clearLivePending();
		return c.json({ ok: true as const, message: "Pending operation cancelled" });
	});

// ---------------------------------------------------------------------------
// Export route type for hono/client RPC
// ---------------------------------------------------------------------------

export type AppType = typeof apiRoutes;

// ---------------------------------------------------------------------------
// Main app: CORS middleware + API routes + static file serving
// ---------------------------------------------------------------------------

const app = new Hono();

app.use("/api/*", cors());
app.route("/api", apiRoutes);

// SPA static file serving (production only — dev uses Vite proxy)
app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));

export function startApiServer(): void {
	console.log(`[api] Starting dashboard server on port ${PORT}...`);
	Bun.serve({
		port: PORT,
		fetch: app.fetch,
	});
	console.log(`[api] Dashboard server running on http://0.0.0.0:${PORT}`);
}
