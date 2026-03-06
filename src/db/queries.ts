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

// Paper trades queries
export const paperTradeQueries = {
	upsert: async (data: typeof schema.paperTrades.$inferInsert) => {
		return await db
			.insert(schema.paperTrades)
			.values(data)
			.onConflictDoUpdate({
				target: schema.paperTrades.id,
				set: {
					resolved: data.resolved,
					won: data.won,
					pnl: data.pnl,
					settlePrice: data.settlePrice,
				},
			});
	},

	getAll: async () => {
		return await db.select().from(schema.paperTrades).orderBy(asc(schema.paperTrades.timestamp));
	},

	getUnresolved: async () => {
		return await db
			.select()
			.from(schema.paperTrades)
			.where(eq(schema.paperTrades.resolved, 0))
			.orderBy(desc(schema.paperTrades.timestamp));
	},

	getRecent: async (limit: number) => {
		return await db.select().from(schema.paperTrades).orderBy(desc(schema.paperTrades.timestamp)).limit(limit);
	},
};

// Live trades queries
export const liveTradeQueries = {
	upsert: async (data: typeof schema.liveTrades.$inferInsert) => {
		return await db
			.insert(schema.liveTrades)
			.values(data)
			.onConflictDoUpdate({
				target: schema.liveTrades.id,
				set: {
					resolved: data.resolved,
					won: data.won,
					pnl: data.pnl,
					settlePrice: data.settlePrice,
				},
			});
	},

	getAll: async () => {
		return await db.select().from(schema.liveTrades).orderBy(asc(schema.liveTrades.timestamp));
	},

	getUnresolved: async () => {
		return await db
			.select()
			.from(schema.liveTrades)
			.where(eq(schema.liveTrades.resolved, 0))
			.orderBy(desc(schema.liveTrades.timestamp));
	},

	getRecent: async (limit: number) => {
		return await db.select().from(schema.liveTrades).orderBy(desc(schema.liveTrades.timestamp)).limit(limit);
	},

	getWonTrades: async () => {
		return await db
			.select()
			.from(schema.liveTrades)
			.where(and(eq(schema.liveTrades.resolved, 1), eq(schema.liveTrades.won, 1)));
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

// Signals queries
export const signalQueries = {
	insert: async (data: typeof schema.signals.$inferInsert) => {
		return await db.insert(schema.signals).values(data);
	},

	getRecent: async (limit: number) => {
		return await db.select().from(schema.signals).orderBy(desc(schema.signals.timestamp)).limit(limit);
	},

	getRecentByMarket: async (market: string, limit: number) => {
		return await db
			.select()
			.from(schema.signals)
			.where(eq(schema.signals.market, market))
			.orderBy(desc(schema.signals.timestamp))
			.limit(limit);
	},
};

// Data reset functions
export async function resetPaperDbData(): Promise<void> {
	await db.delete(schema.paperTrades);
	await db.delete(schema.paperState);
	await db.delete(schema.trades).where(eq(schema.trades.mode, "paper"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "paper"));
}

export async function resetLiveDbData(): Promise<void> {
	await db.delete(schema.liveTrades);
	await db.delete(schema.livePendingOrders);
	await db.delete(schema.liveState);
	await db.delete(schema.trades).where(eq(schema.trades.mode, "live"));
	await db.delete(schema.dailyStats).where(eq(schema.dailyStats.mode, "live"));
	await db.delete(schema.onchainEvents);
	await db.delete(schema.balanceSnapshots);
}

// Database pruning
const PRUNE_LIMITS = {
	trades: 100,
	paperTrades: 100,
	liveTrades: 100,
	signals: 500,
	dailyStatsDays: 30,
} as const;

export async function pruneDatabase(): Promise<{ pruned: Record<string, number> }> {
	const pruned: Record<string, number> = {};

	// Prune trades — keep newest PRUNE_LIMITS.trades
	const keepTradeIds = db
		.select({ id: schema.trades.id })
		.from(schema.trades)
		.orderBy(desc(schema.trades.createdAt))
		.limit(PRUNE_LIMITS.trades);
	const tradesResult = await db.delete(schema.trades).where(notInArray(schema.trades.id, keepTradeIds));
	pruned.trades = tradesResult.length;

	// Prune paper_trades
	const keepPaperIds = db
		.select({ id: schema.paperTrades.id })
		.from(schema.paperTrades)
		.orderBy(desc(schema.paperTrades.windowStartMs))
		.limit(PRUNE_LIMITS.paperTrades);
	const paperResult = await db.delete(schema.paperTrades).where(notInArray(schema.paperTrades.id, keepPaperIds));
	pruned.paper_trades = paperResult.length;

	// Prune live_trades
	const keepLiveIds = db
		.select({ id: schema.liveTrades.id })
		.from(schema.liveTrades)
		.orderBy(desc(schema.liveTrades.windowStartMs))
		.limit(PRUNE_LIMITS.liveTrades);
	const liveResult = await db.delete(schema.liveTrades).where(notInArray(schema.liveTrades.id, keepLiveIds));
	pruned.live_trades = liveResult.length;

	// Prune signals
	const keepSignalIds = db
		.select({ id: schema.signals.id })
		.from(schema.signals)
		.orderBy(desc(schema.signals.id))
		.limit(PRUNE_LIMITS.signals);
	const signalsResult = await db.delete(schema.signals).where(notInArray(schema.signals.id, keepSignalIds));
	pruned.signals = signalsResult.length;

	// Prune daily_stats
	const cutoffDate = new Date(Date.now() - PRUNE_LIMITS.dailyStatsDays * 86_400_000).toISOString().slice(0, 10);
	const dailyResult = await db.delete(schema.dailyStats).where(lt(schema.dailyStats.date, cutoffDate));
	pruned.daily_stats = dailyResult.length;

	return { pruned };
}
