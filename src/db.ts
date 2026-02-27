import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { PERSIST_BACKEND, READ_BACKEND } from "./config.ts";
import { createLogger } from "./logger.ts";

export { PERSIST_BACKEND, READ_BACKEND };

const log = createLogger("db");

const DB_PATH = "./data/bot.sqlite";

let dbInstance: Database | null = null;

export function getDb(): Database {
	if (!dbInstance) {
		const cwd = process.cwd();
		const fullPath = path.resolve(cwd, DB_PATH);
		const dataDir = path.dirname(fullPath);

		// Log diagnostic information
		log.info("Initializing database:");
		log.info("  Current working directory:", cwd);
		log.info("  Database path:", fullPath);
		log.info("  Data directory:", dataDir);

		// Create data directory with error handling
		try {
			fs.mkdirSync(dataDir, { recursive: true });
			log.info("  Directory created/verified:", dataDir);
		} catch (err) {
			const errno = (err as NodeJS.ErrnoException).errno;
			const code = (err as NodeJS.ErrnoException).code;
			throw new Error(
				`Failed to create data directory at "${dataDir}". ` +
					`Error: ${err} ` +
					`(errno: ${errno}, code: ${code}). ` +
					`Ensure the user has write permissions to "${cwd}"`,
			);
		}

		// Verify directory is writable
		try {
			const testFile = path.join(dataDir, ".write_test");
			fs.writeFileSync(testFile, "test");
			fs.unlinkSync(testFile);
			log.info("  Directory is writable:", dataDir);
		} catch (err) {
			throw new Error(`Directory "${dataDir}" is not writable. Error: ${err}. Check file permissions and ownership.`);
		}

		// Open database with error handling
		try {
			dbInstance = new Database(DB_PATH, { create: true });
			log.info("  Database opened successfully");
		} catch (err) {
			throw new Error(
				`Failed to open database at "${fullPath}". ` +
					`Error: ${err}. ` +
					`Ensure the directory exists and is writable.`,
			);
		}

		dbInstance.run("PRAGMA journal_mode = WAL");
		dbInstance.run("PRAGMA synchronous = NORMAL");
		dbInstance.run("PRAGMA cache_size = -64000");
		dbInstance.run("PRAGMA busy_timeout = 5000");
		dbInstance.run("PRAGMA foreign_keys = ON");

		runMigrations(dbInstance);
		log.info("  Database initialized and migrations completed");
	}

	return dbInstance;
}

/**
 * Get database diagnostic information for debugging
 * Can be exposed via API endpoint
 */
export function getDbDiagnostics(): {
	cwd: string;
	dbPath: string;
	dataDir: string;
	dirExists: boolean;
	dirWritable: boolean;
	dbExists: boolean;
	dbSize: number;
	dbWritable: boolean;
	userInfo: { uid: number; gid: number; username: string };
	error?: string;
} {
	const cwd = process.cwd();
	const fullPath = path.resolve(cwd, DB_PATH);
	const dataDir = path.dirname(fullPath);

	const diagnostics = {
		cwd,
		dbPath: fullPath,
		dataDir,
		dirExists: false,
		dirWritable: false,
		dbExists: false,
		dbSize: 0,
		dbWritable: false,
		userInfo: {
			uid: process.getuid?.() ?? -1,
			gid: process.getgid?.() ?? -1,
			username: process.env.USER || process.env.USERNAME || "unknown",
		},
		error: undefined as string | undefined,
	};

	try {
		// Check if directory exists
		diagnostics.dirExists = fs.existsSync(dataDir);

		if (diagnostics.dirExists) {
			// Check if directory is writable
			try {
				const testFile = path.join(dataDir, ".write_test_diagnostics");
				fs.writeFileSync(testFile, "test");
				fs.unlinkSync(testFile);
				diagnostics.dirWritable = true;
			} catch {
				diagnostics.dirWritable = false;
			}

			// Check if database exists
			diagnostics.dbExists = fs.existsSync(fullPath);
			if (diagnostics.dbExists) {
				const stats = fs.statSync(fullPath);
				diagnostics.dbSize = stats.size;

				// Try to open database in read-only mode
				try {
					const testDb = new Database(fullPath, { readonly: true });
					testDb.close();
					diagnostics.dbWritable = true;
				} catch {
					diagnostics.dbWritable = false;
				}
			}
		}
	} catch (err) {
		diagnostics.error = String(err);
	}

	return diagnostics;
}

