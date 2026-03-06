import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

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
