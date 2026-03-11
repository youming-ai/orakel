import { asc, desc, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

export const balanceSnapshotQueries = {
	insert: async (data: typeof schema.balanceSnapshots.$inferInsert) => {
		return await db.insert(schema.balanceSnapshots).values(data).returning();
	},

	getRecent: async (limit: number) => {
		return await db
			.select()
			.from(schema.balanceSnapshots)
			.orderBy(desc(schema.balanceSnapshots.timestamp))
			.limit(limit);
	},

	getByTimeRange: async (from: number, to: number) => {
		return await db
			.select()
			.from(schema.balanceSnapshots)
			.where(sql`${schema.balanceSnapshots.timestamp} >= ${from} AND ${schema.balanceSnapshots.timestamp} <= ${to}`)
			.orderBy(asc(schema.balanceSnapshots.timestamp));
	},

	deleteOlderThan: async (days: number) => {
		return await db
			.delete(schema.balanceSnapshots)
			.where(sql`${schema.balanceSnapshots.createdAt} < floor(extract(epoch from now())) - ${days * 86400}`);
	},
};
