#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const DB_PATH = "./data/bot.sqlite";
const LOGS_DIR = "./logs";
const PAPER_DIR = "./logs/paper";
const LIVE_DIR = "./logs/live";

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");

console.log("[backfill] Starting CSV/JSON -> SQLite migration...\n");

function migrateTrades() {
	const tradeFiles: string[] = [];
	
	for (const dir of [PAPER_DIR, LIVE_DIR]) {
		if (existsSync(dir)) {
			const files = readdirSync(dir)
				.filter(f => f.startsWith("trades-") && f.endsWith(".csv"))
				.map(f => join(dir, f));
			tradeFiles.push(...files);
		}
	}
	
	if (tradeFiles.length === 0) {
		console.log("[trades] No trade CSV files found");
		return;
	}
	
	const stmt = db.prepare(`
		INSERT OR IGNORE INTO trades (timestamp, market, side, amount, price, order_id, status, mode)
		VALUES ($timestamp, $market, $side, $amount, $price, $orderId, $status, $mode)
	`);
	
	let count = 0;
	const tx = db.transaction(() => {
		for (const file of tradeFiles) {
			const mode = file.includes("/paper/") ? "paper" : "live";
			const content = readFileSync(file, "utf-8");
			const lines = content.trim().split("\n").slice(1);
			
			for (const line of lines) {
				if (!line.trim()) continue;
				const [timestamp, market, side, amount, price, orderId, status] = line.split(",");
				stmt.run({
					$timestamp: timestamp,
					$market: market,
					$side: side,
					$amount: parseFloat(amount) || 0,
					$price: parseFloat(price) || 0,
					$orderId: orderId || "",
					$status: status || "",
					$mode: mode,
				});
				count++;
			}
		}
	});
	
	tx();
	console.log(`[trades] Migrated ${count} rows from ${tradeFiles.length} files`);
}

function migrateSignals() {
	if (!existsSync(LOGS_DIR)) {
		console.log("[signals] No logs directory found");
		return;
	}
	
	const signalFiles = readdirSync(LOGS_DIR)
		.filter(f => f.startsWith("signals-") && f.endsWith(".csv"))
		.map(f => join(LOGS_DIR, f));
	
	if (signalFiles.length === 0) {
		console.log("[signals] No signal CSV files found");
		return;
	}
	
	const stmt = db.prepare(`
		INSERT OR IGNORE INTO signals (
			timestamp, market, regime, signal, vol_implied_up, ta_raw_up, blended_up,
			blend_source, volatility_15m, price_to_beat, binance_chainlink_delta,
			orderbook_imbalance, model_up, model_down, mkt_up, mkt_down, raw_sum,
			arbitrage, edge_up, edge_down, recommendation, entry_minute, time_left_min
		) VALUES (
			$timestamp, $market, $regime, $signal, $vol_implied_up, $ta_raw_up, $blended_up,
			$blend_source, $volatility_15m, $price_to_beat, $binance_chainlink_delta,
			$orderbook_imbalance, $model_up, $model_down, $mkt_up, $mkt_down, $raw_sum,
			$arbitrage, $edge_up, $edge_down, $recommendation, $entry_minute, $time_left_min
		)
	`);
	
	let count = 0;
	const tx = db.transaction(() => {
		for (const file of signalFiles) {
			const content = readFileSync(file, "utf-8");
			const lines = content.trim().split("\n").slice(1);
			
			for (const line of lines) {
				if (!line.trim()) continue;
				const cols = line.split(",");
				if (cols.length < 21) continue;
				
				stmt.run({
					$timestamp: cols[0],
					$market: cols[1],
					$regime: cols[2] || null,
					$signal: cols[3] || null,
					$vol_implied_up: parseFloat(cols[4]) || null,
					$ta_raw_up: parseFloat(cols[5]) || null,
					$blended_up: parseFloat(cols[6]) || null,
					$blend_source: cols[7] || null,
					$volatility_15m: parseFloat(cols[8]) || null,
					$price_to_beat: parseFloat(cols[9]) || null,
					$binance_chainlink_delta: parseFloat(cols[10]) || null,
					$orderbook_imbalance: parseFloat(cols[11]) || null,
					$model_up: parseFloat(cols[12]) || null,
					$model_down: parseFloat(cols[13]) || null,
					$mkt_up: parseFloat(cols[14]) || null,
					$mkt_down: parseFloat(cols[15]) || null,
					$raw_sum: parseFloat(cols[16]) || null,
					$arbitrage: parseInt(cols[17]) || 0,
					$edge_up: parseFloat(cols[18]) || null,
					$edge_down: parseFloat(cols[19]) || null,
					$recommendation: cols[20] || null,
					$entry_minute: cols[21] || null,
					$time_left_min: parseFloat(cols[22]) || null,
				});
				count++;
			}
		}
	});
	
	tx();
	console.log(`[signals] Migrated ${count} rows from ${signalFiles.length} files`);
}

