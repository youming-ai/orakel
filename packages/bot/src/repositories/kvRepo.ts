import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

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
