import { OrderType, Side } from "@polymarket/clob-client";
import { enrichPosition } from "../blockchain/accountState.ts";
import { CONFIG } from "../core/config.ts";
import type { MarketConfig, RiskConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import { getCandleWindowTiming } from "../core/utils.ts";
import { onchainQueries, pendingOrderQueries } from "../db/queries.ts";
import { getAccount } from "./accountStats.ts";
import {
	canTrade,
	emitTradeExecuted,
	registerOpenGtdOrder,
	startHeartbeat,
	withTradeLock,
} from "./heartbeatService.ts";
import type { TradeResult, TradeSignal } from "./tradeTypes.ts";
import { getClient } from "./walletService.ts";

const log = createLogger("execution-service");

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return {};
}

export async function executeTrade(
	signal: TradeSignal,
	options: { marketConfig?: MarketConfig | null; riskConfig: RiskConfig },
	mode: "paper" | "live" = "paper",
): Promise<TradeResult> {
	return withTradeLock(mode, () => executeTradeInternal(signal, options, mode));
}

async function executeTradeInternal(
	signal: TradeSignal,
	options: { marketConfig?: MarketConfig | null; riskConfig: RiskConfig },
	mode: "paper" | "live" = "paper",
): Promise<TradeResult> {
	const { riskConfig } = options;

	if (mode === "paper") {
		if (!canTrade("paper")) {
			return { success: false, reason: "trading_disabled" };
		}

		const { side, marketUp, marketDown, marketSlug } = signal;
		const isUp = side === "UP";
		const marketPrice = isUp ? parseFloat(String(marketUp)) : parseFloat(String(marketDown));
		if (!Number.isFinite(marketPrice)) {
			log.warn(`Non-finite market price for ${signal.marketId}, aborting paper trade`);
			return { success: false, reason: "price_not_finite" };
		}
		const limitDiscount = Number(riskConfig.limitDiscount ?? 0.1);
		const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
		const price = Math.round(priceRaw * 100) / 100;

		if (price < 0.02 || price > 0.98) {
			log.info(`Price ${price} out of tradeable range`);
			return { success: false, reason: "price_out_of_range" };
		}

		const oppositePrice = isUp ? parseFloat(String(marketDown)) : parseFloat(String(marketUp));
		if (price > 0.95 && oppositePrice < 0.05) {
			log.info("Market too confident, skipping");
			return { success: false, reason: "market_too_confident" };
		}

		const timing = getCandleWindowTiming(options.marketConfig?.candleWindowMinutes ?? 15);
		const account = getAccount("paper");
		const actualCost = Number(riskConfig.maxTradeSizeUsdc || 0) * price;
		const paperBalance = account.getBalance().current;
		if (paperBalance < actualCost) {
			log.warn(`Insufficient balance for actual cost: ${actualCost.toFixed(2)} > ${paperBalance.toFixed(2)}`);
			return { success: false, reason: "insufficient_balance_actual_cost" };
		}
		const paperTradeTimestamp = new Date().toISOString();
		const tradeId = account.addTrade(
			{
				marketId: signal.marketId,
				windowStartMs: timing.startMs,
				side: signal.side,
				price,
				size: Number(riskConfig.maxTradeSizeUsdc || 0),
				priceToBeat: signal.priceToBeat ?? 0,
				currentPriceAtEntry: signal.currentPrice,
				timestamp: paperTradeTimestamp,
				marketSlug,
			},
			undefined,
			"filled",
		);

		log.info(`Simulated fill: ${side} at ${price}¢ | ${marketSlug} (${tradeId})`);
		emitTradeExecuted({
			marketId: signal.marketId,
			mode,
			side,
			price,
			size: Number(riskConfig.maxTradeSizeUsdc || 0),
			timestamp: paperTradeTimestamp,
			orderId: tradeId,
			status: "filled",
		});

		return {
			success: true,
			order: { orderID: tradeId, status: "filled" },
		};
	}

	if (!canTrade("live")) {
		return { success: false, reason: "trading_disabled" };
	}

	const { side, marketUp, marketDown, tokens } = signal;
	const isUp = side === "UP";
	const marketPrice = isUp ? parseFloat(String(marketUp)) : parseFloat(String(marketDown));
	if (!Number.isFinite(marketPrice)) {
		log.warn(`Non-finite market price for ${signal.marketId}, aborting live trade`);
		return { success: false, reason: "price_not_finite" };
	}
	const limitDiscount = Number(riskConfig.limitDiscount ?? 0.1);
	const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
	const price = Math.round(priceRaw * 100) / 100;
	const tokenId = tokens ? (isUp ? tokens.upTokenId : tokens.downTokenId) : null;

	if (!tokenId) {
		log.error("No token ID available for", side);
		return { success: false, reason: "no_token_id" };
	}

	if (price < 0.02 || price > 0.98) {
		log.info(`Price ${price} out of tradeable range`);
		return { success: false, reason: "price_out_of_range" };
	}

	const oppositePrice = isUp ? parseFloat(String(marketDown)) : parseFloat(String(marketUp));
	if (price > 0.95 && oppositePrice < 0.05) {
		log.info("Market too confident, skipping");
		return { success: false, reason: "market_too_confident" };
	}

	log.info(`Executing ${side} trade: market ${marketPrice}¢ -> limit ${price}¢ (token: ${tokenId})`);

	const client = getClient();
	if (!client) {
		return { success: false, reason: "trading_disabled" };
	}

	const liveAccount = getAccount("live");
	const actualCost = Number(riskConfig.maxTradeSizeUsdc || 0) * price;
	const liveBalance = liveAccount.getBalance().current;
	if (liveBalance < actualCost) {
		log.warn(`Insufficient balance for actual cost: ${actualCost.toFixed(2)} > ${liveBalance.toFixed(2)}`);
		return { success: false, reason: "insufficient_balance_actual_cost" };
	}

	try {
		const negRisk = false;
		const tradeSize = Number(riskConfig.maxTradeSizeUsdc || 0);
		const isLatePhase = signal.phase === "LATE";
		const isHighConfidence = signal.strength === "STRONG" || signal.strength === "GOOD";
		const timing = getCandleWindowTiming(options.marketConfig?.candleWindowMinutes ?? 15);
		let result: unknown;

		if (isLatePhase && isHighConfidence) {
			log.info(`Posting FOK market order: ${side} amount=${tradeSize} worst-price=${price} (token: ${tokenId})`);
			result = await client.createAndPostMarketOrder(
				{
					tokenID: tokenId,
					side: Side.BUY,
					amount: tradeSize,
					price,
				},
				{ negRisk },
				OrderType.FOK,
			);
			const fokResult = asRecord(result);
			if (!fokResult.orderID && !fokResult.id) {
				log.warn(`FOK order rejected (no fill): ${side} amount=${tradeSize} worst-price=${price}`);
				return { success: false, reason: "fok_no_fill" };
			}
		} else {
			const bufferMs = Math.max(10_000, Math.min(timing.remainingMs / 2, 60_000));
			const expiration = Math.floor((timing.endMs - bufferMs) / 1000);
			const nowSec = Math.floor(Date.now() / 1000);
			if (expiration <= nowSec) {
				log.warn(`GTD expiration in the past (${expiration} <= ${nowSec}), skipping trade`);
				return { success: false, reason: "gtd_expiration_invalid" };
			}

			log.info(
				`Posting GTD+postOnly order: ${side} size=${tradeSize} price=${price} exp=${expiration}s (token: ${tokenId})`,
			);
			result = await client.createAndPostOrder(
				{
					tokenID: tokenId,
					price,
					size: tradeSize,
					side: Side.BUY,
					expiration,
				},
				{ negRisk },
				OrderType.GTD,
				false,
				true,
			);
		}

		const resultObj = asRecord(result);
		const resultOrderId = typeof resultObj.orderID === "string" ? resultObj.orderID : undefined;
		const resultId = typeof resultObj.id === "string" ? resultObj.id : undefined;
		const resultStatus = typeof resultObj.status === "string" ? resultObj.status : undefined;

		log.info("Order result:", JSON.stringify(result));
		const liveTradeTimestamp = new Date().toISOString();
		const isGtdOrder = !isLatePhase || !isHighConfidence;
		const defaultStatus = isGtdOrder ? "placed" : "filled";

		if (!resultOrderId && !resultId) {
			log.warn(`Order returned no orderId, treating as failed: ${JSON.stringify(result)}`);
			return { success: false, reason: "no_order_id" };
		}

		const finalOrderId = resultOrderId ?? resultId ?? "";
		if (isGtdOrder) {
			try {
				void pendingOrderQueries.upsert({
					orderId: finalOrderId,
					marketId: signal.marketId ?? "",
					windowStartMs: timing.startMs,
					side,
					price,
					size: Number(riskConfig.maxTradeSizeUsdc || 0),
					priceToBeat: signal.priceToBeat ?? null,
					currentPriceAtEntry: signal.currentPrice ?? null,
					tokenId,
					placedAt: Date.now(),
					status: "placed",
				});
			} catch (persistErr) {
				log.warn(
					`Failed to persist live pending order ${finalOrderId.slice(0, 12)}...:`,
					persistErr instanceof Error ? persistErr.message : String(persistErr),
				);
			}
		}

		try {
			emitTradeExecuted({
				marketId: signal.marketId,
				mode,
				side,
				price,
				size: Number(riskConfig.maxTradeSizeUsdc || 0),
				timestamp: liveTradeTimestamp,
				orderId: finalOrderId,
				status: resultStatus || defaultStatus,
			});

			if (!isGtdOrder) {
				liveAccount.addTrade(
					{
						marketId: signal.marketId ?? "",
						windowStartMs: timing.startMs,
						side,
						price,
						size: Number(riskConfig.maxTradeSizeUsdc || 0),
						priceToBeat: signal.priceToBeat ?? 0,
						currentPriceAtEntry: signal.currentPrice,
						timestamp: liveTradeTimestamp,
						marketSlug: signal.marketSlug,
					},
					finalOrderId,
					"filled",
				);
			}
		} catch (recordErr) {
			log.error(
				`Post-trade recording failed (order ${finalOrderId} was placed successfully):`,
				recordErr instanceof Error ? recordErr.message : String(recordErr),
			);
		}

		try {
			if (tokenId.length > 0) {
				void onchainQueries.upsertKnownCtfToken({
					tokenId,
					marketId: signal.marketId ?? "",
					side,
					conditionId: signal.conditionId ?? null,
				});
				enrichPosition(tokenId, signal.marketId ?? "", side);
			}
		} catch (enrichErr) {
			log.warn("Failed to persist known CTF token:", enrichErr);
		}

		if (isGtdOrder) {
			registerOpenGtdOrder(finalOrderId);
			startHeartbeat();
		}

		return {
			success: true,
			order: result,
			orderId: resultOrderId || resultId,
			tradePrice: price,
			isGtdOrder,
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Order error:", msg);
		return { success: false, error: msg };
	}
}

export function getConfig(): {
	paperRisk: RiskConfig;
	liveRisk: RiskConfig;
	strategy: typeof CONFIG.strategy;
} {
	return {
		paperRisk: CONFIG.paperRisk,
		liveRisk: CONFIG.liveRisk,
		strategy: CONFIG.strategy,
	};
}
