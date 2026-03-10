import { OrderType, Side } from "@polymarket/clob-client";
import { enrichPosition } from "../blockchain/accountState.ts";
import type { MarketConfig, RiskConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import { getCandleWindowTiming } from "../core/utils.ts";
import { onchainQueries, pendingOrderQueries } from "../db/queries.ts";
import { getAccount } from "./accountStats.ts";
import { emitTradeExecuted, registerOpenGtdOrder, startHeartbeat, withTradeLock } from "./heartbeatService.ts";
import { traderState } from "./traderState.ts";
import type { TradeResult, TradeSignal } from "./tradeTypes.ts";
import { getClient, getWallet } from "./walletService.ts";

const log = createLogger("execution-service");

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return {};
}

function computeLimitPrice(
	signal: TradeSignal,
	riskConfig: RiskConfig,
): { price: number; isUp: boolean; marketPrice: number } | { error: string } {
	const isUp = signal.side === "UP";
	const marketPrice = isUp ? parseFloat(String(signal.marketUp)) : parseFloat(String(signal.marketDown));
	if (!Number.isFinite(marketPrice)) {
		return { error: "price_not_finite" };
	}

	// Phase-adaptive limit discount: LATE uses smaller discount for better fill rate,
	// EARLY uses full discount since there's more time to get filled.
	const maxDiscount = Number(riskConfig.limitDiscount ?? 0.1);
	const phaseMultiplier = signal.phase === "LATE" ? 0.5 : signal.phase === "MID" ? 0.75 : 1.0;
	const limitDiscount = Math.max(0.01, maxDiscount * phaseMultiplier);

	const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
	const price = Math.round(priceRaw * 100) / 100;

	if (price < 0.02 || price > 0.98) {
		return { error: "price_out_of_range" };
	}

	const oppositePrice = isUp ? parseFloat(String(signal.marketDown)) : parseFloat(String(signal.marketUp));
	if (price > 0.95 && oppositePrice < 0.05) {
		return { error: "market_too_confident" };
	}

	return { price, isUp, marketPrice };
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
	const priceResult = computeLimitPrice(signal, riskConfig);
	if ("error" in priceResult) {
		log.info(`${mode} trade skipped for ${signal.marketId}: ${priceResult.error}`);
		return { success: false, reason: priceResult.error };
	}
	const { price, isUp, marketPrice } = priceResult;
	const { side } = signal;
	const tradeSize = Number(riskConfig.maxTradeSizeUsdc || 0);
	const timing = getCandleWindowTiming(options.marketConfig?.candleWindowMinutes ?? 15);

	if (mode === "paper") {
		const account = getAccount("paper");
		const paperTradeTimestamp = new Date().toISOString();
		const slippedPrice = Math.min(price + riskConfig.paperSlippage, 0.98);
		const tradeId = account.addTrade(
			{
				marketId: signal.marketId,
				windowStartMs: timing.startMs,
				side,
				price: slippedPrice,
				size: tradeSize,
				priceToBeat: signal.priceToBeat ?? 0,
				currentPriceAtEntry: signal.currentPrice,
				timestamp: paperTradeTimestamp,
				marketSlug: signal.marketSlug,
			},
			undefined,
			"filled",
		);

		log.info(
			`Simulated fill: ${side} at ${slippedPrice}¢ (slip +${riskConfig.paperSlippage}) size=${tradeSize.toFixed(2)} | ${signal.marketSlug} (${tradeId})`,
		);
		emitTradeExecuted({
			marketId: signal.marketId,
			mode,
			side,
			price: slippedPrice,
			size: tradeSize,
			timestamp: paperTradeTimestamp,
			orderId: tradeId,
			status: "filled",
		});

		return { success: true, order: { orderID: tradeId, status: "filled" } };
	}

	// Live-only checks
	if (!getClient() || !getWallet()) {
		return { success: false, reason: "trading_disabled" };
	}
	if (traderState.heartbeatReconnecting) {
		return { success: false, reason: "heartbeat_reconnecting" };
	}

	const tokenId = signal.tokens ? (isUp ? signal.tokens.upTokenId : signal.tokens.downTokenId) : null;
	if (!tokenId) {
		log.error("No token ID available for", side);
		return { success: false, reason: "no_token_id" };
	}

	log.info(`Executing ${side} trade: market ${marketPrice}¢ -> limit ${price}¢ (token: ${tokenId})`);

	const client = getClient();
	if (!client) {
		return { success: false, reason: "trading_disabled" };
	}

	const liveAccount = getAccount("live");

	try {
		const negRisk = false;
		const isLatePhase = signal.phase === "LATE";
		const isHighConfidence = signal.strength === "STRONG" || signal.strength === "GOOD";
		let result: unknown;

		if (isLatePhase && isHighConfidence) {
			log.info(`Posting FOK market order: ${side} amount=${tradeSize} worst-price=${price} (token: ${tokenId})`);
			result = await client.createAndPostMarketOrder(
				{ tokenID: tokenId, side: Side.BUY, amount: tradeSize, price },
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
				{ tokenID: tokenId, price, size: tradeSize, side: Side.BUY, expiration },
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
			const pendingOrderData = {
				orderId: finalOrderId,
				marketId: signal.marketId ?? "",
				windowStartMs: timing.startMs,
				side,
				price,
				size: tradeSize,
				priceToBeat: signal.priceToBeat ?? null,
				currentPriceAtEntry: signal.currentPrice ?? null,
				tokenId,
				placedAt: Date.now(),
				status: "placed",
			};
			try {
				await pendingOrderQueries.upsert(pendingOrderData);
			} catch (persistErr) {
				log.warn(
					`Failed to persist pending order ${finalOrderId.slice(0, 12)}..., retrying:`,
					persistErr instanceof Error ? persistErr.message : String(persistErr),
				);
				try {
					await pendingOrderQueries.upsert(pendingOrderData);
				} catch (retryErr) {
					log.error(
						`Pending order ${finalOrderId.slice(0, 12)}... persist failed after retry — order is on CLOB but not in DB`,
						retryErr instanceof Error ? retryErr.message : String(retryErr),
					);
				}
			}
		}

		try {
			emitTradeExecuted({
				marketId: signal.marketId,
				mode,
				side,
				price,
				size: tradeSize,
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
						size: tradeSize,
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
