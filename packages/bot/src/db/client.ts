import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createLogger } from "../core/logger.ts";
import * as schema from "./schema.ts";

const log = createLogger("db");

let _db: ReturnType<typeof drizzle> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export async function connectDb(databaseUrl: string): Promise<ReturnType<typeof drizzle>> {
	_sql = postgres(databaseUrl);
	_db = drizzle(_sql, { schema });
	log.info("Database connected");
	return _db;
}

export function getDb(): ReturnType<typeof drizzle> {
	if (!_db) throw new Error("Database not connected. Call connectDb() first.");
	return _db;
}

export async function disconnectDb(): Promise<void> {
	if (_sql) {
		await _sql.end();
		_sql = null;
		_db = null;
		log.info("Database disconnected");
	}
}
