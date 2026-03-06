CREATE TABLE "balance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"usdc_balance" text NOT NULL,
	"usdc_formatted" real NOT NULL,
	"positions_json" text DEFAULT '[]' NOT NULL,
	"block_number" integer,
	"created_at" integer DEFAULT floor(extract(epoch from now()))
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"date" text NOT NULL,
	"mode" text NOT NULL,
	"pnl" real DEFAULT 0,
	"trades" integer DEFAULT 0,
	"wins" integer DEFAULT 0,
	"losses" integer DEFAULT 0,
	CONSTRAINT "daily_stats_date_mode_pk" PRIMARY KEY("date","mode")
);
--> statement-breakpoint
CREATE TABLE "known_ctf_tokens" (
	"token_id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"side" text NOT NULL,
	"condition_id" text,
	"first_seen_at" integer DEFAULT floor(extract(epoch from now()))
);
--> statement-breakpoint
CREATE TABLE "kv_store" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_pending_orders" (
	"order_id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"window_start_ms" integer NOT NULL,
	"side" text NOT NULL,
	"price" real NOT NULL,
	"size" real NOT NULL,
	"price_to_beat" real,
	"current_price_at_entry" real,
	"token_id" text,
	"placed_at" integer NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"created_at" integer DEFAULT floor(extract(epoch from now()))
);
--> statement-breakpoint
CREATE TABLE "live_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"initial_balance" real DEFAULT 1000 NOT NULL,
	"current_balance" real DEFAULT 1000 NOT NULL,
	"max_drawdown" real DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"total_pnl" real DEFAULT 0 NOT NULL,
	"stopped_at" text,
	"stop_reason" text,
	"daily_pnl" text DEFAULT '[]' NOT NULL,
	"daily_counted_trade_ids" text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"window_start_ms" integer NOT NULL,
	"side" text NOT NULL,
	"price" real NOT NULL,
	"size" real NOT NULL,
	"price_to_beat" real NOT NULL,
	"current_price_at_entry" real,
	"timestamp" text NOT NULL,
	"resolved" integer DEFAULT 0,
	"won" integer,
	"pnl" real,
	"settle_price" real
);
--> statement-breakpoint
CREATE TABLE "onchain_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" integer,
	"event_type" text NOT NULL,
	"from_addr" text,
	"to_addr" text,
	"token_id" text,
	"value" text,
	"raw_data" text,
	"created_at" integer DEFAULT floor(extract(epoch from now())),
	CONSTRAINT "onchain_events_tx_hash_log_index_unique" UNIQUE("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "paper_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"initial_balance" real DEFAULT 1000 NOT NULL,
	"current_balance" real DEFAULT 1000 NOT NULL,
	"max_drawdown" real DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"total_pnl" real DEFAULT 0 NOT NULL,
	"stopped_at" text,
	"stop_reason" text,
	"daily_pnl" text DEFAULT '[]' NOT NULL,
	"daily_counted_trade_ids" text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"window_start_ms" integer NOT NULL,
	"side" text NOT NULL,
	"price" real NOT NULL,
	"size" real NOT NULL,
	"price_to_beat" real NOT NULL,
	"current_price_at_entry" real,
	"timestamp" text NOT NULL,
	"resolved" integer DEFAULT 0,
	"won" integer,
	"pnl" real,
	"settle_price" real
);
--> statement-breakpoint
CREATE TABLE "schema_migrations" (
	"version" integer PRIMARY KEY NOT NULL,
	"applied_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" text NOT NULL,
	"market" text NOT NULL,
	"regime" text,
	"signal" text,
	"vol_implied_up" real,
	"ta_raw_up" real,
	"blended_up" real,
	"blend_source" text,
	"volatility_15m" real,
	"price_to_beat" real,
	"binance_chainlink_delta" real,
	"orderbook_imbalance" real,
	"model_up" real,
	"model_down" real,
	"mkt_up" real,
	"mkt_down" real,
	"raw_sum" real,
	"arbitrage" integer,
	"edge_up" real,
	"edge_down" real,
	"recommendation" text,
	"entry_minute" text,
	"time_left_min" real,
	"created_at" integer DEFAULT floor(extract(epoch from now()))
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" text NOT NULL,
	"market" text NOT NULL,
	"side" text NOT NULL,
	"amount" real NOT NULL,
	"price" real NOT NULL,
	"order_id" text,
	"status" text,
	"mode" text NOT NULL,
	"pnl" real,
	"won" integer,
	"created_at" integer DEFAULT floor(extract(epoch from now())),
	"tx_hash" text,
	"block_number" integer,
	"log_index" integer,
	"onchain_usdc_delta" real,
	"onchain_token_id" text,
	"onchain_token_delta" real,
	"recon_status" text DEFAULT 'unreconciled',
	"recon_confidence" real,
	"current_price_at_entry" real
);
