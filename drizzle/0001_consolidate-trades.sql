DO $$ 
BEGIN
    -- Only proceed if the tables exist (for fresh databases)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'live_trades') THEN
        DROP TABLE IF EXISTS "live_trades" CASCADE;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'paper_trades') THEN
        DROP TABLE IF EXISTS "paper_trades" CASCADE;
    END IF;
END $$;--> statement-breakpoint

-- Add columns only if they don't exist
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "trade_id" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "window_start_ms" integer;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "price_to_beat" real;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "resolved" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "settle_price" real;--> statement-breakpoint

-- Add unique constraint only if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'trades_trade_id_unique' 
        AND conrelid = 'trades'::regclass
    ) THEN
        ALTER TABLE "trades" ADD CONSTRAINT "trades_trade_id_unique" UNIQUE("trade_id");
    END IF;
END $$;
