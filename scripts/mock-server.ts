import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "bun";
import path from "node:path";

/**
 * Orakel Mock Server
 * Provides mock API responses for UI development without running the full bot
 */

const DB_PATH = path.join(process.cwd(), "data", "orakel.db");
const PORT = 9999;

// Type definitions matching the real API
interface MarketSnapshot {
	id: string;
	label: string;
	ok: boolean;
	spotPrice: number;
	currentPrice: number;
	priceToBeat: number;
	marketUp: number;
	marketDown: number;
	rawSum: number;
	arbitrage: boolean;
	predictLong: number;
	predictShort: number;
	predictDirection: "LONG" | "SHORT";
	haColor: string;
	haConsecutive: number;
	rsi: number;
	macd: {
		macd: number;
		signal: number;
		hist: number;
		histDelta: number;
	};
	vwapSlope: number;
	timeLeftMin: number;
	phase: "EARLY" | "MID" | "LATE";
	action: "ENTER" | "WAIT" | "SKIP";
	side: "UP" | "DOWN" | null;
	edge: number | null;
	strength: string | null;
	reason: string | null;
	volatility15m: number;
	blendSource: string;
	volImpliedUp: number;
	binanceChainlinkDelta: number;
	orderbookImbalance: number;
	confidence: {
		score: number;
		level: string;
		factors: {
			indicatorAlignment: number;
			volatilityScore: number;
			orderbookScore: number;
			timingScore: number;
			regimeScore: number;
		};
	};
}

interface Trade {
	id: number;
	mode: string;
	market: string;
	windowStartMs: number;
	side: string;
	entryPrice: number;
	size: number;
	exitPrice: number | null;
	pnl: number | null;
	settled: boolean;
	createdAt: number;
}

interface PaperStats {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}

interface DailyStats {
	date: string;
	pnl: number;
	trades: number;
}

interface ApiResponse {
	markets: MarketSnapshot[];
	updatedAt: string;
	wallet: {
		address: string | null;
		connected: boolean;
	};
	paperDaily: DailyStats;
	liveDaily: DailyStats;
	config: Record<string, unknown>;
	paperRunning: boolean;
	liveRunning: boolean;
	paperStats: PaperStats;
	paperBalance: {
		initialBalance: number;
		currentBalance: number;
		maxDrawdown: number;
	};
	liveWallet: {
		address: string | null;
		connected: boolean;
		clientReady: boolean;
	};
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	stopLoss: number | null;
	todayStats: {
		paper: DailyStats;
		live: DailyStats;
	};
}

// Initialize database
let db: Database;

try {
	db = new Database(DB_PATH);
	db.exec("PRAGMA journal_mode = WAL");
	console.log("✓ Database loaded");
} catch (error) {
	console.error("❌ Failed to load database:", error);
	console.log("   Run 'bun run db:seed' first to create mock data");
	process.exit(1);
}

