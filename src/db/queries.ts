import { and, asc, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db } from "./client.ts";
import * as schema from "./schema.ts";

// Trades queries
export const tradeQueries = {
	insertTrade: async (data: typeof schema.trades.$inferInsert) => {
		return await db.insert(schema.trades).values(data).returning();
	},

	getTradesByMarketAndMode: async (market: string, mode: string) => {
		return await db
			.select()
			.from(schema.trades)
			.where(and(eq(schema.trades.market, market), eq(schema.trades.mode, mode)))
			.orderBy(desc(schema.trades.timestamp));
	},

	getRecentByMode: async (mode: string, limit: number) => {
		return await db
			.select()
			.from(schema.trades)
			.where(eq(schema.trades.mode, mode))
			.orderBy(desc(schema.trades.timestamp))
			.limit(limit);
	},

	getAllRecent: async (limit: number) => {
		return await db.select().from(schema.trades).orderBy(desc(schema.trades.timestamp)).limit(limit);
	},

	updateTradeReconStatus: async (orderId: string, data: Partial<typeof schema.trades.$inferInsert>) => {
		return await db.update(schema.trades).set(data).where(eq(schema.trades.orderId, orderId));
	},

	updateTradeStatus: async (orderId: string, mode: string, status: string) => {
		return await db
			.update(schema.trades)
			.set({ status })
			.where(and(eq(schema.trades.orderId, orderId), eq(schema.trades.mode, mode)));
	},

	updateTradeSettlement: async (orderId: string, mode: string, pnl: number, won: number, status: string) => {
		return await db
			.update(schema.trades)
			.set({ pnl, won, status })
			.where(and(eq(schema.trades.orderId, orderId), eq(schema.trades.mode, mode)));
	},

	getUnreconciledTrades: async (limit: number) => {
		return await db
			.select()
			.from(schema.trades)
			.where(and(eq(schema.trades.mode, "live"), inArray(schema.trades.reconStatus, ["unreconciled", "pending"])))
			.orderBy(desc(schema.trades.timestamp))
			.limit(limit);
	},

	getReconciledTrades: async (limit: number) => {
		return await db
			.select()
			.from(schema.trades)
			.where(
				and(
					eq(schema.trades.mode, "live"),
					sql`${schema.trades.reconStatus} IS NOT NULL AND ${schema.trades.reconStatus} != 'unreconciled'`,
				),
			)
			.orderBy(desc(schema.trades.timestamp))
			.limit(limit);
	},
};

// Unified trade queries (used by accountStats for insert/resolve/load)
export const unifiedTradeQueries = {
	upsert: async (data: typeof schema.trades.$inferInsert) => {
		if (!data.tradeId) throw new Error("tradeId is required for upsert");
		return await db
			.insert(schema.trades)
			.values(data)
			.onConflictDoUpdate({
				target: schema.trades.tradeId,
				set: {
					resolved: data.resolved,
					won: data.won,
					pnl: data.pnl,
					settlePrice: data.settlePrice,
					status: data.status,
				},
			});
	},

	getAllByMode: async (mode: string) => {
		return await db
			.select()
			.from(schema.trades)
			.where(and(eq(schema.trades.mode, mode), sql`${schema.trades.tradeId} IS NOT NULL`))
			.orderBy(asc(schema.trades.timestamp));
	},

	getWonTrades: async (mode: string) => {
		return await db
			.select()
			.from(schema.trades)
			.where(
				and(
					eq(schema.trades.mode, mode),
					eq(schema.trades.resolved, 1),
					eq(schema.trades.won, 1),
					sql`${schema.trades.tradeId} IS NOT NULL`,
				),
			);
	},
};

// State queries
export const stateQueries = {
	getPaperState: async () => {
		const result = await db.select().from(schema.paperState).where(eq(schema.paperState.id, 1));
		return result[0] ?? null;
	},

	upsertPaperState: async (data: Partial<typeof schema.paperState.$inferInsert>) => {
		return await db
			.insert(schema.paperState)
			.values({ id: 1, ...data })
			.onConflictDoUpdate({
				target: schema.paperState.id,
				set: data,
			});
	},

	getLiveState: async () => {
		const result = await db.select().from(schema.liveState).where(eq(schema.liveState.id, 1));
		return result[0] ?? null;
	},

	upsertLiveState: async (data: Partial<typeof schema.liveState.$inferInsert>) => {
		return await db
			.insert(schema.liveState)
			.values({ id: 1, ...data })
			.onConflictDoUpdate({
				target: schema.liveState.id,
				set: data,
			});
	},
};

// Live pending orders queries
export const pendingOrderQueries = {
	upsert: async (data: typeof schema.livePendingOrders.$inferInsert) => {
		return await db.insert(schema.livePendingOrders).values(data).onConflictDoUpdate({
			target: schema.livePendingOrders.orderId,
			set: data,
		});
	},

	getAll: async () => {
		return await db.select().from(schema.livePendingOrders).orderBy(asc(schema.livePendingOrders.placedAt));
	},

	updateStatus: async (orderId: string, status: string) => {
		return await db
			.update(schema.livePendingOrders)
			.set({ status })
			.where(eq(schema.livePendingOrders.orderId, orderId));
	},

	delete: async (orderId: string) => {
		return await db.delete(schema.livePendingOrders).where(eq(schema.livePendingOrders.orderId, orderId));
	},
};

