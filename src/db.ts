import { Database } from "bun:sqlite";
import fs from "node:fs";
import { PERSIST_BACKEND, READ_BACKEND } from "./config.ts";

export { PERSIST_BACKEND, READ_BACKEND };

const DB_PATH = "./data/bot.sqlite";

let dbInstance: Database | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    fs.mkdirSync("./data", { recursive: true });

    dbInstance = new Database(DB_PATH, { create: true });
    dbInstance.run("PRAGMA journal_mode = WAL");
    dbInstance.run("PRAGMA synchronous = NORMAL");
    dbInstance.run("PRAGMA cache_size = -64000");
    dbInstance.run("PRAGMA busy_timeout = 5000");
    dbInstance.run("PRAGMA foreign_keys = ON");

    runMigrations(dbInstance);
  }

  return dbInstance;
}

function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const currentVersion =
    (db
      .query("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version?: number | null } | null)?.version ?? 0;

  if (currentVersion < 1) {
    db.transaction(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          market TEXT NOT NULL,
          side TEXT NOT NULL,
          amount REAL NOT NULL,
          price REAL NOT NULL,
          order_id TEXT,
          status TEXT,
          mode TEXT NOT NULL,
          pnl REAL,
          won INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_trades_market_mode ON trades(market, mode)",
      );
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC)",
      );

      db.run(`
        CREATE TABLE IF NOT EXISTS signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          market TEXT NOT NULL,
          regime TEXT,
          signal TEXT,
          vol_implied_up REAL,
          ta_raw_up REAL,
          blended_up REAL,
          blend_source TEXT,
          volatility_15m REAL,
          price_to_beat REAL,
          binance_chainlink_delta REAL,
          orderbook_imbalance REAL,
          model_up REAL,
          model_down REAL,
          mkt_up REAL,
          mkt_down REAL,
          raw_sum REAL,
          arbitrage INTEGER,
          edge_up REAL,
          edge_down REAL,
          recommendation TEXT,
          entry_minute TEXT,
          time_left_min REAL,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_signals_market ON signals(market, timestamp DESC)",
      );

      db.run(`
        CREATE TABLE IF NOT EXISTS paper_trades (
          id TEXT PRIMARY KEY,
          market_id TEXT NOT NULL,
          window_start_ms INTEGER NOT NULL,
          side TEXT NOT NULL,
          price REAL NOT NULL,
          size REAL NOT NULL,
          price_to_beat REAL NOT NULL,
          current_price_at_entry REAL,
          timestamp TEXT NOT NULL,
          resolved INTEGER DEFAULT 0,
          won INTEGER,
          pnl REAL,
          settle_price REAL
        )
      `);
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_paper_trades_resolved ON paper_trades(resolved, timestamp DESC)",
      );

      db.run(`
        CREATE TABLE IF NOT EXISTS daily_stats (
          date TEXT NOT NULL,
          mode TEXT NOT NULL,
          pnl REAL DEFAULT 0,
          trades INTEGER DEFAULT 0,
          wins INTEGER DEFAULT 0,
          losses INTEGER DEFAULT 0,
          PRIMARY KEY (date, mode)
        )
      `);

      db.run(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, strftime('%s', 'now'))",
      );
    })();
  }
}

export const statements = {
  insertTrade: () =>
    getDb().prepare(`
      INSERT INTO trades (timestamp, market, side, amount, price, order_id, status, mode, pnl, won)
      VALUES ($timestamp, $market, $side, $amount, $price, $orderId, $status, $mode, $pnl, $won)
    `),

  insertSignal: () =>
    getDb().prepare(`
      INSERT INTO signals (
        timestamp,
        market,
        regime,
        signal,
        vol_implied_up,
        ta_raw_up,
        blended_up,
        blend_source,
        volatility_15m,
        price_to_beat,
        binance_chainlink_delta,
        orderbook_imbalance,
        model_up,
        model_down,
        mkt_up,
        mkt_down,
        raw_sum,
        arbitrage,
        edge_up,
        edge_down,
        recommendation,
        entry_minute,
        time_left_min
      )
      VALUES (
        $timestamp,
        $market,
        $regime,
        $signal,
        $vol_implied_up,
        $ta_raw_up,
        $blended_up,
        $blend_source,
        $volatility_15m,
        $price_to_beat,
        $binance_chainlink_delta,
        $orderbook_imbalance,
        $model_up,
        $model_down,
        $mkt_up,
        $mkt_down,
        $raw_sum,
        $arbitrage,
        $edge_up,
        $edge_down,
        $recommendation,
        $entry_minute,
        $time_left_min
      )
    `),

  getRecentTrades: () =>
    getDb().query(`
      SELECT * FROM trades WHERE mode = $mode ORDER BY timestamp DESC LIMIT $limit
    `),

  getAllRecentTrades: () =>
    getDb().query(`
      SELECT * FROM trades ORDER BY timestamp DESC LIMIT $limit
    `),

  getRecentSignals: () =>
    getDb().query(`
      SELECT * FROM signals ORDER BY timestamp DESC LIMIT $limit
    `),

  insertPaperTrade: () =>
    getDb().prepare(`
      INSERT INTO paper_trades (
        id,
        market_id,
        window_start_ms,
        side,
        price,
        size,
        price_to_beat,
        current_price_at_entry,
        timestamp,
        resolved,
        won,
        pnl,
        settle_price
      )
      VALUES (
        $id,
        $marketId,
        $windowStartMs,
        $side,
        $price,
        $size,
        $priceToBeat,
        $currentPriceAtEntry,
        $timestamp,
        $resolved,
        $won,
        $pnl,
        $settlePrice
      )
      ON CONFLICT(id) DO UPDATE SET
        resolved = $resolved,
        won = $won,
        pnl = $pnl,
        settle_price = $settlePrice
    `),

  getPendingPaperTrades: () =>
    getDb().query(`
      SELECT * FROM paper_trades WHERE resolved = 0 ORDER BY timestamp
    `),

  getRecentPaperTrades: () =>
    getDb().query(`
      SELECT * FROM paper_trades ORDER BY timestamp DESC LIMIT $limit
    `),

  upsertDailyStats: () =>
    getDb().prepare(`
      INSERT INTO daily_stats (date, mode, pnl, trades, wins, losses)
      VALUES ($date, $mode, $pnl, $trades, $wins, $losses)
      ON CONFLICT(date, mode) DO UPDATE SET
        pnl = $pnl,
        trades = $trades,
        wins = $wins,
        losses = $losses
    `),

  getDailyStats: () =>
    getDb().query(`
      SELECT * FROM daily_stats WHERE date = $date AND mode = $mode
    `),
};
