#!/usr/bin/env bun
/**
 * SQLite online backup script.
 *
 * Uses SQLite VACUUM INTO for a consistent, WAL-safe snapshot.
 * Keeps the last N backups (default 7) and prunes older ones.
 *
 * Usage:
 *   bun run scripts/backup-db.ts                 # one-off backup
 *   bun run scripts/backup-db.ts --keep 14       # keep 14 backups
 *
 * Schedule via cron:
 *   0 * * * *  cd /app && bun run scripts/backup-db.ts >> /app/logs/backup.log 2>&1
 */

import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = "./data/bot.sqlite";
const BACKUP_DIR = "./data/backups";
const DEFAULT_KEEP = 7;

function parseArgs(): { keep: number } {
	const idx = process.argv.indexOf("--keep");
	const keep = idx !== -1 && process.argv[idx + 1] ? Number(process.argv[idx + 1]) : DEFAULT_KEEP;
	return { keep: Number.isNaN(keep) || keep < 1 ? DEFAULT_KEEP : keep };
}

function formatTimestamp(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function pruneOldBackups(dir: string, keep: number): void {
	const files = fs
		.readdirSync(dir)
		.filter((f) => f.startsWith("bot-") && f.endsWith(".sqlite"))
		.sort()
		.reverse();

	for (const file of files.slice(keep)) {
		const fullPath = path.join(dir, file);
		fs.unlinkSync(fullPath);
		console.log(`[backup] Pruned old backup: ${file}`);
	}
}

function main(): void {
	const { keep } = parseArgs();

	if (!fs.existsSync(DB_PATH)) {
		console.error(`[backup] Database not found: ${DB_PATH}`);
		process.exit(1);
	}

	fs.mkdirSync(BACKUP_DIR, { recursive: true });

	const destName = `bot-${formatTimestamp()}.sqlite`;
	const destPath = path.join(BACKUP_DIR, destName);

	const start = performance.now();

	// VACUUM INTO creates a consistent snapshot (safe with WAL mode)
	const db = new Database(DB_PATH, { readonly: true });
	try {
		db.run(`VACUUM INTO '${destPath}'`);
	} finally {
		db.close();
	}

	const elapsed = (performance.now() - start).toFixed(0);
	const sizeKB = (fs.statSync(destPath).size / 1024).toFixed(1);
	console.log(`[backup] Created ${destName} (${sizeKB} KB) in ${elapsed}ms`);

	pruneOldBackups(BACKUP_DIR, keep);
}

try {
	main();
} catch (err) {
	console.error("[backup] Failed:", err);
	process.exit(1);
}
