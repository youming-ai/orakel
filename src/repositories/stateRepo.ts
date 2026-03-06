import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

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
