import { sql } from "drizzle-orm";
import { integer, pgTable, primaryKey, real, serial, text, unique } from "drizzle-orm/pg-core";

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
	windowStartMs: integer("window_start_ms"),
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
	createdAt: integer("created_at").default(sql`floor(extract(epoch from now()))`),
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
	}),
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

export const balanceSnapshots = pgTable("balance_snapshots", {
	id: serial("id").primaryKey(),
	usdcBalance: text("usdc_balance").notNull(),
	usdcFormatted: real("usdc_formatted").notNull(),
	positionsJson: text("positions_json").notNull().default("[]"),
	blockNumber: integer("block_number"),
	createdAt: integer("created_at").default(sql`floor(extract(epoch from now()))`),
});

export const knownCtfTokens = pgTable("known_ctf_tokens", {
	tokenId: text("token_id").primaryKey(),
	marketId: text("market_id").notNull(),
	side: text("side").notNull(),
	conditionId: text("condition_id"),
	firstSeenAt: integer("first_seen_at").default(sql`floor(extract(epoch from now()))`),
});
