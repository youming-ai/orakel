#!/usr/bin/env bun
/**
 * Database Maintenance Script
 *
 * Performs regular maintenance tasks to prevent database corruption:
 * 1. WAL checkpoint - writes WAL to main database
 * 2. Cleanup old signals - keeps only last 7 days
 * 3. VACUUM - compacts database file
 *
 * Usage: bun run scripts/db-maintenance.ts
 */

import Database from "bun:sqlite";
import { createLogger } from "../src/core/logger.ts";

const log = createLogger("db-maintenance");
// Resolve path relative to project root (script is in packages/bot/scripts/ directory)
const DB_PATH = new URL("../../../data/bot.sqlite", import.meta.url).pathname;

interface MaintenanceResult {
	checkpoint: boolean;
	cleanup: boolean;
	vacuum: boolean;
	signalsDeleted: number;
	dbSizeBefore: number;
	dbSizeAfter: number;
}

async function getDbSize(): Promise<number> {
	const stat = await Bun.file(DB_PATH).stat();
	return stat ? stat.size : 0;
}

async function performWALCheckpoint(db: Database): Promise<boolean> {
	try {
		db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
		log.info("WAL checkpoint completed");
		return true;
	} catch (err) {
		log.error("WAL checkpoint failed:", err);
		return false;
	}
}

async function cleanupOldSignals(db: Database): Promise<number> {
	try {
		// Delete signals older than 7 days
		const result = db.run(
			`DELETE FROM signals WHERE timestamp < datetime('now', '-7 days')`,
		);
		const deleted = result.changes;
		log.info(`Deleted ${deleted} old signal(s) (older than 7 days)`);
		return deleted;
	} catch (err) {
		log.error("Cleanup failed:", err);
		return 0;
	}
}

async function vacuumDatabase(db: Database): Promise<boolean> {
	try {
		db.exec("VACUUM;");
		log.info("Database VACUUM completed");
		return true;
	} catch (err) {
		log.error("VACUUM failed:", err);
		return false;
	}
}

async function main(): Promise<void> {
	log.info("Starting database maintenance...");

	const dbSizeBefore = await getDbSize();
	log.info(`Database size before: ${(dbSizeBefore / 1024 / 1024).toFixed(2)} MB`);

	const db = new Database(DB_PATH, { readwrite: true });
	db.exec("PRAGMA journal_mode = WAL;");

	const result: MaintenanceResult = {
		checkpoint: false,
		cleanup: false,
		vacuum: false,
		signalsDeleted: 0,
		dbSizeBefore: dbSizeBefore,
		dbSizeAfter: 0,
	};

	// Step 1: WAL checkpoint
	result.checkpoint = await performWALCheckpoint(db);

	// Step 2: Cleanup old signals
	result.signalsDeleted = await cleanupOldSignals(db);
	result.cleanup = result.signalsDeleted >= 0;

	// Step 3: VACUUM (compact database)
	if (result.cleanup) {
		result.vacuum = await vacuumDatabase(db);
	}

	db.close();

	const dbSizeAfter = await getDbSize();
	result.dbSizeAfter = dbSizeAfter;

	const savedMB = (dbSizeBefore - dbSizeAfter) / 1024 / 1024;
	log.info(`Database size after: ${(dbSizeAfter / 1024 / 1024).toFixed(2)} MB`);
	log.info(`Space saved: ${savedMB.toFixed(2)} MB`);

	log.info("Maintenance completed:", result);
}

main().catch((err) => {
	log.error("Maintenance failed:", err);
	process.exit(1);
});
