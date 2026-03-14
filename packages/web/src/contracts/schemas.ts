import { z } from "zod";

export const StopLossStatusSchema = z.object({
	stoppedAt: z.string().nullable(),
	reason: z.string().nullable(),
});

export const TodayStatsSchema = z.object({
	pnl: z.number(),
	trades: z.number(),
	limit: z.number(),
});

export const ConfidenceSchema = z.object({
	score: z.number(),
	level: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

export const MarketSnapshotSchema = z.object({
	id: z.string(),
	label: z.string(),
	ok: z.boolean(),
	error: z.string().optional(),
	spotPrice: z.number().nullable(),
	currentPrice: z.number().nullable(),
	priceToBeat: z.number().nullable(),
	marketUp: z.number().nullable(),
	marketDown: z.number().nullable(),
	predictLong: z.number().nullable(),
	predictShort: z.number().nullable(),
	predictDirection: z.enum(["LONG", "SHORT", "NEUTRAL"]),
	timeLeftMin: z.number().nullable(),
	phase: z.string().nullable(),
	action: z.string(),
	side: z.string().nullable(),
	edge: z.number().nullable(),
	reason: z.string().nullable(),
	volatility15m: z.number().nullable(),
	spotDelta: z.number().nullable(),
	confidence: ConfidenceSchema.optional(),
});

export const PaperStatsSchema = z.object({
	totalTrades: z.number(),
	wins: z.number(),
	losses: z.number(),
	pending: z.number(),
	winRate: z.number(),
	totalPnl: z.number(),
	todayPnl: z.number(),
	todayTrades: z.number(),
	dailyMaxLoss: z.number(),
	balanceUsdc: z.number(),
});

export const PaperTradeEntrySchema = z.object({
	id: z.string(),
	marketId: z.string(),
	windowStartMs: z.number(),
	side: z.enum(["UP", "DOWN"]),
	price: z.number(),
	size: z.number(),
	priceToBeat: z.number(),
	currentPriceAtEntry: z.number().nullable(),
	timestamp: z.string(),
	resolved: z.boolean(),
	won: z.boolean().nullable(),
	pnl: z.number().nullable(),
	settlePrice: z.number().nullable(),
});

export const MarketBreakdownSchema = z.object({
	wins: z.number(),
	losses: z.number(),
	pending: z.number(),
	winRate: z.number(),
	totalPnl: z.number(),
	tradeCount: z.number(),
});

export const PaperStatsResponseSchema = z.object({
	stats: PaperStatsSchema,
	trades: z.array(PaperTradeEntrySchema),
	byMarket: z.record(z.string(), MarketBreakdownSchema),
	stopLoss: StopLossStatusSchema.nullable(),
	todayStats: TodayStatsSchema,
});

export const TradeRecordSchema = z.object({
	timestamp: z.string(),
	market: z.string(),
	marketSlug: z.string().nullable(),
	side: z.string(),
	amount: z.string(),
	price: z.string(),
	orderId: z.string(),
	status: z.string(),
	mode: z.string(),
	pnl: z.number().nullable(),
	won: z.number().nullable(),
	currentPriceAtEntry: z.number().nullable(),
});

export const DashboardStateSchema = z.object({
	markets: z.array(MarketSnapshotSchema),
	updatedAt: z.string(),
	paperRunning: z.boolean(),
	liveRunning: z.boolean(),
	paperPendingStart: z.boolean(),
	paperPendingStop: z.boolean(),
	livePendingStart: z.boolean(),
	livePendingStop: z.boolean(),
	paperStats: PaperStatsSchema.nullable().optional(),
	liveStats: PaperStatsSchema.nullable().optional(),
	todayStats: TodayStatsSchema.optional(),
	liveTodayStats: TodayStatsSchema.optional(),
});

export const OkResponseSchema = z.object({
	ok: z.boolean(),
});

export const WsMessageSchema = z.object({
	type: z.enum(["state:snapshot", "signal:new", "trade:executed", "balance:snapshot"]),
	data: z.unknown(),
	ts: z.number(),
});
