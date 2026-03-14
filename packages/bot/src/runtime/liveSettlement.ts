import { createLogger } from "../core/logger.ts";
import { getLiveBalance } from "../trading/liveTrader.ts";
import { settleDbTrade } from "../trading/persistence.ts";
import { computeBinaryPnl } from "../trading/pnl.ts";
import { runRedemption } from "./redeemer.ts";

const log = createLogger("live-settlement");

export class SettlementError extends Error {
	constructor(
		message: string,
		public readonly code: "REDEMPTION_FAILED" | "BALANCE_FETCH_FAILED" | "DB_UPDATE_FAILED",
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "SettlementError";
	}
}

interface LiveSettlementContext {
	tradeId: number;
	entryPrice: number;
	size: number;
	side: "UP" | "DOWN";
	balanceBefore: number;
}

interface SettlementResult {
	ok: boolean;
	pnlUsdc?: number;
	error?: string;
	method: "balance_diff" | "price_fallback";
}

export async function settleLiveWindow(
	ctx: LiveSettlementContext,
	settlePrice: number,
	priceToBeat: number,
): Promise<SettlementResult> {
	log.info("Starting live settlement", { tradeId: ctx.tradeId, balanceBefore: ctx.balanceBefore });

	const won = (ctx.side === "UP" && settlePrice >= priceToBeat) || (ctx.side === "DOWN" && settlePrice < priceToBeat);

	// Attempt redemption with retry
	let redeemResult = await runRedemption();
	if (!redeemResult.ok) {
		log.error("Redemption failed, retrying once", { error: redeemResult.error });
		await new Promise((resolve) => setTimeout(resolve, 2000));
		redeemResult = await runRedemption();
	}

	if (!redeemResult.ok) {
		log.error("Redemption failed after retry, using price-based fallback", { error: redeemResult.error });
		const pnlUsdc = computeBinaryPnl(ctx.size, ctx.entryPrice, won);

		try {
			await settleDbTrade({
				tradeId: ctx.tradeId,
				outcome: won ? "WIN" : "LOSS",
				settleBtcPrice: settlePrice,
				pnlUsdc,
			});

			log.warn("Settlement completed with price fallback", {
				tradeId: ctx.tradeId,
				pnlUsdc,
				redemptionError: redeemResult.error,
			});

			return { ok: true, pnlUsdc, method: "price_fallback" };
		} catch (dbErr) {
			const error = new SettlementError(
				`DB update failed after redemption failure: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
				"DB_UPDATE_FAILED",
				dbErr,
			);
			log.error("Critical: Settlement failed completely", { tradeId: ctx.tradeId, error });
			throw error;
		}
	}

	const balanceResult = await getLiveBalance();
	if (!balanceResult.ok || balanceResult.balance === undefined) {
		const error = new SettlementError(
			`Failed to get balance after redemption: ${balanceResult.error}`,
			"BALANCE_FETCH_FAILED",
		);
		log.error("Cannot complete settlement", { tradeId: ctx.tradeId, error });
		throw error;
	}

	const pnlUsdc = balanceResult.balance - ctx.balanceBefore;

	try {
		await settleDbTrade({
			tradeId: ctx.tradeId,
			outcome: pnlUsdc > 0 ? "WIN" : "LOSS",
			settleBtcPrice: settlePrice,
			pnlUsdc,
		});

		log.info("Live settlement completed", {
			tradeId: ctx.tradeId,
			balanceBefore: ctx.balanceBefore,
			balanceAfter: balanceResult.balance,
			pnlUsdc: pnlUsdc.toFixed(4),
			outcome: pnlUsdc > 0 ? "WIN" : "LOSS",
		});

		return { ok: true, pnlUsdc, method: "balance_diff" };
	} catch (dbErr) {
		const error = new SettlementError(
			`DB update failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
			"DB_UPDATE_FAILED",
			dbErr,
		);
		log.error("Critical: Settlement DB update failed", { tradeId: ctx.tradeId, error });
		throw error;
	}
}
