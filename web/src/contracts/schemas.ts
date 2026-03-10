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

export const DailySummarySchema = z.object({
	date: z.string(),
	pnl: z.number(),
	trades: z.number(),
});

export const WalletStatusSchema = z.object({
	address: z.string().nullable(),
	connected: z.boolean(),
});

export const LiveWalletSchema = z.object({
	address: z.string().nullable(),
	connected: z.boolean(),
	clientReady: z.boolean(),
});

export const RiskConfigSchema = z.object({
	maxTradeSizeUsdc: z.number(),
	limitDiscount: z.number(),
	dailyMaxLossUsdc: z.number(),
	maxOpenPositions: z.number(),
	minLiquidity: z.number(),
	maxTradesPerWindow: z.number(),
	paperSlippage: z.number().optional(),
});

export const ConfigSnapshotSchema = z.object({
	strategy: z.record(z.string(), z.unknown()),
	paperRisk: RiskConfigSchema,
	liveRisk: RiskConfigSchema,
});

export const ConfidenceSchema = z.object({
	score: z.number(),
	factors: z.object({
		indicatorAlignment: z.number(),
		volatilityScore: z.number(),
		orderbookScore: z.number(),
		timingScore: z.number(),
		regimeScore: z.number(),
	}),
	level: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

export const MacdSchema = z.object({
	macd: z.number(),
	signal: z.number(),
	hist: z.number(),
	histDelta: z.number().nullable(),
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
	rawSum: z.number().nullable(),
	arbitrage: z.boolean(),
	predictLong: z.number().nullable(),
	predictShort: z.number().nullable(),
	predictDirection: z.enum(["LONG", "SHORT", "NEUTRAL"]),
	haColor: z.string().nullable(),
	haConsecutive: z.number(),
	rsi: z.number().nullable(),
	macd: MacdSchema.nullable(),
	vwapSlope: z.number().nullable(),
	timeLeftMin: z.number().nullable(),
	phase: z.string().nullable(),
	action: z.string(),
	side: z.string().nullable(),
	edge: z.number().nullable(),
	strength: z.string().nullable(),
	reason: z.string().nullable(),
	volatility15m: z.number().nullable(),
	blendSource: z.string().nullable(),
	volImpliedUp: z.number().nullable(),
	binanceChainlinkDelta: z.number().nullable(),
	orderbookImbalance: z.number().nullable(),
	confidence: ConfidenceSchema.optional(),
});

export const PaperStatsSchema = z.object({
	totalTrades: z.number(),
	wins: z.number(),
	losses: z.number(),
	pending: z.number(),
	winRate: z.number(),
	totalPnl: z.number(),
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

export const DashboardStateSchema = z.object({
	markets: z.array(MarketSnapshotSchema),
	updatedAt: z.string(),
	paperMode: z.boolean(),
	wallet: WalletStatusSchema,
	paperDaily: DailySummarySchema,
	liveDaily: DailySummarySchema,
	config: ConfigSnapshotSchema,
	paperRunning: z.boolean(),
	liveRunning: z.boolean(),
	paperStats: PaperStatsSchema.nullable(),
	liveStats: PaperStatsSchema.nullable(),
	liveWallet: LiveWalletSchema,
	paperPendingStart: z.boolean(),
	paperPendingStop: z.boolean(),
	livePendingStart: z.boolean(),
	livePendingStop: z.boolean(),
	paperPendingSince: z.number().nullable(),
	livePendingSince: z.number().nullable(),
	stopLoss: StopLossStatusSchema.nullable(),
	liveStopLoss: StopLossStatusSchema.nullable(),
	todayStats: TodayStatsSchema,
	liveTodayStats: TodayStatsSchema,
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

export const OkResponseSchema = z.object({
	ok: z.boolean(),
});

export const WsEventTypeSchema = z.enum(["state:snapshot", "signal:new", "trade:executed", "balance:snapshot"]);

export const StateSnapshotPayloadSchema = z.object({
	markets: z.array(MarketSnapshotSchema),
	updatedAt: z.string(),
	paperRunning: z.boolean(),
	liveRunning: z.boolean(),
	paperPendingStart: z.boolean(),
	paperPendingStop: z.boolean(),
	livePendingStart: z.boolean(),
	livePendingStop: z.boolean(),
	paperPendingSince: z.number().nullable(),
	livePendingSince: z.number().nullable(),
	paperStats: PaperStatsSchema.nullable(),
	liveStats: PaperStatsSchema.nullable(),
	liveTodayStats: TodayStatsSchema.nullable(),
	todayStats: TodayStatsSchema.optional(),
	stopLoss: StopLossStatusSchema.nullable().optional(),
	liveStopLoss: StopLossStatusSchema.nullable().optional(),
});

export const SignalNewPayloadSchema = z.object({
	marketId: z.string(),
	timestamp: z.string(),
	regime: z.string().nullable(),
	signal: z.enum(["ENTER", "HOLD"]),
	modelUp: z.number(),
	modelDown: z.number(),
	edgeUp: z.number().nullable(),
	edgeDown: z.number().nullable(),
	recommendation: z.string().nullable(),
});

export const TradeExecutedPayloadSchema = z.object({
	marketId: z.string(),
	mode: z.enum(["paper", "live"]),
	side: z.enum(["UP", "DOWN"]),
	price: z.number(),
	size: z.number(),
	timestamp: z.string(),
	orderId: z.string(),
	status: z.string(),
});

export const CtfPositionSchema = z.object({
	tokenId: z.string(),
	balance: z.string(),
	marketId: z.string().nullable(),
	side: z.string().nullable(),
});

export const BalanceSnapshotPayloadSchema = z.object({
	usdcBalance: z.number(),
	usdcRaw: z.string(),
	positions: z.array(CtfPositionSchema),
	blockNumber: z.number(),
	timestamp: z.number(),
});

export const StateSnapshotMessageSchema = z.object({
	type: z.literal("state:snapshot"),
	data: StateSnapshotPayloadSchema,
	ts: z.number(),
	version: z.number(),
});

export const SignalNewMessageSchema = z.object({
	type: z.literal("signal:new"),
	data: SignalNewPayloadSchema,
	ts: z.number(),
	version: z.number(),
});

export const TradeExecutedMessageSchema = z.object({
	type: z.literal("trade:executed"),
	data: TradeExecutedPayloadSchema,
	ts: z.number(),
	version: z.number(),
});

export const BalanceSnapshotMessageSchema = z.object({
	type: z.literal("balance:snapshot"),
	data: BalanceSnapshotPayloadSchema,
	ts: z.number(),
	version: z.number(),
});

export const WsMessageSchema = z.discriminatedUnion("type", [
	StateSnapshotMessageSchema,
	SignalNewMessageSchema,
	TradeExecutedMessageSchema,
	BalanceSnapshotMessageSchema,
]);
