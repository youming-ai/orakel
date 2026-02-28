import { Database } from "bun:sqlite";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { createLogger } from "../src/logger.ts";

const log = createLogger("db-seed");

/**
 * Orakel Database Seed Script
 * Generates mock data for development and testing
 */

const DB_PATH = path.join(process.cwd(), "data", "orakel.db");

interface SeedTrade {
	mode: "paper" | "live";
	market: string;
	windowStartMs: number;
	side: "UP" | "DOWN";
	entryPrice: number;
	size: number;
	exitPrice?: number;
	pnl?: number;
	settled: boolean;
}

interface SeedSignal {
	market: string;
	timestampMs: number;
	side: "UP" | "DOWN";
	modelProb: number;
	marketPrice: number;
	edge: number;
	phase: "EARLY" | "MID" | "LATE";
	regime: string;
	confidence: number;
	executed: boolean;
}

// Generate mock trades
function generateMockTrades(): SeedTrade[] {
	const markets = ["BTC", "ETH", "SOL", "XRP"];
	const sides: Array<"UP" | "DOWN"> = ["UP", "DOWN"];
	const modes: Array<"paper" | "live"> = ["paper", "live"];
	const trades: SeedTrade[] = [];
	const now = Date.now();
	const windowMs = 15 * 60 * 1000; // 15 minutes

	// Generate trades for the last 7 days
	for (let day = 0; day < 7; day++) {
		for (let hour = 0; hour < 24; hour++) {
			// 1-3 trades per hour
			const tradesPerHour = Math.floor(Math.random() * 3) + 1;

			for (let t = 0; t < tradesPerHour; t++) {
				const windowStart = now - day * 24 * 60 * 60 * 1000 - hour * 60 * 60 * 1000;
				const market = markets[Math.floor(Math.random() * markets.length)];
				const side = sides[Math.floor(Math.random() * sides.length)];
				const mode = modes[Math.floor(Math.random() * modes.length)];
				const entryPrice = 0.45 + Math.random() * 0.1; // 0.45-0.55
				const size = 5 + Math.random() * 10; // 5-15 USDC

				// 55% win rate
				const won = Math.random() < 0.55;
				const exitPrice = won ? 1 - entryPrice * 0.05 : entryPrice * 0.05;
				const pnl = won ? size * (1 - entryPrice) : -size * entryPrice;

				trades.push({
					mode,
					market,
					windowStartMs: windowStart - (windowStart % windowMs),
					side,
					entryPrice,
					size,
					exitPrice,
					pnl,
					settled: true,
				});
			}
		}
	}

	return trades;
}

// Generate mock signals
function generateMockSignals(): SeedSignal[] {
	const markets = ["BTC", "ETH", "SOL", "XRP"];
	const sides: Array<"UP" | "DOWN"> = ["UP", "DOWN"];
	const regimes = ["TREND_UP", "TREND_DOWN", "RANGE", "CHOP"];
	const phases: Array<"EARLY" | "MID" | "LATE"> = ["EARLY", "MID", "LATE"];
	const signals: SeedSignal[] = [];
	const now = Date.now();
	const windowMs = 15 * 60 * 1000;

	// Generate signals for the last 3 days
	for (let day = 0; day < 3; day++) {
		for (let window = 0; window < 96; window++) {
			// 1-4 signals per window
			const signalsPerWindow = Math.floor(Math.random() * 4) + 1;

			for (let s = 0; s < signalsPerWindow; s++) {
				const timestamp = now - day * 24 * 60 * 60 * 1000 - window * windowMs;
				const market = markets[Math.floor(Math.random() * markets.length)];
				const side = sides[Math.floor(Math.random() * sides.length)];
				const modelProb = 0.5 + Math.random() * 0.2; // 0.5-0.7
				const marketPrice = 0.45 + Math.random() * 0.1; // 0.45-0.55
				const edge = Math.abs(modelProb - marketPrice);
				const executed = edge > 0.08 && modelProb > 0.55;

				signals.push({
					market,
					timestampMs: timestamp,
					side,
					modelProb,
					marketPrice,
					edge,
					phase: phases[Math.floor(Math.random() * phases.length)],
					regime: regimes[Math.floor(Math.random() * regimes.length)],
					confidence: 0.4 + Math.random() * 0.4, // 0.4-0.8
					executed,
				});
			}
		}
	}

	return signals;
}

