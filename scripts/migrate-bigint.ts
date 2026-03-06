import { db } from "../src/db/client.ts";
import { sql } from "drizzle-orm";
import { closeDb } from "../src/db/client.ts";

async function main() {
	console.log("Migrating integer columns to bigint for ms-timestamp fields...");

	// trades.window_start_ms: integer → bigint
	await db.execute(sql`ALTER TABLE trades ALTER COLUMN window_start_ms TYPE bigint`);
	console.log("✅ trades.window_start_ms → bigint");

	// live_pending_orders.window_start_ms: integer → bigint
	await db.execute(sql`ALTER TABLE live_pending_orders ALTER COLUMN window_start_ms TYPE bigint`);
	console.log("✅ live_pending_orders.window_start_ms → bigint");

	// live_pending_orders.placed_at: integer → bigint
	await db.execute(sql`ALTER TABLE live_pending_orders ALTER COLUMN placed_at TYPE bigint`);
	console.log("✅ live_pending_orders.placed_at → bigint");

	await closeDb();
	console.log("Done. All ms-timestamp columns are now bigint.");
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
