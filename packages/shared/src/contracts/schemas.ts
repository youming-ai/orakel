import { z } from "zod";

// Trade Record Schema
export const TradeRecordSchema = z.object({
	id: z.number().int().positive(),
	mode: z.enum(["paper", "live"]),
	windowSlug: z.string().min(1),
	windowStartMs: z.number().int().positive(),
	windowEndMs: z.number().int().positive(),
	side: z.enum(["UP", "DOWN"]),
	price: z.string().regex(/^\d+\.?\d*$/),
	size: z.string().regex(/^\d+\.?\d*$/),
	priceToBeat: z.string().regex(/^\d+\.?\d*$/),
	entryBtcPrice: z.string().regex(/^\d+\.?\d*$/),
	edge: z.string().regex(/^-?\d+\.?\d*$/),
	modelProb: z.string().regex(/^\d+\.?\d*$/),
	marketProb: z.string().regex(/^\d+\.?\d*$/),
	phase: z.enum(["EARLY", "MID", "LATE"]),
	orderId: z.string().nullable(),
	outcome: z.enum(["WIN", "LOSS"]).nullable(),
	settleBtcPrice: z.string().nullable(),
	pnlUsdc: z.string().nullable(),
	createdAt: z.string().datetime(),
	settledAt: z.string().datetime().nullable(),
});

// Signal Record Schema
export const SignalRecordSchema = z.object({
	id: z.number().int().positive(),
	windowSlug: z.string().min(1),
	btcPrice: z.string().regex(/^\d+\.?\d*$/),
	priceToBeat: z.string().regex(/^\d+\.?\d*$/),
	deviation: z.string().regex(/^-?\d+\.?\d*$/),
	modelProbUp: z.string().regex(/^\d+\.?\d*$/),
	marketProbUp: z.string().regex(/^\d+\.?\d*$/),
	edgeUp: z.string().regex(/^-?\d+\.?\d*$/),
	edgeDown: z.string().regex(/^-?\d+\.?\d*$/),
	volatility: z.string().regex(/^\d+\.?\d*$/),
	timeLeftSeconds: z.number().int().nonnegative(),
	phase: z.enum(["EARLY", "MID", "LATE"]),
	decision: z.string().min(1),
	reason: z.string().nullable(),
	timestamp: z.string().datetime(),
});

// Stats DTO Schema
export const StatsDtoSchema = z.object({
	paper: z.object({
		totalTrades: z.number().int().nonnegative(),
		wins: z.number().int().nonnegative(),
		totalPnl: z.number(),
	}),
	live: z.object({
		totalTrades: z.number().int().nonnegative(),
		wins: z.number().int().nonnegative(),
		totalPnl: z.number(),
	}),
});

// Status DTO Schema
export const StatusDtoSchema = z.object({
	paperRunning: z.boolean(),
	liveRunning: z.boolean(),
	paperPendingStart: z.boolean(),
	paperPendingStop: z.boolean(),
	livePendingStart: z.boolean(),
	livePendingStop: z.boolean(),
	currentWindow: z.any().nullable(),
	btcPrice: z.number().nullable(),
	btcPriceAgeMs: z.number().nullable(),
	cliAvailable: z.boolean(),
	dbConnected: z.boolean(),
	uptimeMs: z.number().int().nonnegative(),
});

// Control Response Schema
export const ControlResponseSchema = z.object({
	ok: z.boolean(),
	message: z.string(),
	state: z.object({
		paperRunning: z.boolean(),
		liveRunning: z.boolean(),
	}),
});

// Error Response Schema
export const ErrorResponseSchema = z.object({
	ok: z.literal(false),
	error: z.string(),
});

// Api Response Union helper
export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
	z.union([z.object({ ok: z.literal(true), data: dataSchema }), ErrorResponseSchema]);