// Seed the database
function seedDatabase(): void {
	log.info("🌱 Seeding database with mock data...");

	// Ensure data directory exists
	const dataDir = path.join(process.cwd(), "data");
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}

	// Open database (will be created if it doesn't exist)
	const db = new Database(DB_PATH);

	// Enable WAL mode for better performance
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA foreign_keys = ON");

	// Create tables (if they don't exist)
	db.exec(`
		CREATE TABLE IF NOT EXISTS trades (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			mode TEXT NOT NULL,
			market TEXT NOT NULL,
			window_start_ms INTEGER NOT NULL,
			side TEXT NOT NULL,
			entry_price REAL NOT NULL,
			size REAL NOT NULL,
			exit_price REAL,
			pnl REAL,
			settled INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
		);

		CREATE TABLE IF NOT EXISTS signals (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			market TEXT NOT NULL,
			timestamp_ms INTEGER NOT NULL,
			side TEXT NOT NULL,
			model_prob REAL NOT NULL,
			market_price REAL NOT NULL,
			edge REAL NOT NULL,
			phase TEXT NOT NULL,
			regime TEXT NOT NULL,
			confidence REAL NOT NULL,
			executed INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
		);

		CREATE TABLE IF NOT EXISTS daily_stats (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			date TEXT NOT NULL UNIQUE,
			mode TEXT NOT NULL,
			pnl REAL NOT NULL DEFAULT 0,
			trades INTEGER NOT NULL DEFAULT 0,
			wins INTEGER NOT NULL DEFAULT 0,
			losses INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
		);

		CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market);
		CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode);
		CREATE INDEX IF NOT EXISTS idx_trades_window ON trades(window_start_ms);
		CREATE INDEX IF NOT EXISTS idx_signals_market ON signals(market);
		CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp_ms);
	`);

	// Generate and insert mock data
	const trades = generateMockTrades();
	const signals = generateMockSignals();

	// Insert trades
	const insertTrade = db.prepare(`
		INSERT INTO trades (mode, market, window_start_ms, side, entry_price, size, exit_price, pnl, settled, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const insertTradeTxn = db.transaction((tradeList: SeedTrade[]) => {
		for (const trade of tradeList) {
			insertTrade.run(
				trade.mode,
				trade.market,
				trade.windowStartMs,
				trade.side,
				trade.entryPrice,
				trade.size,
				trade.exitPrice ?? null,
				trade.pnl ?? null,
				trade.settled ? 1 : 0,
				trade.windowStartMs,
			);
		}
	});

	insertTradeTxn(trades);
	log.info(`✓ Inserted ${trades.length} mock trades`);

	// Insert signals
	const insertSignal = db.prepare(`
		INSERT INTO signals (market, timestamp_ms, side, model_prob, market_price, edge, phase, regime, confidence, executed, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const insertSignalTxn = db.transaction((signalList: SeedSignal[]) => {
		for (const signal of signalList) {
			insertSignal.run(
				signal.market,
				signal.timestampMs,
				signal.side,
				signal.modelProb,
				signal.marketPrice,
				signal.edge,
				signal.phase,
				signal.regime,
				signal.confidence,
				signal.executed ? 1 : 0,
				signal.timestampMs,
			);
		}
	});

	insertSignalTxn(signals);
	log.info(`✓ Inserted ${signals.length} mock signals`);

	// Generate daily stats
	const dailyStats = new Map<string, { pnl: number; trades: number; wins: number; losses: number }>();

	for (const trade of trades) {
		const date = new Date(trade.windowStartMs).toISOString().split("T")[0];
		const key = `${trade.mode}:${date}`;

		if (!dailyStats.has(key)) {
			dailyStats.set(key, { pnl: 0, trades: 0, wins: 0, losses: 0 });
		}

		const stats = dailyStats.get(key)!;
		stats.trades++;
		stats.pnl += trade.pnl ?? 0;
		if (trade.pnl && trade.pnl > 0) {
			stats.wins++;
		} else if (trade.pnl && trade.pnl < 0) {
			stats.losses++;
		}
	}

	// Insert daily stats
	const insertDailyStats = db.prepare(`
		INSERT INTO daily_stats (date, mode, pnl, trades, wins, losses)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(date) DO UPDATE SET
			pnl = excluded.pnl,
			trades = excluded.trades,
			wins = excluded.wins,
			losses = excluded.losses,
			updated_at = (strftime('%s', 'now') * 1000)
	`);

	for (const [key, stats] of dailyStats) {
		const [mode, date] = key.split(":");
		insertDailyStats.run(date, mode, stats.pnl, stats.trades, stats.wins, stats.losses);
	}

	log.info(`✓ Generated daily stats for ${dailyStats.size} day-mode combinations`);

	db.close();

	log.info("");
	log.info("✅ Database seeded successfully!");
	log.info("");
	log.info("Summary:");
	log.info(`   - Trades: ${trades.length}`);
	log.info(`   - Signals: ${signals.length}`);
	log.info(`   - Daily Stats: ${dailyStats.size}`);
	log.info("");
	log.info("Run 'bun run start' to start the bot with mock data.");
}

// Run the seed
try {
	seedDatabase();
} catch (error) {
	log.error("❌ Error seeding database:", error);
	process.exit(1);
}
