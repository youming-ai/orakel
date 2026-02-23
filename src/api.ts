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
	type DashboardState,
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
	getPaperDailyState,
	getWalletAddress,
} from "./trader.ts";

const PORT = Number(process.env.API_PORT) || 9999;
const LOGS_DIR = path.resolve("logs");

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

const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) => {
	return c.json({ ok: true, timestamp: Date.now() });
});

app.get("/api/state", (c) => {
	const status = getClientStatus();
	const state: DashboardState = {
		markets: getMarkets(),
		updatedAt: getUpdatedAt(),
		wallet: { address: getWalletAddress(), connected: status.clientReady },
		paperDaily: getPaperDailyState(),
		liveDaily: getLiveDailyState(),
		config: {
			strategy: CONFIG.strategy as unknown as Record<string, unknown>,
			paperRisk: CONFIG.paperRisk as unknown as Record<string, unknown>,
			liveRisk: CONFIG.liveRisk as unknown as Record<string, unknown>,
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
	};
	return c.json(state);
});

app.get("/api/trades", (c) => {
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
});

app.get("/api/signals", (c) => {
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
});

app.get("/api/paper-stats", (c) => {
	return c.json({
		stats: getPaperStats(),
		trades: getRecentPaperTrades(),
		byMarket: getMarketBreakdown(),
		balance: getPaperBalance(),
	});
});

app.put("/api/config", async (c) => {
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
			ok: true,
			config: {
				strategy: CONFIG.strategy,
				paperRisk: CONFIG.paperRisk,
				liveRisk: CONFIG.liveRisk,
			},
		});
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "Failed to update config",
			},
			400,
		);
	}
});

app.post("/api/paper/start", (c) => {
	setPaperRunning(true);
	return c.json({ ok: true, paperRunning: true });
});

app.post("/api/paper/stop", (c) => {
	setPaperRunning(false);
	return c.json({ ok: true, paperRunning: false });
});

app.post("/api/live/connect", async (c) => {
	const remoteIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "";
	const isLocal = remoteIp === "" || remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp.startsWith("172.") || remoteIp.startsWith("10.");
	if (!isLocal) {
		return c.json({ error: "Forbidden: wallet connect only allowed from local/Docker network" }, 403);
	}
	try {
		const body = await c.req.json();
		const privateKey = typeof body.privateKey === "string" ? body.privateKey : "";
		const result = await connectWallet(privateKey);
		return c.json({ ok: true, address: result.address });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return c.json({ error: msg }, 400);
	}
});

app.post("/api/live/disconnect", (c) => {
	setLiveRunning(false);
	disconnectWallet();
	return c.json({ ok: true, liveRunning: false });
});

app.post("/api/live/start", (c) => {
	const status = getClientStatus();
	if (!status.walletLoaded || !status.clientReady) {
		return c.json(
			{ error: "Wallet not connected. Use POST /api/live/connect first." },
			400,
		);
	}
	setLiveRunning(true);
	return c.json({ ok: true, liveRunning: true });
});

app.post("/api/live/stop", (c) => {
	setLiveRunning(false);
	return c.json({ ok: true, liveRunning: false });
});

app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));

export function startApiServer(): void {
	console.log(`[api] Starting dashboard server on port ${PORT}...`);
	Bun.serve({
		port: PORT,
		fetch: app.fetch,
	});
	console.log(`[api] Dashboard server running on http://0.0.0.0:${PORT}`);
	console.log(`[api] Docker network: bot container should be accessible as 'bot' from web container`);
}
