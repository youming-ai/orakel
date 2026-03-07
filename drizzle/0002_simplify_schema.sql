-- Simplify schema: merge paper_state/live_state into bot_state, remove unused tables

-- Create bot_state table (merged paper_state + live_state)
CREATE TABLE IF NOT EXISTS "bot_state" (
	"mode" text PRIMARY KEY NOT NULL,
	"initial_balance" real NOT NULL DEFAULT 1000,
	"current_balance" real NOT NULL DEFAULT 1000,
	"max_drawdown" real NOT NULL DEFAULT 0,
	"wins" integer NOT NULL DEFAULT 0,
	"losses" integer NOT NULL DEFAULT 0,
	"total_pnl" real NOT NULL DEFAULT 0,
	"stopped_at" text,
	"stop_reason" text,
	"daily_pnl" text NOT NULL DEFAULT '[]',
	"daily_counted_trade_ids" text NOT NULL DEFAULT '[]'
);

-- Migrate data from paper_state to bot_state
INSERT INTO "bot_state" ("mode", "initial_balance", "current_balance", "max_drawdown", "wins", "losses", "total_pnl", "stopped_at", "stop_reason", "daily_pnl", "daily_counted_trade_ids")
SELECT 'paper', "initial_balance", "current_balance", "max_drawdown", "wins", "losses", "total_pnl", "stopped_at", "stop_reason", "daily_pnl", "daily_counted_trade_ids"
FROM "paper_state"
WHERE EXISTS (SELECT 1 FROM "paper_state");

-- Migrate data from live_state to bot_state
INSERT INTO "bot_state" ("mode", "initial_balance", "current_balance", "max_drawdown", "wins", "losses", "total_pnl", "stopped_at", "stop_reason", "daily_pnl", "daily_counted_trade_ids")
SELECT 'live', "initial_balance", "current_balance", "max_drawdown", "wins", "losses", "total_pnl", "stopped_at", "stop_reason", "daily_pnl", "daily_counted_trade_ids"
FROM "live_state"
WHERE EXISTS (SELECT 1 FROM "live_state");

-- Drop unused tables
DROP TABLE IF EXISTS "signals";
DROP TABLE IF EXISTS "daily_stats";
DROP TABLE IF EXISTS "balance_snapshots";
DROP TABLE IF EXISTS "paper_state";
DROP TABLE IF EXISTS "live_state";
