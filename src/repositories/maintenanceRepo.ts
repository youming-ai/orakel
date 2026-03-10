import { desc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

export async function resetPaperDbData(): Promise<void> {
	await db.delete(schema.botState).where(eq(schema.botState.mode, "paper"));
	await db.delete(schema.trades).where(eq(schema.trades.mode, "paper"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "paper"));
}

export async function resetLiveDbData(): Promise<void> {
	await db.delete(schema.livePendingOrders);
	await db.delete(schema.botState).where(eq(schema.botState.mode, "live"));
	await db.delete(schema.trades).where(eq(schema.trades.mode, "live"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "live"));
	await db.delete(schema.onchainEvents);
	await db.delete(schema.knownCtfTokens);
	await db.delete(schema.kvStore);
	await db.delete(schema.balanceSnapshots);
}

const PRUNE_LIMITS = {
	trades: 200,
	signalLogDays: 90,
	balanceSnapshotDays: 30,
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

	const signalCutoff = Math.floor(Date.now() / 1000) - PRUNE_LIMITS.signalLogDays * 86400;
	const signalResult = await db.delete(schema.signalLog).where(sql`${schema.signalLog.createdAt} < ${signalCutoff}`);
	pruned.signalLog = signalResult.length;

	const balanceCutoff = Math.floor(Date.now() / 1000) - PRUNE_LIMITS.balanceSnapshotDays * 86400;
	const balanceResult = await db
		.delete(schema.balanceSnapshots)
		.where(sql`${schema.balanceSnapshots.createdAt} < ${balanceCutoff}`);
	pruned.balanceSnapshots = balanceResult.length;

	return { pruned };
}
