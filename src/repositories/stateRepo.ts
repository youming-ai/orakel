import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

export const stateQueries = {
	getState: async (mode: "paper" | "live") => {
		const result = await db.select().from(schema.botState).where(eq(schema.botState.mode, mode));
		return result[0] ?? null;
	},

	getPaperState: async () => {
		const result = await db.select().from(schema.botState).where(eq(schema.botState.mode, "paper"));
		return result[0] ?? null;
	},

	getLiveState: async () => {
		const result = await db.select().from(schema.botState).where(eq(schema.botState.mode, "live"));
		return result[0] ?? null;
	},

	upsertState: async (mode: "paper" | "live", data: Omit<typeof schema.botState.$inferInsert, "mode">) => {
		return await db
			.insert(schema.botState)
			.values({ mode, ...data })
			.onConflictDoUpdate({
				target: schema.botState.mode,
				set: data,
			});
	},

	upsertPaperState: async (data: Omit<typeof schema.botState.$inferInsert, "mode">) => {
		return await stateQueries.upsertState("paper", data);
	},

	upsertLiveState: async (data: Omit<typeof schema.botState.$inferInsert, "mode">) => {
		return await stateQueries.upsertState("live", data);
	},
};