// Helper function to generate realistic market data
function generateMarketSnapshot(market: string): MarketSnapshot {
	const now = Date.now();
	const windowMs = 15 * 60 * 1000;
	const timeInWindow = now % windowMs;
	const timeLeftMin = (windowMs - timeInWindow) / 60000;
	const phase: "EARLY" | "MID" | "LATE" = timeLeftMin > 10 ? "EARLY" : timeLeftMin > 5 ? "MID" : "LATE";

	// Generate realistic price data
	const basePrices: Record<string, number> = {
		BTC: 68000,
		ETH: 3400,
		SOL: 145,
		XRP: 2.3,
	};

	const basePrice = basePrices[market] || 100;
	const priceVariation = (Math.random() - 0.5) * basePrice * 0.01;
	const currentPrice = basePrice + priceVariation;
	const priceToBeat = basePrice + (Math.random() - 0.5) * basePrice * 0.005;

	// Generate market odds
	const bias = (currentPrice - priceToBeat) / priceToBeat;
	const rawUp = 0.5 + bias * 2 + (Math.random() - 0.5) * 0.1;
	const marketUp = Math.max(0.1, Math.min(0.9, rawUp));
	const marketDown = 1 - marketUp - (Math.random() * 0.02);
	const rawSum = marketUp + marketDown;

	// Technical indicators
	const rsi = 40 + Math.random() * 20;
	const macdHist = (Math.random() - 0.5) * 5;
	const vwapSlope = (Math.random() - 0.5) * 0.2;
	const vol = 0.002 + Math.random() * 0.003;

	// Prediction
	const predictUp = marketUp + bias * 0.1;
	const predictLong = Math.max(0.3, Math.min(0.7, predictUp));
	const predictShort = 1 - predictLong;
	const predictDirection = predictLong > 0.5 ? "LONG" : "SHORT";

	// Trade decision
	const edge = Math.abs(predictLong - marketUp);
	const shouldTrade = edge > 0.08 && timeLeftMin > 2 && phase !== "LATE";
	const action = shouldTrade ? "ENTER" : "WAIT";
	const side = predictDirection === "LONG" ? "UP" : "DOWN";

	// Confidence score
	const confidence = {
		score: 0.4 + Math.random() * 0.4,
		level: "MEDIUM",
		factors: {
			indicatorAlignment: 0.5 + Math.random() * 0.3,
			volatilityScore: 0.8 + Math.random() * 0.2,
			orderbookScore: 0.5 + Math.random() * 0.3,
			timingScore: phase === "EARLY" ? 0.8 : phase === "MID" ? 0.6 : 0.4,
			regimeScore: 0.6 + Math.random() * 0.2,
		},
	};
	confidence.level = confidence.score > 0.7 ? "HIGH" : confidence.score > 0.5 ? "MEDIUM" : "LOW";

	return {
		id: market,
		label: market,
		ok: true,
		spotPrice: basePrice,
		currentPrice,
		priceToBeat,
		marketUp,
		marketDown,
		rawSum,
		arbitrage: rawSum < 0.98,
		predictLong,
		predictShort,
		predictDirection,
		haColor: Math.random() > 0.5 ? "green" : "red",
		haConsecutive: Math.floor(Math.random() * 5),
		rsi,
		macd: {
			macd: (Math.random() - 0.5) * 20,
			signal: (Math.random() - 0.5) * 15,
			hist: macdHist,
			histDelta: (Math.random() - 0.5) * 0.5,
		},
		vwapSlope,
		timeLeftMin,
		phase,
		action,
		side: action === "ENTER" ? side : null,
		edge: action === "ENTER" ? edge * (predictDirection === "LONG" ? 1 : -1) : null,
		strength: action === "ENTER" ? (edge > 0.12 ? "GOOD" : "WEAK") : null,
		reason: null,
		volatility15m: vol * Math.sqrt(15),
		blendSource: "blended",
		volImpliedUp: 0.5 + bias,
		binanceChainlinkDelta: (Math.random() - 0.5) * 0.002,
		orderbookImbalance: (Math.random() - 0.5) * 0.2,
		confidence,
	};
}

// Helper function to load trades from database
function loadTrades(mode: "paper" | "live", limit = 100): Trade[] {
	const query = db
		.query(
			`SELECT id, mode, market, window_start_ms as windowStartMs, side,
				entry_price as entryPrice, size, exit_price as exitPrice,
				pnl, settled, created_at as createdAt
			FROM trades
			WHERE mode = ? AND settled = 1
			ORDER BY created_at DESC
			LIMIT ?`,
		)
		.all(mode, limit) as Trade[];

	return query;
}

// Helper function to calculate paper stats
function calculatePaperStats(): PaperStats {
	const trades = loadTrades("paper", 10000);
	const settled = trades.filter((t) => t.settled);
	const wins = settled.filter((t) => t.pnl && t.pnl > 0);
	const losses = settled.filter((t) => t.pnl && t.pnl < 0);
	const pending = trades.filter((t) => !t.settled).length;

	return {
		totalTrades: trades.length,
		wins: wins.length,
		losses: losses.length,
		pending,
		winRate: settled.length > 0 ? wins.length / settled.length : 0,
		totalPnl: settled.reduce((sum, t) => sum + (t.pnl || 0), 0),
	};
}

