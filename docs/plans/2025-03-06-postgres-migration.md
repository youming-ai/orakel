# PostgreSQL + Drizzle Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate from SQLite to PostgreSQL using Drizzle ORM to eliminate database corruption issues

**Architecture:** Replace `bun:sqlite` with `postgres` driver + Drizzle ORM. Keep existing table structure but add proper schema definitions. Maintain backward compatibility during migration.

**Tech Stack:** Bun, PostgreSQL, Drizzle ORM, drizzle-kit

---

## Prerequisites

- PostgreSQL 15+ installed on VPS
- Database `orakel` created
- User with full permissions

```sql
-- Run on PostgreSQL server
CREATE DATABASE orakel;
CREATE USER orakel WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE orakel TO orakel;
```

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add dependencies**

```bash
bun add drizzle-orm postgres
bun add -d drizzle-kit @types/pg
```

**Step 2: Create drizzle.config.ts**

Create: `drizzle.config.ts`

```typescript
import type { Config } from "drizzle-kit";

export default {
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		host: process.env.PGHOST || "localhost",
		port: Number(process.env.PGPORT) || 5432,
		user: process.env.PGUSER || "orakel",
		password: process.env.PGPASSWORD || "",
		database: process.env.PGDATABASE || "orakel",
		ssl: process.env.PGSSL === "true",
	},
} satisfies Config;
```

**Step 3: Add environment variables**

Modify: `.env`

```bash
# Add these
PGHOST=localhost
PGPORT=5432
PGUSER=orakel
PGPASSWORD=your_password
PGDATABASE=orakel
PGSSL=false
```

**Step 4: Install**

```bash
bun install
```

**Step 5: Commit**

```bash
git add package.json bun.lock drizzle.config.ts .env .env.example
git commit -m "deps: add drizzle-orm and postgres driver"
```

---

## Task 2: Create Drizzle Schema

**Files:**
- Create: `src/db/schema.ts`

**Step 1: Define all tables**

