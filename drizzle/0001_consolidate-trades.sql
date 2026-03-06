ALTER TABLE "live_trades" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paper_trades" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "live_trades" CASCADE;--> statement-breakpoint
DROP TABLE "paper_trades" CASCADE;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "trade_id" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "window_start_ms" integer;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "price_to_beat" real;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "resolved" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "settle_price" real;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_trade_id_unique" UNIQUE("trade_id");