// Helper function to get daily stats
function getDailyStats(mode: "paper" | "live"): DailyStats {
	const today = new Date().toISOString().split("T")[0];
	const row = db
		.query("SELECT pnl, trades FROM daily_stats WHERE date = ? AND mode = ?")
		.get(today, mode) as { pnl: number; trades: number } | null;

	return row ?? { date: today, pnl: 0, trades: 0 };
}

// Create Hono app
const app = new Hono();

// Enable CORS
app.use("/*", cors());

// Health check
app.get("/api/health", (c) => {
	return c.json({
		status: "ok",
		mode: "mock",
		uptime: process.uptime(),
		memory: process.memoryUsage(),
	});
});

// Full state
app.get("/api/state", (c) => {
	const markets = ["BTC", "ETH", "SOL", "XRP"].map(generateMarketSnapshot);
	const paperStats = calculatePaperStats();

	const response: ApiResponse = {
		markets,
		updatedAt: new Date().toISOString(),
		wallet: {
			address: null,
			connected: false,
		},
		paperDaily: getDailyStats("paper"),
		liveDaily: getDailyStats("live"),
		config: {
			strategy: {
				edgeThresholdEarly: 0.06,
				edgeThresholdMid: 0.08,
				edgeThresholdLate: 0.1,
				minProbEarly: 0.52,
				minProbMid: 0.55,
				minProbLate: 0.6,
			},
		},
		paperRunning: false,
		liveRunning: false,
		paperStats,
		paperBalance: {
			initialBalance: 1000,
			currentBalance: 1000 + paperStats.totalPnl,
			maxDrawdown: 0,
		},
		liveWallet: {
			address: null,
			connected: false,
			clientReady: false,
		},
		paperPendingStart: false,
		paperPendingStop: false,
		livePendingStart: false,
		livePendingStop: false,
		stopLoss: null,
		todayStats: {
			paper: getDailyStats("paper"),
			live: getDailyStats("live"),
		},
	};

	return c.json(response);
});

// Get trades
app.get("/api/trades", (c) => {
	const mode = c.req.query("mode") || "paper";
	const limit = parseInt(c.req.query("limit") || "100");
	const trades = loadTrades(mode as "paper" | "live", limit);

	return c.json(trades);
});

// Get signals
app.get("/api/signals", (c) => {
	const market = c.req.query("market") || "BTC";
	const limit = parseInt(c.req.query("limit") || "200");

	const signals = db
		.query(
			`SELECT market, timestamp_ms as timestampMs, side, model_prob as modelProb,
				market_price as marketPrice, edge, phase, regime, confidence, executed
			FROM signals
			WHERE market = ?
			ORDER BY timestamp_ms DESC
			LIMIT ?`,
		)
		.all(market, limit);

	return c.json(signals);
});

// Get paper stats
app.get("/api/paper-stats", (c) => {
	const stats = calculatePaperStats();
	return c.json(stats);
});

// WebSocket upgrade (simulated)
app.get("/api", (c) => {
	// Return HTML page explaining WebSocket is not supported in mock mode
	return c.text(
		"Mock server does not support WebSocket. Use the REST endpoints for development.",
	);
});

// Start server
console.log("");
console.log("🚀 Orakel Mock Server");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log(`Server running at: http://localhost:${PORT}`);
console.log("");
console.log("Available endpoints:");
console.log(`  GET  /api/health      - Health check`);
console.log(`  GET  /api/state       - Full state (updated every request)`);
console.log(`  GET  /api/trades      - Trade history`);
console.log(`  GET  /api/signals     - Signal history`);
console.log(`  GET  /api/paper-stats - Paper trading stats`);
console.log("");
console.log("Note: WebSocket is not supported in mock mode.");
console.log("      The web dashboard will poll REST endpoints instead.");
console.log("");
console.log("Press Ctrl+C to stop");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");

// Start Bun server
serve({
	fetch: app.fetch,
	port: PORT,
});
