import { desc, eq, lt, notInArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

export async function resetPaperDbData(): Promise<void> {
	await db.delete(schema.paperState);
	await db.delete(schema.trades).where(eq(schema.trades.mode, "paper"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "paper"));
}

export async function resetLiveDbData(): Promise<void> {
	await db.delete(schema.livePendingOrders);
	await db.delete(schema.liveState);
	await db.delete(schema.trades).where(eq(schema.trades.mode, "live"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "live"));
	await db.delete(schema.onchainEvents);
	await db.delete(schema.balanceSnapshots);
}

const PRUNE_LIMITS = {
	trades: 200,
	dailyStatsDays: 30,
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

	pruned.signals = 0;

	const cutoffDate = new Date(Date.now() - PRUNE_LIMITS.dailyStatsDays * 86_400_000).toISOString().slice(0, 10);
	const dailyResult = await db.delete(schema.dailyStats).where(lt(schema.dailyStats.date, cutoffDate));
	pruned.daily_stats = dailyResult.length;

	return { pruned };
}
