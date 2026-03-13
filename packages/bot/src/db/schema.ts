import { bigint, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const trades = pgTable("trades_v2", {
	id: serial("id").primaryKey(),
	mode: text("mode").notNull(), // "paper" | "live"
	windowSlug: text("window_slug").notNull(),
	windowStartMs: bigint("window_start_ms", { mode: "number" }).notNull(),
	windowEndMs: bigint("window_end_ms", { mode: "number" }).notNull(),
	side: text("side").notNull(), // "UP" | "DOWN"
	price: numeric("price", { precision: 10, scale: 4 }).notNull(),
	size: numeric("size", { precision: 10, scale: 2 }).notNull(),
	priceToBeat: numeric("price_to_beat", { precision: 16, scale: 2 }).notNull(),
	entryBtcPrice: numeric("entry_btc_price", { precision: 16, scale: 2 }).notNull(),
	edge: numeric("edge", { precision: 10, scale: 6 }).notNull(),
	modelProb: numeric("model_prob", { precision: 10, scale: 6 }).notNull(),
	marketProb: numeric("market_prob", { precision: 10, scale: 6 }).notNull(),
	phase: text("phase").notNull(), // "EARLY" | "MID" | "LATE"
	orderId: text("order_id"),
	outcome: text("outcome"), // "WIN" | "LOSS" | null
	settleBtcPrice: numeric("settle_btc_price", { precision: 16, scale: 2 }),
	pnlUsdc: numeric("pnl_usdc", { precision: 10, scale: 4 }),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	settledAt: timestamp("settled_at"),
});

export const signals = pgTable("signals_v2", {
	id: serial("id").primaryKey(),
	windowSlug: text("window_slug").notNull(),
	timestamp: timestamp("timestamp").defaultNow().notNull(),
	btcPrice: numeric("btc_price", { precision: 16, scale: 2 }).notNull(),
	priceToBeat: numeric("price_to_beat", { precision: 16, scale: 2 }).notNull(),
	deviation: numeric("deviation", { precision: 12, scale: 8 }).notNull(),
	modelProbUp: numeric("model_prob_up", { precision: 10, scale: 6 }).notNull(),
	marketProbUp: numeric("market_prob_up", { precision: 10, scale: 6 }).notNull(),
	edgeUp: numeric("edge_up", { precision: 10, scale: 6 }).notNull(),
	edgeDown: numeric("edge_down", { precision: 10, scale: 6 }).notNull(),
	volatility: numeric("volatility", { precision: 12, scale: 8 }).notNull(),
	timeLeftSeconds: integer("time_left_seconds").notNull(),
	phase: text("phase").notNull(),
	decision: text("decision").notNull(), // "ENTER_UP" | "ENTER_DOWN" | "SKIP"
	reason: text("reason"),
});

export const balanceSnapshots = pgTable("balance_snapshots_v2", {
	id: serial("id").primaryKey(),
	mode: text("mode").notNull(),
	balanceUsdc: numeric("balance_usdc", { precision: 12, scale: 4 }).notNull(),
	totalPnl: numeric("total_pnl", { precision: 12, scale: 4 }).notNull(),
	winCount: integer("win_count").notNull(),
	lossCount: integer("loss_count").notNull(),
	snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
});