function runMigrations(db: Database): void {
	db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

	const currentVersion =
		(db.query("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number | null } | null)
			?.version ?? 0;

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
			db.run("CREATE INDEX IF NOT EXISTS idx_trades_market_mode ON trades(market, mode)");
			db.run("CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC)");

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
			db.run("CREATE INDEX IF NOT EXISTS idx_signals_market ON signals(market, timestamp DESC)");

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
			db.run("CREATE INDEX IF NOT EXISTS idx_paper_trades_resolved ON paper_trades(resolved, timestamp DESC)");

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

			db.run("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, strftime('%s', 'now'))");
		})();
	}

	if (currentVersion < 2) {
		db.transaction(() => {
			db.run(`
        CREATE TABLE IF NOT EXISTS paper_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          initial_balance REAL NOT NULL DEFAULT 1000,
          current_balance REAL NOT NULL DEFAULT 1000,
          max_drawdown REAL NOT NULL DEFAULT 0,
          wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0,
          total_pnl REAL NOT NULL DEFAULT 0,
          stopped_at TEXT,
          stop_reason TEXT,
          daily_pnl TEXT NOT NULL DEFAULT '[]',
          daily_counted_trade_ids TEXT NOT NULL DEFAULT '[]'
        )
      `);

			db.run(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

			db.run("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, strftime('%s', 'now'))");
		})();
	}

	if (currentVersion < 3) {
		db.transaction(() => {
			// Extend trades table with on-chain reconciliation columns
			db.run("ALTER TABLE trades ADD COLUMN tx_hash TEXT DEFAULT NULL");
			db.run("ALTER TABLE trades ADD COLUMN block_number INTEGER DEFAULT NULL");
			db.run("ALTER TABLE trades ADD COLUMN log_index INTEGER DEFAULT NULL");
			db.run("ALTER TABLE trades ADD COLUMN onchain_usdc_delta REAL DEFAULT NULL");
			db.run("ALTER TABLE trades ADD COLUMN onchain_token_id TEXT DEFAULT NULL");
			db.run("ALTER TABLE trades ADD COLUMN onchain_token_delta REAL DEFAULT NULL");
			db.run("ALTER TABLE trades ADD COLUMN recon_status TEXT DEFAULT 'unreconciled'");
			db.run("ALTER TABLE trades ADD COLUMN recon_confidence REAL DEFAULT NULL");

			db.run(`
				CREATE TABLE IF NOT EXISTS onchain_events (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					tx_hash TEXT NOT NULL,
					log_index INTEGER NOT NULL,
					block_number INTEGER,
					event_type TEXT NOT NULL,
					from_addr TEXT,
					to_addr TEXT,
					token_id TEXT,
					value TEXT,
					raw_data TEXT,
					created_at INTEGER DEFAULT (strftime('%s', 'now')),
					UNIQUE(tx_hash, log_index)
				)
			`);
			db.run("CREATE INDEX IF NOT EXISTS idx_onchain_events_tx ON onchain_events(tx_hash)");
			db.run("CREATE INDEX IF NOT EXISTS idx_onchain_events_block ON onchain_events(block_number)");
			db.run("CREATE INDEX IF NOT EXISTS idx_onchain_events_token ON onchain_events(token_id)");

			db.run(`
				CREATE TABLE IF NOT EXISTS balance_snapshots (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					usdc_balance TEXT NOT NULL,
					usdc_formatted REAL NOT NULL,
					positions_json TEXT NOT NULL DEFAULT '[]',
					block_number INTEGER,
					created_at INTEGER DEFAULT (strftime('%s', 'now'))
				)
			`);

			db.run(`
				CREATE TABLE IF NOT EXISTS known_ctf_tokens (
					token_id TEXT PRIMARY KEY,
					market_id TEXT NOT NULL,
					side TEXT NOT NULL,
					condition_id TEXT,
					first_seen_at INTEGER DEFAULT (strftime('%s', 'now'))
				)
			`);

			db.run("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, strftime('%s', 'now'))");
		})();
	}
}

