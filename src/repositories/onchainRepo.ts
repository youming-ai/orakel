import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

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
