CREATE TABLE "balance_snapshots_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"balance_usdc" numeric(12, 4) NOT NULL,
	"total_pnl" numeric(12, 4) NOT NULL,
	"win_count" integer NOT NULL,
	"loss_count" integer NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"window_slug" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"chainlink_price" numeric(16, 2) NOT NULL,
	"price_to_beat" numeric(16, 2) NOT NULL,
	"deviation" numeric(12, 8) NOT NULL,
	"model_prob_up" numeric(10, 6) NOT NULL,
	"market_prob_up" numeric(10, 6) NOT NULL,
	"edge_up" numeric(10, 6) NOT NULL,
	"edge_down" numeric(10, 6) NOT NULL,
	"volatility" numeric(12, 8) NOT NULL,
	"time_left_seconds" integer NOT NULL,
	"phase" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "trades_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"window_slug" text NOT NULL,
	"window_start_ms" bigint NOT NULL,
	"window_end_ms" bigint NOT NULL,
	"side" text NOT NULL,
	"price" numeric(10, 4) NOT NULL,
	"size" numeric(10, 2) NOT NULL,
	"price_to_beat" numeric(16, 2) NOT NULL,
	"entry_btc_price" numeric(16, 2) NOT NULL,
	"edge" numeric(10, 6) NOT NULL,
	"model_prob" numeric(10, 6) NOT NULL,
	"market_prob" numeric(10, 6) NOT NULL,
	"phase" text NOT NULL,
	"order_id" text,
	"outcome" text,
	"settle_btc_price" numeric(16, 2),
	"pnl_usdc" numeric(10, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
DROP TABLE IF EXISTS "balance_snapshots" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "daily_stats" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "known_ctf_tokens" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "kv_store" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "live_pending_orders" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "live_state" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "onchain_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "paper_state" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "schema_migrations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "signals" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "trades" CASCADE;