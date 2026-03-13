import { isNull } from "drizzle-orm";
import { connectDb, disconnectDb, getDb } from "../src/db/client.ts";
import { trades } from "../src/db/schema.ts";

async function deleteOpenTrades() {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error("Error: DATABASE_URL environment variable is required");
		process.exit(1);
	}

	await connectDb(databaseUrl);
	const db = getDb();

	console.log("Finding open trades (outcome is null)...");

	const openTrades = await db.select().from(trades).where(isNull(trades.outcome));

	if (openTrades.length === 0) {
		console.log("No open trades found.");
		return;
	}

	console.log(`Found ${openTrades.length} open trades:`);
	for (const t of openTrades) {
		console.log(`  - ID ${t.id}: ${t.windowSlug}, ${t.side}, ${t.createdAt}`);
	}

	const result = await db.delete(trades).where(isNull(trades.outcome));

	console.log(`\nDeleted ${openTrades.length} open trades.`);

	await disconnectDb();
}

deleteOpenTrades().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
