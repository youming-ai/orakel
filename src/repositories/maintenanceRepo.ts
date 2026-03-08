import { desc, eq, notInArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

export async function resetPaperDbData(): Promise<void> {
	await db.delete(schema.botState).where(eq(schema.botState.mode, "paper"));
	await db.delete(schema.trades).where(eq(schema.trades.mode, "paper"));
}

export async function resetLiveDbData(): Promise<void> {
	await db.delete(schema.livePendingOrders);
	await db.delete(schema.botState).where(eq(schema.botState.mode, "live"));
	await db.delete(schema.trades).where(eq(schema.trades.mode, "live"));
	await db.delete(schema.onchainEvents);
	await db.delete(schema.knownCtfTokens);
	await db.delete(schema.kvStore);
}

const PRUNE_LIMITS = {
	trades: 200,
} as const;

export async function pruneDatabase(): Promise<{ pruned: Record<string, number> }> {
	const pruned: Record<string, number> = {};

	const keepTradeIds = db
		.select({ id: schema.trades.id })
		.from(schema.trades)
		.orderBy(desc(schema.trades.createdAt))
		.limit(PRUNE_LIMITS.trades);
	const tradesResult = await db.delete(schema.trades).where(notInArray(schema.trades.id, keepTradeIds));
	pruned.trades = tradesResult.length;

	return { pruned };
}
