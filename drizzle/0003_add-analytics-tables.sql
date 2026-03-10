-- Add analytics tables: daily_stats, balance_snapshots, signal_log
-- Simplify bot_state: remove JSON columns (dailyPnl, dailyCountedTradeIds)

-- 1. Create new tables

CREATE TABLE IF NOT EXISTS "daily_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"date" text NOT NULL,
	"pnl" real NOT NULL DEFAULT 0,
	"trades" integer NOT NULL DEFAULT 0,
	"wins" integer NOT NULL DEFAULT 0,
	"losses" integer NOT NULL DEFAULT 0,
	"max_drawdown" real DEFAULT 0,
	"created_at" integer DEFAULT floor(extract(epoch from now())),
	CONSTRAINT "daily_stats_mode_date_unique" UNIQUE("mode","date")
);

CREATE TABLE IF NOT EXISTS "balance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" integer NOT NULL,
	"usdc_balance" real NOT NULL,
	"usdc_raw" text,
	"block_number" integer,
	"positions" text,
	"created_at" integer DEFAULT floor(extract(epoch from now()))
);

CREATE TABLE IF NOT EXISTS "signal_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" text NOT NULL,
	"market_id" text NOT NULL,
	"market_slug" text,
	"phase" text,
	"action" text NOT NULL,
	"side" text,
	"edge" real,
	"model_up" real,
	"model_down" real,
	"market_up" real,
	"market_down" real,
	"spot_price" real,
	"price_to_beat" real,
	"volatility_15m" real,
	"blend_source" text,
	"confidence" text,
	"created_at" integer DEFAULT floor(extract(epoch from now()))
);

-- 2. Migrate existing dailyPnl JSON data to daily_stats rows
-- (only if bot_state has the old columns)
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'bot_state' AND column_name = 'daily_pnl'
	) THEN
		INSERT INTO "daily_stats" ("mode", "date", "pnl", "trades")
		SELECT
			bs.mode,
			(item->>'date')::text,
			(item->>'pnl')::real,
			(item->>'trades')::integer
		FROM "bot_state" bs,
			jsonb_array_elements(bs.daily_pnl::jsonb) AS item
		WHERE bs.daily_pnl IS NOT NULL AND bs.daily_pnl != '[]'
		ON CONFLICT ("mode", "date") DO UPDATE SET
			pnl = EXCLUDED.pnl,
			trades = EXCLUDED.trades;
	END IF;
END $$;

-- 3. Remove old JSON columns from bot_state
ALTER TABLE "bot_state" DROP COLUMN IF EXISTS "daily_pnl";
ALTER TABLE "bot_state" DROP COLUMN IF EXISTS "daily_counted_trade_ids";

-- 4. Remove legacy columns from bot_state (added in 0002 but removed from schema)
ALTER TABLE "bot_state" DROP COLUMN IF EXISTS "initial_balance";
ALTER TABLE "bot_state" DROP COLUMN IF EXISTS "current_balance";
