import { z } from "zod";

export const StrategyConfigSchema = z.object({
	edgeThresholdEarly: z.number(),
	edgeThresholdMid: z.number(),
	edgeThresholdLate: z.number(),
	phaseEarlySeconds: z.number().int().positive(),
	phaseLateSeconds: z.number().int().positive(),
	sigmoidScale: z.number().positive(),
	minVolatility: z.number().positive(),
	maxEntryPrice: z.number().min(0).max(1),
	minTimeLeftSeconds: z.number().int().nonnegative(),
	maxTimeLeftSeconds: z.number().int().positive(),
});

export const RiskConfigSchema = z.object({
	maxTradeSizeUsdc: z.number().positive(),
	dailyMaxLossUsdc: z.number().positive(),
	maxOpenPositions: z.number().int().positive(),
	maxTradesPerWindow: z.number().int().positive(),
});

export const ExecutionConfigSchema = z.object({
	orderType: z.string(),
	limitDiscount: z.number().min(0).max(1),
	minOrderPrice: z.number().min(0).max(1),
	maxOrderPrice: z.number().min(0).max(1),
});

export const InfraConfigSchema = z.object({
	pollIntervalMs: z.number().int().positive(),
	cliTimeoutMs: z.number().int().positive(),
	cliRetries: z.number().int().nonnegative(),
	chainlinkWssUrls: z.array(z.string().url()),
	chainlinkHttpUrl: z.string().url(),
	chainlinkAggregator: z.string().startsWith("0x"),
	chainlinkDecimals: z.number().int().positive(),
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
	strategy: StrategyConfigSchema.partial().optional(),
	risk: z
		.object({
			paper: RiskConfigSchema.partial().optional(),
			live: RiskConfigSchema.partial().optional(),
		})
		.optional(),
});

export const ControlRequestSchema = z.object({
	mode: z.enum(["paper", "live"]),
});