export const StrategyConfigSchema = z
	.object({
		edgeThresholdEarly: z.number().min(0).max(1),
		edgeThresholdMid: z.number().min(0).max(1),
		edgeThresholdLate: z.number().min(0).max(1),
		phaseEarlySeconds: z.number().int().positive(),
		phaseLateSeconds: z.number().int().positive(),
		sigmoidScale: z.number().positive(),
		minVolatility: z.number().positive(),
		maxEntryPrice: z.number().min(0).max(1),
		minTimeLeftSeconds: z.number().int().nonnegative(),
		maxTimeLeftSeconds: z.number().int().positive(),
	})
	.refine(
		(data) => data.edgeThresholdEarly >= data.edgeThresholdMid && data.edgeThresholdMid >= data.edgeThresholdLate,
		{
			message: "Edge thresholds must be ordered: Early >= Mid >= Late",
			path: ["edgeThresholdEarly"],
		},
	)
	.refine((data) => data.phaseEarlySeconds > data.phaseLateSeconds, {
		message: "phaseEarlySeconds must be greater than phaseLateSeconds",
		path: ["phaseEarlySeconds"],
	})
	.refine((data) => data.minTimeLeftSeconds <= data.maxTimeLeftSeconds, {
		message: "minTimeLeftSeconds must be <= maxTimeLeftSeconds",
		path: ["minTimeLeftSeconds"],
	});

export const RiskConfigSchema = z.object({
	maxTradeSizeUsdc: z.number().positive(),
	dailyMaxLossUsdc: z.number().positive(),
	maxOpenPositions: z.number().int().positive(),
	maxTradesPerWindow: z.number().int().positive(),
});

export const ExecutionConfigSchema = z
	.object({
		orderType: z.enum(["GTC", "GTD", "FOK", "MARKET"]),
		limitDiscount: z.number().min(0).max(1),
		minOrderPrice: z.number().min(0).max(1),
		maxOrderPrice: z.number().min(0).max(1),
	})
	.refine((data) => data.minOrderPrice < data.maxOrderPrice, {
		message: "minOrderPrice must be less than maxOrderPrice",
		path: ["minOrderPrice"],
	});

export const InfraConfigSchema = z.object({
	pollIntervalMs: z.number().int().positive(),
	cliTimeoutMs: z.number().int().positive(),
	cliRetries: z.number().int().nonnegative(),
	binanceRestUrl: z.string().url(),
	binanceWsUrl: z.string(),
	bybitRestUrl: z.string().url(),
	bybitWsUrl: z.string(),
	polymarketGammaUrl: z.string().url(),
	polymarketClobUrl: z.string().url(),
	polymarketClobWsUrl: z.string(),
	slugPrefix: z.string(),
	windowSeconds: z.number().int().positive(),
});

export const MaintenanceConfigSchema = z.object({
	signalLogRetentionDays: z.number().int().positive(),
	pruneIntervalMs: z.number().int().positive(),
	redeemIntervalMs: z.number().int().positive(),
});

export const AppConfigSchema = z.object({
	strategy: StrategyConfigSchema,
	risk: z.object({
		paper: RiskConfigSchema,
		live: RiskConfigSchema,
	}),
	execution: ExecutionConfigSchema,
	infra: InfraConfigSchema,
	maintenance: MaintenanceConfigSchema,
});

export const ConfigUpdateSchema = z.object({
	strategy: z
		.object({
			edgeThresholdEarly: z.number().min(0).max(1).optional(),
			edgeThresholdMid: z.number().min(0).max(1).optional(),
			edgeThresholdLate: z.number().min(0).max(1).optional(),
			phaseEarlySeconds: z.number().int().positive().optional(),
			phaseLateSeconds: z.number().int().positive().optional(),
			sigmoidScale: z.number().positive().optional(),
			minVolatility: z.number().positive().optional(),
			maxEntryPrice: z.number().min(0).max(1).optional(),
			minTimeLeftSeconds: z.number().int().nonnegative().optional(),
			maxTimeLeftSeconds: z.number().int().positive().optional(),
		})
		.optional(),
	risk: z
		.object({
			paper: z
				.object({
					maxTradeSizeUsdc: z.number().positive().optional(),
					dailyMaxLossUsdc: z.number().positive().optional(),
					maxOpenPositions: z.number().int().positive().optional(),
					maxTradesPerWindow: z.number().int().positive().optional(),
				})
				.optional(),
			live: z
				.object({
					maxTradeSizeUsdc: z.number().positive().optional(),
					dailyMaxLossUsdc: z.number().positive().optional(),
					maxOpenPositions: z.number().int().positive().optional(),
					maxTradesPerWindow: z.number().int().positive().optional(),
				})
				.optional(),
		})
		.optional(),
});

export const ControlRequestSchema = z.object({
	mode: z.enum(["paper", "live"]),
});
