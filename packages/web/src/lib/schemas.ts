import { z } from "zod";

export const TradeRecordSchema = z.object({
	id: z.number(),
	mode: z.enum(["paper", "live"]),
	windowSlug: z.string(),
	windowStartMs: z.number(),
	windowEndMs: z.number(),
	side: z.enum(["UP", "DOWN"]),
	price: z.string(),
	size: z.string(),
	priceToBeat: z.string(),
	entryBtcPrice: z.string(),
	edge: z.string(),
	modelProb: z.string(),
	marketProb: z.string(),
	phase: z.enum(["EARLY", "MID", "LATE"]),
	orderId: z.string().nullable(),
	outcome: z.enum(["WIN", "LOSS"]).nullable(),
	settleBtcPrice: z.string().nullable(),
	pnlUsdc: z.string().nullable(),
	createdAt: z.string(),
	settledAt: z.string().nullable(),
});

export const SignalRecordSchema = z.object({
	id: z.number(),
	windowSlug: z.string(),
	btcPrice: z.string(),
	priceToBeat: z.string(),
	deviation: z.string(),
	modelProbUp: z.string(),
	marketProbUp: z.string(),
	edgeUp: z.string(),
	edgeDown: z.string(),
	volatility: z.string(),
	timeLeftSeconds: z.number(),
	phase: z.enum(["EARLY", "MID", "LATE"]),
	decision: z.string(),
	reason: z.string().nullable(),
	timestamp: z.string(),
});

export type TradeRecordDto = z.infer<typeof TradeRecordSchema>;
export type SignalRecordDto = z.infer<typeof SignalRecordSchema>;
