import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import * as schema from "./schema.ts";

const log = createLogger("db");

export const client = postgres(env.DATABASE_URL, {
	max: 10,
	idle_timeout: 20,
	connect_timeout: 30,
});

export const db = drizzle(client, { schema });

export async function closeDb(): Promise<void> {
	log.info("Closing database connection...");
	await client.end();
	log.info("Database connection closed");
}

export async function testConnection(): Promise<boolean> {
	try {
		await client`SELECT 1`;
		return true;
	} catch (err) {
		log.error("Database connection test failed:", err);
		return false;
	}
}