// P2-3: Cache prepared statements — prepare once per SQL string, clear on DB reinit
const stmtCache = new Map<string, ReturnType<Database["prepare"]>>();
const queryCache = new Map<string, ReturnType<Database["query"]>>();

function cachedPrepare(sql: string): ReturnType<Database["prepare"]> {
	let stmt = stmtCache.get(sql);
	if (!stmt) {
		stmt = getDb().prepare(sql);
		stmtCache.set(sql, stmt);
	}
	return stmt;
}

function cachedQuery(sql: string): ReturnType<Database["query"]> {
	let q = queryCache.get(sql);
	if (!q) {
		q = getDb().query(sql);
		queryCache.set(sql, q);
	}
	return q;
}

export const statements = {
	insertTrade: () =>
		cachedPrepare(`
      INSERT INTO trades (timestamp, market, side, amount, price, order_id, status, mode, pnl, won)
      VALUES ($timestamp, $market, $side, $amount, $price, $orderId, $status, $mode, $pnl, $won)
    `),

	insertSignal: () =>
		cachedPrepare(`
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
		cachedQuery(`
      SELECT * FROM trades WHERE mode = $mode ORDER BY timestamp DESC LIMIT $limit
    `),

	getAllRecentTrades: () =>
		cachedQuery(`
      SELECT * FROM trades ORDER BY timestamp DESC LIMIT $limit
    `),

	getRecentSignals: () =>
		cachedQuery(`
      SELECT * FROM signals ORDER BY timestamp DESC LIMIT $limit
    `),

	insertPaperTrade: () =>
		cachedPrepare(`
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
		cachedQuery(`
      SELECT * FROM paper_trades WHERE resolved = 0 ORDER BY timestamp
    `),

	getRecentPaperTrades: () =>
		cachedQuery(`
      SELECT * FROM paper_trades ORDER BY timestamp DESC LIMIT $limit
    `),

	upsertDailyStats: () =>
		cachedPrepare(`
      INSERT INTO daily_stats (date, mode, pnl, trades, wins, losses)
      VALUES ($date, $mode, $pnl, $trades, $wins, $losses)
      ON CONFLICT(date, mode) DO UPDATE SET
        pnl = $pnl,
        trades = $trades,
        wins = $wins,
        losses = $losses
    `),

	getDailyStats: () =>
		cachedQuery(`
      SELECT * FROM daily_stats WHERE date = $date AND mode = $mode
    `),

	getPaperState: () =>
		cachedQuery(`
      SELECT * FROM paper_state WHERE id = 1
    `),

	upsertPaperState: () =>
		cachedPrepare(`
      INSERT INTO paper_state (
        id, initial_balance, current_balance, max_drawdown,
        wins, losses, total_pnl,
        stopped_at, stop_reason,
        daily_pnl, daily_counted_trade_ids
      )
      VALUES (
        1, $initialBalance, $currentBalance, $maxDrawdown,
        $wins, $losses, $totalPnl,
        $stoppedAt, $stopReason,
        $dailyPnl, $dailyCountedTradeIds
      )
      ON CONFLICT(id) DO UPDATE SET
        initial_balance = $initialBalance,
        current_balance = $currentBalance,
        max_drawdown = $maxDrawdown,
        wins = $wins,
        losses = $losses,
        total_pnl = $totalPnl,
        stopped_at = $stoppedAt,
        stop_reason = $stopReason,
        daily_pnl = $dailyPnl,
        daily_counted_trade_ids = $dailyCountedTradeIds
    `),

	getAllPaperTrades: () =>
		cachedQuery(`
      SELECT * FROM paper_trades ORDER BY timestamp ASC
    `),

	getKv: () =>
		cachedQuery(`
      SELECT value FROM kv_store WHERE key = $key
    `),

	setKv: () =>
		cachedPrepare(`
      INSERT INTO kv_store (key, value) VALUES ($key, $value)
      ON CONFLICT(key) DO UPDATE SET value = $value
    `),
	getTradeStatsByMode: () =>
		cachedQuery(`
			SELECT
				COUNT(*) as total_trades,
				SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
				SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) as losses,
				SUM(CASE WHEN won IS NULL THEN 1 ELSE 0 END) as pending,
				COALESCE(SUM(CASE WHEN pnl IS NOT NULL THEN pnl ELSE 0 END), 0) as total_pnl
			FROM trades WHERE mode = $mode
		`),

	updateTradeOutcome: () =>
		cachedPrepare(`
			UPDATE trades SET pnl = $pnl, won = $won WHERE orderId = $orderId AND mode = $mode
		`),
};

// === On-Chain Data Statements ===

export const onchainStatements = {
	insertOnchainEvent: () =>
		cachedPrepare(`
			INSERT OR IGNORE INTO onchain_events (tx_hash, log_index, block_number, event_type, from_addr, to_addr, token_id, value, raw_data)
			VALUES ($txHash, $logIndex, $blockNumber, $eventType, $fromAddr, $toAddr, $tokenId, $value, $rawData)
		`),

	getRecentOnchainEvents: () =>
		cachedQuery(`
			SELECT * FROM onchain_events ORDER BY block_number DESC, log_index DESC LIMIT $limit
		`),

	getOnchainEventsByToken: () =>
		cachedQuery(`
			SELECT * FROM onchain_events WHERE token_id = $tokenId ORDER BY block_number DESC LIMIT $limit
		`),

	insertBalanceSnapshot: () =>
		cachedPrepare(`
			INSERT INTO balance_snapshots (usdc_balance, usdc_formatted, positions_json, block_number)
			VALUES ($usdcBalance, $usdcFormatted, $positionsJson, $blockNumber)
		`),

	getLatestBalanceSnapshot: () =>
		cachedQuery(`
			SELECT * FROM balance_snapshots ORDER BY id DESC LIMIT 1
		`),

	upsertKnownCtfToken: () =>
		cachedPrepare(`
			INSERT INTO known_ctf_tokens (token_id, market_id, side, condition_id)
			VALUES ($tokenId, $marketId, $side, $conditionId)
			ON CONFLICT(token_id) DO UPDATE SET
				market_id = $marketId,
				side = $side,
				condition_id = COALESCE($conditionId, known_ctf_tokens.condition_id)
		`),

	getKnownCtfTokens: () =>
		cachedQuery(`
			SELECT * FROM known_ctf_tokens
		`),

	getKnownCtfToken: () =>
		cachedQuery(`
			SELECT * FROM known_ctf_tokens WHERE token_id = $tokenId
		`),

	updateTradeReconStatus: () =>
		cachedPrepare(`
			UPDATE trades SET
				recon_status = $reconStatus,
				recon_confidence = $reconConfidence,
				tx_hash = COALESCE($txHash, tx_hash),
				block_number = COALESCE($blockNumber, block_number),
				log_index = COALESCE($logIndex, log_index),
				onchain_usdc_delta = COALESCE($onchainUsdcDelta, onchain_usdc_delta),
				onchain_token_id = COALESCE($onchainTokenId, onchain_token_id),
				onchain_token_delta = COALESCE($onchainTokenDelta, onchain_token_delta)
			WHERE order_id = $orderId AND mode = 'live'
		`),

	getUnreconciledTrades: () =>
		cachedQuery(`
			SELECT * FROM trades
			WHERE mode = 'live' AND (recon_status = 'unreconciled' OR recon_status = 'pending')
			ORDER BY timestamp DESC LIMIT $limit
		`),

	getReconciledTrades: () =>
		cachedQuery(`
			SELECT * FROM trades
			WHERE mode = 'live' AND recon_status IS NOT NULL AND recon_status != 'unreconciled'
			ORDER BY timestamp DESC LIMIT $limit
		`),
};