```typescript
import {
	pgTable,
	serial,
	integer,
	text,
	real,
	boolean,
	primaryKey,
	unique,
} from "drizzle-orm/pg-core";

export const schemaMigrations = pgTable("schema_migrations", {
	version: integer("version").primaryKey(),
	appliedAt: integer("applied_at").notNull(),
});

export const trades = pgTable("trades", {
	id: serial("id").primaryKey(),
	timestamp: text("timestamp").notNull(),
	market: text("market").notNull(),
	side: text("side").notNull(),
	amount: real("amount").notNull(),
	price: real("price").notNull(),
	orderId: text("order_id"),
	status: text("status"),
	mode: text("mode").notNull(),
	pnl: real("pnl"),
	won: integer("won"),
	createdAt: integer("created_at").defaultNow(),
	// Migration 3+ columns
	txHash: text("tx_hash"),
	blockNumber: integer("block_number"),
	logIndex: integer("log_index"),
	onchainUsdcDelta: real("onchain_usdc_delta"),
	onchainTokenId: text("onchain_token_id"),
	onchainTokenDelta: real("onchain_token_delta"),
	reconStatus: text("recon_status").default("unreconciled"),
	reconConfidence: real("recon_confidence"),
	// Migration 5+ column
	currentPriceAtEntry: real("current_price_at_entry"),
});

export const signals = pgTable("signals", {
	id: serial("id").primaryKey(),
	timestamp: text("timestamp").notNull(),
	market: text("market").notNull(),
	regime: text("regime"),
	signal: text("signal"),
	volImpliedUp: real("vol_implied_up"),
	taRawUp: real("ta_raw_up"),
	blendedUp: real("blended_up"),
	blendSource: text("blend_source"),
	volatility15m: real("volatility_15m"),
	priceToBeat: real("price_to_beat"),
	binanceChainlinkDelta: real("binance_chainlink_delta"),
	orderbookImbalance: real("orderbook_imbalance"),
	modelUp: real("model_up"),
	modelDown: real("model_down"),
	mktUp: real("mkt_up"),
	mktDown: real("mkt_down"),
	rawSum: real("raw_sum"),
	arbitrage: integer("arbitrage"),
	edgeUp: real("edge_up"),
	edgeDown: real("edge_down"),
	recommendation: text("recommendation"),
	entryMinute: text("entry_minute"),
	timeLeftMin: real("time_left_min"),
	createdAt: integer("created_at").defaultNow(),
});

export const paperTrades = pgTable("paper_trades", {
	id: text("id").primaryKey(),
	marketId: text("market_id").notNull(),
	windowStartMs: integer("window_start_ms").notNull(),
	side: text("side").notNull(),
	price: real("price").notNull(),
	size: real("size").notNull(),
	priceToBeat: real("price_to_beat").notNull(),
	currentPriceAtEntry: real("current_price_at_entry"),
	timestamp: text("timestamp").notNull(),
	resolved: integer("resolved").default(0),
	won: integer("won"),
	pnl: real("pnl"),
	settlePrice: real("settle_price"),
});

export const liveTrades = pgTable("live_trades", {
	id: text("id").primaryKey(),
	marketId: text("market_id").notNull(),
	windowStartMs: integer("window_start_ms").notNull(),
	side: text("side").notNull(),
	price: real("price").notNull(),
	size: real("size").notNull(),
	priceToBeat: real("price_to_beat").notNull(),
	currentPriceAtEntry: real("current_price_at_entry"),
	timestamp: text("timestamp").notNull(),
	resolved: integer("resolved").default(0),
	won: integer("won"),
	pnl: real("pnl"),
	settlePrice: real("settle_price"),
});

export const dailyStats = pgTable(
	"daily_stats",
	{
		date: text("date").notNull(),
		mode: text("mode").notNull(),
		pnl: real("pnl").default(0),
		trades: integer("trades").default(0),
		wins: integer("wins").default(0),
		losses: integer("losses").default(0),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.date, table.mode] }),
	})
);

export const paperState = pgTable("paper_state", {
	id: integer("id").primaryKey(),
	initialBalance: real("initial_balance").notNull().default(1000),
	currentBalance: real("current_balance").notNull().default(1000),
	maxDrawdown: real("max_drawdown").notNull().default(0),
	wins: integer("wins").notNull().default(0),
	losses: integer("losses").notNull().default(0),
	totalPnl: real("total_pnl").notNull().default(0),
	stoppedAt: text("stopped_at"),
	stopReason: text("stop_reason"),
	dailyPnl: text("daily_pnl").notNull().default("[]"),
	dailyCountedTradeIds: text("daily_counted_trade_ids").notNull().default("[]"),
});

export const liveState = pgTable("live_state", {
	id: integer("id").primaryKey(),
	initialBalance: real("initial_balance").notNull().default(1000),
	currentBalance: real("current_balance").notNull().default(1000),
	maxDrawdown: real("max_drawdown").notNull().default(0),
	wins: integer("wins").notNull().default(0),
	losses: integer("losses").notNull().default(0),
	totalPnl: real("total_pnl").notNull().default(0),
	stoppedAt: text("stopped_at"),
	stopReason: text("stop_reason"),
	dailyPnl: text("daily_pnl").notNull().default("[]"),
	dailyCountedTradeIds: text("daily_counted_trade_ids").notNull().default("[]"),
});

export const kvStore = pgTable("kv_store", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

export const livePendingOrders = pgTable("live_pending_orders", {
	orderId: text("order_id").primaryKey(),
	marketId: text("market_id").notNull(),
	windowStartMs: integer("window_start_ms").notNull(),
	side: text("side").notNull(),
	price: real("price").notNull(),
	size: real("size").notNull(),
	priceToBeat: real("price_to_beat"),
	currentPriceAtEntry: real("current_price_at_entry"),
	tokenId: text("token_id"),
	placedAt: integer("placed_at").notNull(),
	status: text("status").notNull().default("placed"),
	createdAt: integer("created_at").defaultNow(),
});

export const onchainEvents = pgTable("onchain_events", {
	id: serial("id").primaryKey(),
	txHash: text("tx_hash").notNull(),
	logIndex: integer("log_index").notNull(),
	blockNumber: integer("block_number"),
	eventType: text("event_type").notNull(),
	fromAddr: text("from_addr"),
	toAddr: text("to_addr"),
	tokenId: text("token_id"),
	value: text("value"),
	rawData: text("raw_data"),
	createdAt: integer("created_at").defaultNow(),
}, (table) => ({
	uniqueTxLog: unique().on(table.txHash, table.logIndex),
}));

export const balanceSnapshots = pgTable("balance_snapshots", {
	id: serial("id").primaryKey(),
	usdcBalance: text("usdc_balance").notNull(),
	usdcFormatted: real("usdc_formatted").notNull(),
	positionsJson: text("positions_json").notNull().default("[]"),
	blockNumber: integer("block_number"),
	createdAt: integer("created_at").defaultNow(),
});

export const knownCtfTokens = pgTable("known_ctf_tokens", {
	tokenId: text("token_id").primaryKey(),
	marketId: text("market_id").notNull(),
	side: text("side").notNull(),
	conditionId: text("condition_id"),
	firstSeenAt: integer("first_seen_at").defaultNow(),
});
```

