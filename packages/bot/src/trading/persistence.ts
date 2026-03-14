import { eq } from "drizzle-orm";
import { createLogger } from "../core/logger.ts";
import { getDb } from "../db/client.ts";
import { signals, trades } from "../db/schema.ts";

const log = createLogger("persistence");

export class PersistenceError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "PersistenceError";
	}
}

export async function persistSignal(data: {
	windowSlug: string;
	btcPrice: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edgeUp: number;
	edgeDown: number;
	volatility: number;
	timeLeftSeconds: number;
	phase: string;
	decision: string;
	reason: string | null;
}): Promise<void> {
	try {
		const db = getDb();
		await db.insert(signals).values({
			windowSlug: data.windowSlug,
			btcPrice: String(data.btcPrice),
			priceToBeat: String(data.priceToBeat),
			deviation: String(data.deviation),
			modelProbUp: String(data.modelProbUp),
			marketProbUp: String(data.marketProbUp),
			edgeUp: String(data.edgeUp),
			edgeDown: String(data.edgeDown),
			volatility: String(data.volatility),
			timeLeftSeconds: data.timeLeftSeconds,
			phase: data.phase,
			decision: data.decision,
			reason: data.reason,
		});
	} catch (err) {
		log.warn("Failed to persist signal", { error: err instanceof Error ? err.message : String(err) });
	}
}

export async function persistTrade(data: {
	mode: string;
	windowSlug: string;
	windowStartMs: number;
	windowEndMs: number;
	side: string;
	price: number;
	size: number;
	priceToBeat: number;
	entryBtcPrice: number;
	edge: number;
	modelProb: number;
	marketProb: number;
	phase: string;
	orderId: string | null;
}): Promise<number> {
	try {
		const db = getDb();
		const result = await db
			.insert(trades)
			.values({
				mode: data.mode,
				windowSlug: data.windowSlug,
				windowStartMs: data.windowStartMs,
				windowEndMs: data.windowEndMs,
				side: data.side,
				price: String(data.price),
				size: String(data.size),
				priceToBeat: String(data.priceToBeat),
				entryBtcPrice: String(data.entryBtcPrice),
				edge: String(data.edge),
				modelProb: String(data.modelProb),
				marketProb: String(data.marketProb),
				phase: data.phase,
				orderId: data.orderId,
			})
			.returning({ id: trades.id });

		const tradeId = result[0]?.id;
		if (!tradeId) {
			throw new PersistenceError("Failed to get trade ID after insert");
		}

		log.info("Trade persisted", { tradeId, mode: data.mode, windowSlug: data.windowSlug });
		return tradeId;
	} catch (err) {
		log.error("Failed to persist trade", { error: err instanceof Error ? err.message : String(err), data });
		throw new PersistenceError("Trade persistence failed", err);
	}
}

export async function settleDbTrade(data: {
	tradeId: number;
	outcome: "WIN" | "LOSS";
	settleBtcPrice: number;
	pnlUsdc: number;
}): Promise<void> {
	try {
		const db = getDb();
		await db
			.update(trades)
			.set({
				outcome: data.outcome,
				settleBtcPrice: String(data.settleBtcPrice),
				pnlUsdc: String(data.pnlUsdc),
				settledAt: new Date(),
			})
			.where(eq(trades.id, data.tradeId));
		log.info("Trade settled in DB", { tradeId: data.tradeId, outcome: data.outcome, pnl: data.pnlUsdc.toFixed(4) });
	} catch (err) {
		log.warn("Failed to settle trade in DB", { error: err instanceof Error ? err.message : String(err) });
	}
}
