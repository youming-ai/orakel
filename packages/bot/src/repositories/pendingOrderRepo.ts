import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

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