**Step 2: Commit**

```bash
git add src/db/schema.ts
git commit -m "db: add drizzle schema definitions"
```

---

## Task 3: Create Database Client

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/index.ts`

**Step 1: Create PostgreSQL client**

Create: `src/db/client.ts`

```typescript
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.ts";
import { env } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";

const log = createLogger("db");

const connectionString = `postgres://${env.PGUSER}:${env.PGPASSWORD}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}${env.PGSSL ? "?sslmode=require" : ""}`;

export const client = postgres(connectionString, {
	max: 10, // connection pool size
	idle_timeout: 20,
	connect_timeout: 10,
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
```

**Step 2: Create index**

Create: `src/db/index.ts`

```typescript
export { db, client, closeDb, testConnection } from "./client.ts";
export * from "./schema.ts";
```

**Step 3: Add env types**

Modify: `src/core/env.ts`

Add to schema:
```typescript
PGHOST: z.string().default("localhost"),
PGPORT: z.coerce.number().default(5432),
PGUSER: z.string().default("orakel"),
PGPASSWORD: z.string().default(""),
PGDATABASE: z.string().default("orakel"),
PGSSL: z.stringbool().default(false),
```

**Step 4: Commit**

```bash
git add src/db/
git commit -m "db: add postgres client with drizzle"
```

---

## Task 4: Create Migration Queries (Data Access Layer)

**Files:**
- Create: `src/db/queries.ts`

**Step 1: Port all SQLite queries to Drizzle**

This file will replace `statements` and `onchainStatements` from `src/core/db.ts`.

```typescript
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db } from "./client.ts";
import * as schema from "./schema.ts";

// Trades queries
export const tradeQueries = {
	insertTrade: async (data: typeof schema.trades.$inferInsert) => {
		return await db.insert(schema.trades).values(data).returning();
	},

	getTradesByMarketAndMode: async (market: string, mode: string) => {
		return await db
			.select()
			.from(schema.trades)
			.where(and(eq(schema.trades.market, market), eq(schema.trades.mode, mode)))
			.orderBy(desc(schema.trades.timestamp));
	},

	updateTradeReconStatus: async (
		orderId: string,
		data: Partial<typeof schema.trades.$inferInsert>
	) => {
		return await db
			.update(schema.trades)
			.set(data)
			.where(eq(schema.trades.orderId, orderId));
	},

	getUnreconciledTrades: async (mode: string) => {
		return await db
			.select()
			.from(schema.trades)
			.where(
				and(
					eq(schema.trades.mode, mode),
					sql`${schema.trades.reconStatus} IN ('unreconciled', 'pending')`
				)
			);
	},
};

// Paper trades queries
export const paperTradeQueries = {
	upsert: async (data: typeof schema.paperTrades.$inferInsert) => {
		return await db
			.insert(schema.paperTrades)
			.values(data)
			.onConflictDoUpdate({
				target: schema.paperTrades.id,
				set: {
					resolved: data.resolved,
					won: data.won,
					pnl: data.pnl,
					settlePrice: data.settlePrice,
				},
			});
	},

	getAll: async () => {
		return await db.select().from(schema.paperTrades).orderBy(asc(schema.paperTrades.timestamp));
	},

	getUnresolved: async () => {
		return await db
			.select()
			.from(schema.paperTrades)
			.where(eq(schema.paperTrades.resolved, 0))
			.orderBy(desc(schema.paperTrades.timestamp));
	},
};

// Live trades queries
export const liveTradeQueries = {
	upsert: async (data: typeof schema.liveTrades.$inferInsert) => {
		return await db
			.insert(schema.liveTrades)
			.values(data)
			.onConflictDoUpdate({
				target: schema.liveTrades.id,
				set: {
					resolved: data.resolved,
					won: data.won,
					pnl: data.pnl,
					settlePrice: data.settlePrice,
				},
			});
	},

	getAll: async () => {
		return await db.select().from(schema.liveTrades).orderBy(asc(schema.liveTrades.timestamp));
	},

	getUnresolved: async () => {
		return await db
			.select()
			.from(schema.liveTrades)
			.where(eq(schema.liveTrades.resolved, 0))
			.orderBy(desc(schema.liveTrades.timestamp));
	},
};

// State queries
export const stateQueries = {
	getPaperState: async () => {
		return await db.select().from(schema.paperState).where(eq(schema.paperState.id, 1));
	},

	upsertPaperState: async (data: Partial<typeof schema.paperState.$inferInsert>) => {
		return await db
			.insert(schema.paperState)
			.values({ id: 1, ...data })
			.onConflictDoUpdate({
				target: schema.paperState.id,
				set: data,
			});
	},

	getLiveState: async () => {
		return await db.select().from(schema.liveState).where(eq(schema.liveState.id, 1));
	},

	upsertLiveState: async (data: Partial<typeof schema.liveState.$inferInsert>) => {
		return await db
			.insert(schema.liveState)
			.values({ id: 1, ...data })
			.onConflictDoUpdate({
				target: schema.liveState.id,
				set: data,
			});
	},
};

// Live pending orders queries
export const pendingOrderQueries = {
	upsert: async (data: typeof schema.livePendingOrders.$inferInsert) => {
		return await db
			.insert(schema.livePendingOrders)
			.values(data)
			.onConflictDoUpdate({
				target: schema.livePendingOrders.orderId,
				set: data,
			});
	},

	getAll: async () => {
		return await db
			.select()
			.from(schema.livePendingOrders)
			.orderBy(asc(schema.livePendingOrders.placedAt));
	},

	updateStatus: async (orderId: string, status: string) => {
		return await db
			.update(schema.livePendingOrders)
			.set({ status })
			.where(eq(schema.livePendingOrders.orderId, orderId));
	},

	delete: async (orderId: string) => {
		return await db
			.delete(schema.livePendingOrders)
			.where(eq(schema.livePendingOrders.orderId, orderId));
	},
};

// On-chain queries
export const onchainQueries = {
	insertEvent: async (data: typeof schema.onchainEvents.$inferInsert) => {
		return await db.insert(schema.onchainEvents).values(data).onConflictDoNothing();
	},

	getRecent: async (limit: number) => {
		return await db
			.select()
			.from(schema.onchainEvents)
			.orderBy(desc(schema.onchainEvents.blockNumber), desc(schema.onchainEvents.logIndex))
			.limit(limit);
	},

	getByToken: async (tokenId: string, limit: number) => {
		return await db
			.select()
			.from(schema.onchainEvents)
			.where(eq(schema.onchainEvents.tokenId, tokenId))
			.orderBy(desc(schema.onchainEvents.blockNumber))
			.limit(limit);
	},

	insertBalanceSnapshot: async (data: typeof schema.balanceSnapshots.$inferInsert) => {
		return await db.insert(schema.balanceSnapshots).values(data);
	},

	getLatestBalanceSnapshot: async () => {
		return await db
			.select()
			.from(schema.balanceSnapshots)
			.orderBy(desc(schema.balanceSnapshots.id))
			.limit(1);
	},

	upsertKnownCtfToken: async (data: typeof schema.knownCtfTokens.$inferInsert) => {
		return await db
			.insert(schema.knownCtfTokens)
			.values(data)
			.onConflictDoUpdate({
				target: schema.knownCtfTokens.tokenId,
				set: {
					marketId: data.marketId,
					side: data.side,
					conditionId: data.conditionId,
				},
			});
	},

	getKnownCtfTokens: async () => {
		return await db.select().from(schema.knownCtfTokens);
	},

	getKnownCtfToken: async (tokenId: string) => {
		return await db
			.select()
			.from(schema.knownCtfTokens)
			.where(eq(schema.knownCtfTokens.tokenId, tokenId));
	},

	getCtfTokenByMarketSide: async (marketId: string, side: string) => {
		return await db
			.select()
			.from(schema.knownCtfTokens)
			.where(
				and(
					eq(schema.knownCtfTokens.marketId, marketId),
					eq(schema.knownCtfTokens.side, side)
				)
			)
			.limit(1);
	},
};

// Daily stats queries
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

// KV store queries
export const kvQueries = {
	get: async (key: string) => {
		const result = await db.select().from(schema.kvStore).where(eq(schema.kvStore.key, key));
		return result[0]?.value ?? null;
	},

	set: async (key: string, value: string) => {
		return await db
			.insert(schema.kvStore)
			.values({ key, value })
			.onConflictDoUpdate({
				target: schema.kvStore.key,
				set: { value },
			});
	},
};
```

**Step 2: Commit**

```bash
git add src/db/queries.ts
git commit -m "db: add drizzle query layer"
```

---

## Task 5: Run Database Migration

**Step 1: Generate migration**

```bash
bunx drizzle-kit generate
```

**Step 2: Apply migration**

```bash
bunx drizzle-kit migrate
```

**Step 3: Verify tables created**

```bash
psql -h localhost -U orakel -d orakel -c "\dt"
```

Expected: All 14 tables listed

**Step 4: Commit migration files**

```bash
git add drizzle/
git commit -m "db: add initial postgres migration"
```

---

## Task 6: Data Migration Script

**Files:**
- Create: `scripts/migrate-to-postgres.ts`

**Step 1: Create migration script**

```typescript
/**
 * One-time migration script: SQLite → PostgreSQL
 * Usage: bun run scripts/migrate-to-postgres.ts
 */

import { Database } from "bun:sqlite";
import { db, client } from "../src/db/index.ts";
import * as queries from "../src/db/queries.ts";

const sqlite = new Database("./data/bot.sqlite", { readonly: true });

async function migrate() {
	console.log("Starting migration from SQLite to PostgreSQL...");

	// Migrate paper_trades
	console.log("Migrating paper_trades...");
	const paperTrades = sqlite.query("SELECT * FROM paper_trades").all() as Array<{
		id: string;
		market_id: string;
		window_start_ms: number;
		side: string;
		price: number;
		size: number;
		price_to_beat: number;
		current_price_at_entry: number | null;
		timestamp: string;
		resolved: number;
		won: number | null;
		pnl: number | null;
		settle_price: number | null;
	}>;

	for (const row of paperTrades) {
		await queries.paperTradeQueries.upsert({
			id: row.id,
			marketId: row.market_id,
			windowStartMs: row.window_start_ms,
			side: row.side,
			price: row.price,
			size: row.size,
			priceToBeat: row.price_to_beat,
			currentPriceAtEntry: row.current_price_at_entry,
			timestamp: row.timestamp,
			resolved: row.resolved,
			won: row.won,
			pnl: row.pnl,
			settlePrice: row.settle_price,
		});
	}
	console.log(`✓ Migrated ${paperTrades.length} paper trades`);

	// Migrate live_trades
	console.log("Migrating live_trades...");
	const liveTrades = sqlite.query("SELECT * FROM live_trades").all() as Array<{
		id: string;
		market_id: string;
		window_start_ms: number;
		side: string;
		price: number;
		size: number;
		price_to_beat: number;
		current_price_at_entry: number | null;
		timestamp: string;
		resolved: number;
		won: number | null;
		pnl: number | null;
		settle_price: number | null;
	}>;

	for (const row of liveTrades) {
		await queries.liveTradeQueries.upsert({
			id: row.id,
			marketId: row.market_id,
			windowStartMs: row.window_start_ms,
			side: row.side,
			price: row.price,
			size: row.size,
			priceToBeat: row.price_to_beat,
			currentPriceAtEntry: row.current_price_at_entry,
			timestamp: row.timestamp,
			resolved: row.resolved,
			won: row.won,
			pnl: row.pnl,
			settlePrice: row.settle_price,
		});
	}
	console.log(`✓ Migrated ${liveTrades.length} live trades`);

	// Migrate paper_state
	console.log("Migrating paper_state...");
	const paperState = sqlite.query("SELECT * FROM paper_state WHERE id = 1").get() as {
		initial_balance: number;
		current_balance: number;
		max_drawdown: number;
		wins: number;
		losses: number;
		total_pnl: number;
		stopped_at: string | null;
		stop_reason: string | null;
		daily_pnl: string;
		daily_counted_trade_ids: string;
	} | null;

	if (paperState) {
		await queries.stateQueries.upsertPaperState({
			id: 1,
			initialBalance: paperState.initial_balance,
			currentBalance: paperState.current_balance,
			maxDrawdown: paperState.max_drawdown,
			wins: paperState.wins,
			losses: paperState.losses,
			totalPnl: paperState.total_pnl,
			stoppedAt: paperState.stopped_at,
			stopReason: paperState.stop_reason,
			dailyPnl: paperState.daily_pnl,
			dailyCountedTradeIds: paperState.daily_counted_trade_ids,
		});
		console.log("✓ Migrated paper_state");
	}

	// Migrate live_state
	console.log("Migrating live_state...");
	const liveState = sqlite.query("SELECT * FROM live_state WHERE id = 1").get() as {
		initial_balance: number;
		current_balance: number;
		max_drawdown: number;
		wins: number;
		losses: number;
		total_pnl: number;
		stopped_at: string | null;
		stop_reason: string | null;
		daily_pnl: string;
		daily_counted_trade_ids: string;
	} | null;

	if (liveState) {
		await queries.stateQueries.upsertLiveState({
			id: 1,
			initialBalance: liveState.initial_balance,
			currentBalance: liveState.current_balance,
			maxDrawdown: liveState.max_drawdown,
			wins: liveState.wins,
			losses: liveState.losses,
			totalPnl: liveState.total_pnl,
			stoppedAt: liveState.stopped_at,
			stopReason: liveState.stop_reason,
			dailyPnl: liveState.daily_pnl,
			dailyCountedTradeIds: liveState.daily_counted_trade_ids,
		});
		console.log("✓ Migrated live_state");
	}

	// Migrate live_pending_orders
	console.log("Migrating live_pending_orders...");
	const pendingOrders = sqlite.query("SELECT * FROM live_pending_orders").all() as Array<{
		order_id: string;
		market_id: string;
		window_start_ms: number;
		side: string;
		price: number;
		size: number;
		price_to_beat: number | null;
		current_price_at_entry: number | null;
		token_id: string | null;
		placed_at: number;
		status: string;
	}>;

	for (const row of pendingOrders) {
		await queries.pendingOrderQueries.upsert({
			orderId: row.order_id,
			marketId: row.market_id,
			windowStartMs: row.window_start_ms,
			side: row.side,
			price: row.price,
			size: row.size,
			priceToBeat: row.price_to_beat,
			currentPriceAtEntry: row.current_price_at_entry,
			tokenId: row.token_id,
			placedAt: row.placed_at,
			status: row.status,
		});
	}
	console.log(`✓ Migrated ${pendingOrders.length} pending orders`);

	// Migrate known_ctf_tokens
	console.log("Migrating known_ctf_tokens...");
	const tokens = sqlite.query("SELECT * FROM known_ctf_tokens").all() as Array<{
		token_id: string;
		market_id: string;
		side: string;
		condition_id: string | null;
		first_seen_at: number;
	}>;

	for (const row of tokens) {
		await queries.onchainQueries.upsertKnownCtfToken({
			tokenId: row.token_id,
			marketId: row.market_id,
			side: row.side,
			conditionId: row.condition_id,
			firstSeenAt: row.first_seen_at,
		});
	}
	console.log(`✓ Migrated ${tokens.length} CTF tokens`);

	console.log("\n✅ Migration complete!");

	// Close connections
	sqlite.close();
	await client.end();
}

migrate().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
```

**Step 2: Run migration**

```bash
bun run scripts/migrate-to-postgres.ts
```

**Step 3: Verify data**

```bash
psql -h localhost -U orakel -d orakel -c "SELECT COUNT(*) as paper_trades FROM paper_trades;"
psql -h localhost -U orakel -d orakel -c "SELECT COUNT(*) as live_trades FROM live_trades;"
psql -h localhost -U orakel -d orakel -c "SELECT current_balance FROM live_state WHERE id = 1;"
```

**Step 4: Commit**

```bash
git add scripts/migrate-to-postgres.ts
git commit -m "db: add sqlite to postgres migration script"
```

---

## Task 7: Refactor Application Code

This is the largest task - replace all SQLite usage with Drizzle queries.

### Sub-task 7.1: Refactor accountStats.ts

**Files:**
- Modify: `src/trading/accountStats.ts`

Replace all `statements.*` calls with `queries.*` equivalents.

Key changes:
- `statements.getPaperState()` → `await stateQueries.getPaperState()`
- `statements.upsertPaperState().run()` → `await stateQueries.upsertPaperState()`
- `statements.insertPaperTrade().run()` → `await paperTradeQueries.upsert()`
- etc.

### Sub-task 7.2: Refactor orderManager.ts

**Files:**
- Modify: `src/trading/orderManager.ts`

Replace:
- `statements.upsertLivePendingOrder().run()` → `await pendingOrderQueries.upsert()`
- `statements.getAllLivePendingOrders()` → `await pendingOrderQueries.getAll()`
- etc.

### Sub-task 7.3: Refactor trader.ts

**Files:**
- Modify: `src/trading/trader.ts`

Replace on-chain statements with queries.

### Sub-task 7.4: Refactor reconciler.ts

**Files:**
- Modify: `src/blockchain/reconciler.ts`

Replace on-chain queries.

### Sub-task 7.5: Refactor api.ts

**Files:**
- Modify: `src/api.ts`

Remove any direct DB queries, use query layer.

### Sub-task 7.6: Refactor index.ts

**Files:**
- Modify: `src/index.ts`

Replace:
- `getDb()` → `testConnection()`
- `closeDb()` from `src/core/db.ts` → `closeDb()` from `src/db/index.ts`
- `onchainStatements.*` → `onchainQueries.*`

**Step 1: Update imports in index.ts**

Replace:
```typescript
import { backupDatabase, closeDb, getDb, onchainStatements, pruneDatabase, statements } from "./core/db.ts";
```

With:
```typescript
import { closeDb, testConnection } from "./db/index.ts";
import * as queries from "./db/queries.ts";
// Keep SQLite for backup compatibility or remove entirely
```

**Step 2: Update database initialization**

```typescript
// At startup
const dbConnected = await testConnection();
if (!dbConnected) {
	log.error("Failed to connect to PostgreSQL database");
	process.exit(1);
}
```

**Step 3: Update graceful shutdown**

Replace `closeDb()` call with new `closeDb()` from drizzle.

**Step 4: Commit**

```bash
git add src/
git commit -m "refactor: replace sqlite with postgres throughout codebase"
```

---

## Task 8: Remove SQLite Code

**Files:**
- Modify: `src/core/db.ts` - Keep for backup/legacy or remove entirely
- Modify: `package.json` - Remove bun:sqlite if not needed elsewhere

**Step 1: Decide on SQLite retention**

Option A: Keep SQLite for CSV export/backup
Option B: Remove entirely (cleaner)

**Step 2: If removing:**

```bash
# Remove imports
# Delete src/core/db.ts or keep minimal version
# Update all imports
```

**Step 3: Commit**

```bash
git add src/ package.json
git commit -m "cleanup: remove sqlite dependencies"
```

---

## Task 9: Testing

**Step 1: Run type check**

```bash
bun run typecheck
```

**Step 2: Run tests**

```bash
bun run test
```

**Step 3: Manual test**

```bash
bun run start
# Check bot starts without errors
# Check database connection
```

**Step 4: Verify data operations**

- Place a paper trade
- Check it appears in PostgreSQL
- Verify live trade flow works

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/database.md`

**Step 1: Update README with PostgreSQL setup**

```markdown
## Database Setup

This project uses PostgreSQL for data persistence.

### Local Development

```bash
# Start PostgreSQL
docker run -d \
  --name orakel-postgres \
  -e POSTGRES_USER=orakel \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=orakel \
  -p 5432:5432 \
  postgres:15

# Run migrations
bunx drizzle-kit migrate
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PGHOST | localhost | PostgreSQL host |
| PGPORT | 5432 | PostgreSQL port |
| PGUSER | orakel | Database user |
| PGPASSWORD | | Database password |
| PGDATABASE | orakel | Database name |
| PGSSL | false | Enable SSL |
```

**Step 2: Create database documentation**

Create: `docs/database.md`

Document:
- Schema overview
- Migration process
- Backup strategy
- Query patterns

**Step 3: Commit**

```bash
git add README.md docs/database.md
git commit -m "docs: update for postgres migration"
```

---

## Summary

| Task | Estimated Time | Priority |
|------|----------------|----------|
| 1. Install dependencies | 15 min | P0 |
| 2. Create Drizzle schema | 30 min | P0 |
| 3. Create database client | 20 min | P0 |
| 4. Create query layer | 1 hour | P0 |
| 5. Run migrations | 10 min | P0 |
| 6. Data migration | 30 min | P0 |
| 7. Refactor application | 4-6 hours | P0 |
| 8. Remove SQLite | 30 min | P1 |
| 9. Testing | 1 hour | P0 |
| 10. Documentation | 30 min | P1 |

**Total: 2-3 days**

---

## Rollback Plan

If issues occur:

1. Stop the bot
2. Restore SQLite database from backup
3. Revert git commits
4. Restart with SQLite version

---

## Execution Choice

**Plan complete and saved to `docs/plans/2025-03-06-postgres-migration.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach would you prefer?**
