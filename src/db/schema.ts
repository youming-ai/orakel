import { sql } from "drizzle-orm";
import { bigint, integer, pgTable, primaryKey, real, serial, text, unique } from "drizzle-orm/pg-core";

export const schemaMigrations = pgTable("schema_migrations", {
	version: integer("version").primaryKey(),
	appliedAt: integer("applied_at").notNull(),
});

export const trades = pgTable("trades", {
	id: serial("id").primaryKey(),
	tradeId: text("trade_id").unique(),
	timestamp: text("timestamp").notNull(),
	market: text("market").notNull(),
	side: text("side").notNull(),
	amount: real("amount").notNull(),
	price: real("price").notNull(),
	orderId: text("order_id"),
	status: text("status"),
	mode: text("mode").notNull(),
	windowStartMs: bigint("window_start_ms", { mode: "number" }),
	priceToBeat: real("price_to_beat"),
	resolved: integer("resolved").default(0),
	settlePrice: real("settle_price"),
	pnl: real("pnl"),
	won: integer("won"),
	createdAt: integer("created_at").default(sql`floor(extract(epoch from now()))`),
	txHash: text("tx_hash"),
	blockNumber: integer("block_number"),
	logIndex: integer("log_index"),
	onchainUsdcDelta: real("onchain_usdc_delta"),
	onchainTokenId: text("onchain_token_id"),
	onchainTokenDelta: real("onchain_token_delta"),
	reconStatus: text("recon_status").default("unreconciled"),
	reconConfidence: real("recon_confidence"),
	currentPriceAtEntry: real("current_price_at_entry"),
	marketSlug: text("market_slug"),
});

export const botState = pgTable(
	"bot_state",
	{
		mode: text("mode").notNull(),
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
	},
	(table) => ({
		pk: primaryKey({ columns: [table.mode] }),
	}),
);

export const kvStore = pgTable("kv_store", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

export const livePendingOrders = pgTable("live_pending_orders", {
	orderId: text("order_id").primaryKey(),
	marketId: text("market_id").notNull(),
	marketSlug: text("market_slug"),
	windowStartMs: bigint("window_start_ms", { mode: "number" }).notNull(),
	side: text("side").notNull(),
	price: real("price").notNull(),
	size: real("size").notNull(),
	priceToBeat: real("price_to_beat"),
	currentPriceAtEntry: real("current_price_at_entry"),
	tokenId: text("token_id"),
	placedAt: bigint("placed_at", { mode: "number" }).notNull(),
	status: text("status").notNull().default("placed"),
	createdAt: integer("created_at").default(sql`floor(extract(epoch from now()))`),
});

export const onchainEvents = pgTable(
	"onchain_events",
	{
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
		createdAt: integer("created_at").default(sql`floor(extract(epoch from now()))`),
	},
	(table) => ({
		uniqueTxLog: unique().on(table.txHash, table.logIndex),
	}),
);

export const knownCtfTokens = pgTable("known_ctf_tokens", {
	tokenId: text("token_id").primaryKey(),
	marketId: text("market_id").notNull(),
	side: text("side").notNull(),
	conditionId: text("condition_id"),
	firstSeenAt: integer("first_seen_at").default(sql`floor(extract(epoch from now()))`),
});