// On-chain queries
export const onchainQueries = {
	insertEvent: async (data: typeof schema.onchainEvents.$inferInsert) => {
		return await db.insert(schema.onchainEvents).values(data).onConflictDoNothing();
	},

	getRecent: async (limit: number) => {
		return await db
			.select()
			.from(schema.onchainEvents)
			.orderBy(desc(schema.onchainEvents.blockNumber), desc(schema.onchainEvents.logIndex))
			.limit(limit);
	},

	getByToken: async (tokenId: string, limit: number) => {
		return await db
			.select()
			.from(schema.onchainEvents)
			.where(eq(schema.onchainEvents.tokenId, tokenId))
			.orderBy(desc(schema.onchainEvents.blockNumber))
			.limit(limit);
	},

	insertBalanceSnapshot: async (data: typeof schema.balanceSnapshots.$inferInsert) => {
		return await db.insert(schema.balanceSnapshots).values(data);
	},

	getLatestBalanceSnapshot: async () => {
		const result = await db.select().from(schema.balanceSnapshots).orderBy(desc(schema.balanceSnapshots.id)).limit(1);
		return result[0] ?? null;
	},

	upsertKnownCtfToken: async (data: typeof schema.knownCtfTokens.$inferInsert) => {
		return await db
			.insert(schema.knownCtfTokens)
			.values(data)
			.onConflictDoUpdate({
				target: schema.knownCtfTokens.tokenId,
				set: {
					marketId: data.marketId,
					side: data.side,
					conditionId: data.conditionId,
				},
			});
	},

	getKnownCtfTokens: async () => {
		return await db.select().from(schema.knownCtfTokens);
	},

	getKnownCtfToken: async (tokenId: string) => {
		const result = await db.select().from(schema.knownCtfTokens).where(eq(schema.knownCtfTokens.tokenId, tokenId));
		return result[0] ?? null;
	},

	getCtfTokenByMarketSide: async (marketId: string, side: string) => {
		const result = await db
			.select()
			.from(schema.knownCtfTokens)
			.where(and(eq(schema.knownCtfTokens.marketId, marketId), eq(schema.knownCtfTokens.side, side)))
			.limit(1);
		return result[0] ?? null;
	},

	updateTradeReconStatus: async (orderId: string, data: Partial<typeof schema.trades.$inferInsert>) => {
		return await db.update(schema.trades).set(data).where(eq(schema.trades.orderId, orderId));
	},
};

// Daily stats queries
export const dailyStatsQueries = {
	upsert: async (data: typeof schema.dailyStats.$inferInsert) => {
		return await db
			.insert(schema.dailyStats)
			.values(data)
			.onConflictDoUpdate({
				target: [schema.dailyStats.date, schema.dailyStats.mode],
				set: data,
			});
	},
};

// KV store queries
export const kvQueries = {
	get: async (key: string) => {
		const result = await db.select().from(schema.kvStore).where(eq(schema.kvStore.key, key));
		return result[0]?.value ?? null;
	},

	set: async (key: string, value: string) => {
		return await db.insert(schema.kvStore).values({ key, value }).onConflictDoUpdate({
			target: schema.kvStore.key,
			set: { value },
		});
	},
};

// Signals queries - DISABLED: too verbose, not used
// export const signalQueries = {
// 	insert: async (data: typeof schema.signals.$inferInsert) => {
// 		return await db.insert(schema.signals).values(data);
// 	},

// 	getRecent: async (limit: number) => {
// 		return await db.select().from(schema.signals).orderBy(desc(schema.signals.timestamp)).limit(limit);
// 	},

// 	getRecentByMarket: async (market: string, limit: number) => {
// 		return await db
// 			.select()
// 			.from(schema.signals)
// 			.where(eq(schema.signals.market, market))
// 			.orderBy(desc(schema.signals.timestamp))
// 			.limit(limit);
// 	},
// };

// Data reset functions
export async function resetPaperDbData(): Promise<void> {
	await db.delete(schema.paperState);
	await db.delete(schema.trades).where(eq(schema.trades.mode, "paper"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "paper"));
	await db.delete(schema.signals); // Clear old signals data
}

export async function resetLiveDbData(): Promise<void> {
	await db.delete(schema.livePendingOrders);
	await db.delete(schema.liveState);
	await db.delete(schema.trades).where(eq(schema.trades.mode, "live"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "live"));
	await db.delete(schema.onchainEvents);
	await db.delete(schema.balanceSnapshots);
	await db.delete(schema.signals); // Clear old signals data
}

// Database pruning
const PRUNE_LIMITS = {
	trades: 200,
	// signals: 500, // DISABLED: signals logging stopped
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

	// Signals pruning DISABLED - logging stopped
	// const keepSignalIds = db
	// 	.select({ id: schema.signals.id })
	// 	.from(schema.signals)
	// 	.orderBy(desc(schema.signals.id))
	// 	.limit(PRUNE_LIMITS.signals);
	// const signalsResult = await db.delete(schema.signals).where(notInArray(schema.signals.id, keepSignalIds));
	// pruned.signals = signalsResult.length;
	pruned.signals = 0;

	// Prune daily_stats
	const cutoffDate = new Date(Date.now() - PRUNE_LIMITS.dailyStatsDays * 86_400_000).toISOString().slice(0, 10);
	const dailyResult = await db.delete(schema.dailyStats).where(lt(schema.dailyStats.date, cutoffDate));
	pruned.daily_stats = dailyResult.length;

	return { pruned };
}
