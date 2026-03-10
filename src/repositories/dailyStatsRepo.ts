import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import * as schema from "../db/schema.ts";

export const dailyStatsQueries = {
	upsertDaily: async (
		mode: string,
		date: string,
		pnlDelta: number,
		tradesDelta: number,
		winsDelta: number,
		lossesDelta: number,
	) => {
		return await db
			.insert(schema.dailyStats)
			.values({
				mode,
				date,
				pnl: pnlDelta,
				trades: tradesDelta,
				wins: winsDelta,
				losses: lossesDelta,
			})
			.onConflictDoUpdate({
				target: [schema.dailyStats.mode, schema.dailyStats.date],
				set: {
					pnl: sql`${schema.dailyStats.pnl} + ${pnlDelta}`,
					trades: sql`${schema.dailyStats.trades} + ${tradesDelta}`,
					wins: sql`${schema.dailyStats.wins} + ${winsDelta}`,
					losses: sql`${schema.dailyStats.losses} + ${lossesDelta}`,
				},
			});
	},

	getToday: async (mode: string) => {
		const today = new Date().toDateString();
		const result = await db
			.select()
			.from(schema.dailyStats)
			.where(and(eq(schema.dailyStats.mode, mode), eq(schema.dailyStats.date, today)));
		return result[0] ?? null;
	},

	getByDateRange: async (mode: string, from: string, to: string) => {
		return await db
			.select()
			.from(schema.dailyStats)
			.where(and(eq(schema.dailyStats.mode, mode), gte(schema.dailyStats.date, from), lte(schema.dailyStats.date, to)))
			.orderBy(asc(schema.dailyStats.date));
	},

	getAll: async (mode: string) => {
		return await db
			.select()
			.from(schema.dailyStats)
			.where(eq(schema.dailyStats.mode, mode))
			.orderBy(asc(schema.dailyStats.date));
	},

	deleteOlderThan: async (days: number) => {
		return await db
			.delete(schema.dailyStats)
			.where(sql`${schema.dailyStats.createdAt} < floor(extract(epoch from now())) - ${days * 86400}`);
	},
};
