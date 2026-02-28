import { z } from "zod";
import type { StorageBackend } from "./types.ts";

// ── helpers ──────────────────────────────────────────────

const csvList = z
	.string()
	.transform((v) =>
		v
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	)
	.default([] as string[]);

// ── schema ───────────────────────────────────────────────

const envSchema = z.object({
	// Core
	PAPER_MODE: z.stringbool().default(false),
	API_PORT: z.coerce.number().int().min(1).max(65535).default(9999),
	ACTIVE_MARKETS: csvList,

	// Auth (optional — if empty, mutation endpoints are unprotected)
	API_TOKEN: z.string().default(""),

	// Wallet private key (optional — if set, auto-connects wallet on startup)
	// 64 hex chars without 0x prefix, or 66 chars with 0x prefix
	PRIVATE_KEY: z
		.string()
		.optional()
		.transform((v) => {
			if (!v) return undefined;
			return v.startsWith("0x") ? v.slice(2) : v;
		}),

	// Storage backends
	PERSIST_BACKEND: z
		.string()
		.transform((v): StorageBackend => {
			const l = v.toLowerCase();
			return l === "csv" || l === "dual" || l === "sqlite" ? l : "sqlite";
		})
		.default("sqlite" as StorageBackend),
	READ_BACKEND: z
		.string()
		.transform((v): Exclude<StorageBackend, "dual"> => {
			const l = v.toLowerCase();
			return l === "csv" || l === "sqlite" ? l : "sqlite";
		})
		.default("sqlite" as Exclude<StorageBackend, "dual">),

	// Polymarket
	POLYMARKET_SLUG: z.string().default(""),
	POLYMARKET_AUTO_SELECT_LATEST: z.stringbool().default(true),
	POLYMARKET_LIVE_WS_URL: z.string().default("wss://ws-live-data.polymarket.com"),
	POLYMARKET_UP_LABEL: z.string().default("Up"),
	POLYMARKET_DOWN_LABEL: z.string().default("Down"),

	// Polygon / Chainlink
	POLYGON_RPC_URLS: csvList,
	POLYGON_RPC_URL: z.string().default("https://polygon-rpc.com"),
	POLYGON_WSS_URLS: csvList,
	POLYGON_WSS_URL: z.string().default(""),
	CHAINLINK_BTC_USD_AGGREGATOR: z.string().default(""),

	// Logging
	LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

// ── validate & export ────────────────────────────────────

function parseEnv() {
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		process.exit(1);
	}
	return Object.freeze(result.data);
}

export const env = parseEnv();
export type Env = typeof env;
