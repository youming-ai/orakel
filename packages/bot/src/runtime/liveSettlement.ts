import { createLogger } from "../core/logger.ts";
import { getLiveBalance } from "../trading/liveTrader.ts";
import { settleDbTrade } from "../trading/persistence.ts";
import { runRedemption } from "./redeemer.ts";

const log = createLogger("live-settlement");

interface LiveSettlementContext {
	tradeId: number;
	entryPrice: number;
	size: number;
	side: "UP" | "DOWN";
	balanceBefore: number;
}

export async function settleLiveWindow(
	ctx: LiveSettlementContext,
	settlePrice: number,
	priceToBeat: number,
): Promise<{ ok: boolean; error?: string }> {
	log.info("Starting live settlement", { tradeId: ctx.tradeId, balanceBefore: ctx.balanceBefore });

	const won = (ctx.side === "UP" && settlePrice >= priceToBeat) || (ctx.side === "DOWN" && settlePrice < priceToBeat);

	const redeemResult = await runRedemption();
	if (!redeemResult.ok) {
		log.error("Redemption failed, using price-based fallback", { error: redeemResult.error });
		const pnlUsdc = won ? ctx.size * ((1 - ctx.entryPrice) / ctx.entryPrice) : -ctx.size;
		await settleDbTrade({
			tradeId: ctx.tradeId,
			outcome: won ? "WIN" : "LOSS",
			settleBtcPrice: settlePrice,
			pnlUsdc,
		});
		return { ok: true };
	}

	const balanceResult = await getLiveBalance();
	if (!balanceResult.ok || balanceResult.balance === undefined) {
		log.error("Failed to get balance after redemption, using price-based fallback", { error: balanceResult.error });
		const pnlUsdc = won ? ctx.size * ((1 - ctx.entryPrice) / ctx.entryPrice) : -ctx.size;
		await settleDbTrade({
			tradeId: ctx.tradeId,
			outcome: won ? "WIN" : "LOSS",
			settleBtcPrice: settlePrice,
			pnlUsdc,
		});
		return { ok: true };
	}

	const pnlUsdc = balanceResult.balance - ctx.balanceBefore;

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

	return { ok: true };
}
