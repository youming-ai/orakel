import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

export const signalLogQueries = {
	insert: async (data: typeof schema.signalLog.$inferInsert) => {
		return await db.insert(schema.signalLog).values(data).returning();
	},

	insertBatch: async (rows: (typeof schema.signalLog.$inferInsert)[]) => {
		return await db.insert(schema.signalLog).values(rows).returning();
	},

	getRecent: async (limit: number) => {
		return await db.select().from(schema.signalLog).orderBy(desc(schema.signalLog.id)).limit(limit);
	},

	getByMarket: async (marketId: string, limit: number) => {
		return await db
			.select()
			.from(schema.signalLog)
			.where(eq(schema.signalLog.marketId, marketId))
			.orderBy(desc(schema.signalLog.id))
			.limit(limit);
	},

	deleteOlderThan: async (days: number) => {
		return await db
			.delete(schema.signalLog)
			.where(sql`${schema.signalLog.createdAt} < floor(extract(epoch from now())) - ${days * 86400}`);
	},

	count: async () => {
		const result = await db.select({ count: sql<number>`count(*)` }).from(schema.signalLog);
		return result[0]?.count ?? 0;
	},
};