function migratePaperStats() {
	const statsPath = join(LOGS_DIR, "paper-stats.json");
	if (!existsSync(statsPath)) {
		console.log("[paper-stats] No paper-stats.json found");
		return;
	}
	
	const stats = JSON.parse(readFileSync(statsPath, "utf-8"));
	if (!stats.trades || stats.trades.length === 0) {
		console.log("[paper-stats] No trades in paper-stats.json");
		return;
	}
	
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO paper_trades (
			id, market_id, window_start_ms, side, price, size, price_to_beat,
			current_price_at_entry, timestamp, resolved, won, pnl, settle_price
		) VALUES (
			$id, $marketId, $windowStartMs, $side, $price, $size, $priceToBeat,
			$currentPriceAtEntry, $timestamp, $resolved, $won, $pnl, $settlePrice
		)
	`);
	
	let count = 0;
	const tx = db.transaction(() => {
		for (const trade of stats.trades) {
			stmt.run({
				$id: trade.id,
				$marketId: trade.marketId,
				$windowStartMs: trade.windowStartMs,
				$side: trade.side,
				$price: trade.price,
				$size: trade.size,
				$priceToBeat: trade.priceToBeat,
				$currentPriceAtEntry: trade.currentPriceAtEntry,
				$timestamp: trade.timestamp,
				$resolved: trade.resolved ? 1 : 0,
				$won: trade.won !== null ? (trade.won ? 1 : 0) : null,
				$pnl: trade.pnl,
				$settlePrice: trade.settlePrice,
			});
			count++;
		}
	});
	
	tx();
	console.log(`[paper-stats] Migrated ${count} paper trades`);
}

function migrateDailyState() {
	let count = 0;
	
	for (const [mode, dir] of [["paper", PAPER_DIR], ["live", LIVE_DIR]]) {
		const statePath = join(dir as string, "daily-state.json");
		if (!existsSync(statePath)) continue;
		
		const state = JSON.parse(readFileSync(statePath, "utf-8"));
		if (!state.date) continue;
		
		db.prepare(`
			INSERT OR REPLACE INTO daily_stats (date, mode, pnl, trades, wins, losses)
			VALUES ($date, $mode, $pnl, $trades, $wins, $losses)
		`).run({
			$date: state.date,
			$mode: mode,
			$pnl: state.pnl || 0,
			$trades: state.trades || 0,
			$wins: state.wins || 0,
			$losses: state.losses || 0,
		});
		count++;
	}
	
	console.log(`[daily-state] Migrated ${count} daily state records`);
}

try {
	migrateTrades();
	migrateSignals();
	migratePaperStats();
	migrateDailyState();
	
	const tradesRow = db.query("SELECT COUNT(*) as count FROM trades").get() as { count: number } | undefined;
	const signalsRow = db.query("SELECT COUNT(*) as count FROM signals").get() as { count: number } | undefined;
	const paperTradesRow = db.query("SELECT COUNT(*) as count FROM paper_trades").get() as { count: number } | undefined;
	const dailyStatsRow = db.query("SELECT COUNT(*) as count FROM daily_stats").get() as { count: number } | undefined;
	
	console.log("\n[backfill] Migration complete!");
	console.log(`  trades:       ${(tradesRow?.count ?? 0).toLocaleString()}`);
	console.log(`  signals:      ${(signalsRow?.count ?? 0).toLocaleString()}`);
	console.log(`  paper_trades: ${(paperTradesRow?.count ?? 0).toLocaleString()}`);
	console.log(`  daily_stats:  ${(dailyStatsRow?.count ?? 0).toLocaleString()}`);
} finally {
	db.close();
}
