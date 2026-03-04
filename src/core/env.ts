import { z } from "zod";
import type { StorageBackend } from "../types.ts";

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
	// Live trading (optional — 64-char hex private key, with or without 0x prefix)
	PRIVATE_KEY: z
		.string()
		.default("")
		.transform((v) => {
			const cleaned = v.trim().replace(/^0x/i, "");
			return cleaned.length === 64 ? cleaned : undefined;
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

	// Auto-redeem (optional — automatic redemption of settled positions)
	AUTO_REDEEM_ENABLED: z.stringbool().default(false),
	AUTO_REDEEM_INTERVAL_MS: z.coerce
		.number()
		.int()
		.min(60_000)
		.default(5 * 60 * 1000), // 5 minutes

	// CORS (optional — comma-separated list of allowed origins, * for wildcard)
	CORS_ORIGIN: z.string().default("*"),
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
