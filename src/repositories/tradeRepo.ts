import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

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
