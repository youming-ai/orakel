#!/usr/bin/env bun
/**
 * Database migration: Add market_slug columns
 * Run with: bun run scripts/migrate-market-slug.ts
 */

import { db } from "../src/db/client.ts";
import { sql } from "drizzle-orm";

console.log("Running migration: Add market_slug columns...");

try {
	// Add market_slug to trades table
	await db.execute(sql`
		ALTER TABLE trades 
		ADD COLUMN IF NOT EXISTS market_slug TEXT;
	`);
	console.log("✓ Added market_slug to trades table");

	// Add market_slug to live_pending_orders table
	await db.execute(sql`
		ALTER TABLE live_pending_orders 
		ADD COLUMN IF NOT EXISTS market_slug TEXT;
	`);
	console.log("✓ Added market_slug to live_pending_orders table");

	console.log("\nMigration completed successfully!");
} catch (err) {
	console.error("Migration failed:", err);
	process.exit(1);
}

process.exit(0);
