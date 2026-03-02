import { OrderType, Side } from "@polymarket/clob-client";
import { isHeartbeatReconnecting, registerOpenGtdOrder, startHeartbeat } from "../bot/heartbeat.ts";
import { getConfigForTimeframe, TIMEFRAME_WINDOW_MINUTES } from "../core/config.ts";
import { onchainStatements, pendingLiveStatements, statements } from "../core/db.ts";
import { createLogger } from "../core/logger.ts";
import { emitTradeExecuted } from "../core/state.ts";
import { calculateKellyPositionSize } from "../engines/positionSizing.ts";
import { storeSignalMetadata } from "../strategy/adaptive.ts";
import type {
	MarketConfig,
	PositionSizeResult,
	RiskConfig,
	StrategyConfig,
	TradeResult,
	TradeSignal,
} from "../types.ts";
import { getCandleWindowTiming } from "../utils.ts";
import { enrichPosition, getUsdcBalance } from "./accountState.ts";
import { addPendingLiveTrade, clearLiveStatsCache } from "./live.ts";
import { addPaperTrade, getPaperBalance } from "./paperStats.ts";
import { getClient, getLiveDailyState, getPaperDailyState, getWallet, updatePnl } from "./wallet.ts";

const log = createLogger("trader");

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return {};
}

function asSignalConfidence(signal: TradeSignal): number {
	const signalRecord = asRecord(signal);
	const confidenceValue = signalRecord.confidence;

	if (typeof confidenceValue === "number" && Number.isFinite(confidenceValue)) {
		return confidenceValue;
	}

	if (confidenceValue && typeof confidenceValue === "object") {
		const confidenceRecord = asRecord(confidenceValue);
		const scoreValue = confidenceRecord.score;
		if (typeof scoreValue === "number" && Number.isFinite(scoreValue)) {
			return scoreValue;
		}
	}

	return 0.5;
}

const VALID_REGIMES = ["TREND_UP", "TREND_DOWN", "RANGE", "CHOP"] as const;
type ValidRegime = (typeof VALID_REGIMES)[number];

function asSignalRegime(signal: TradeSignal): ValidRegime | null {
	const signalRecord = asRecord(signal);
	const regimeValue = signalRecord.regime;
	if (typeof regimeValue === "string" && regimeValue.length > 0) {
		// Runtime validation: ensure regime is a valid value
		if (VALID_REGIMES.includes(regimeValue as ValidRegime)) {
			return regimeValue as ValidRegime;
		}
		// Log warning for invalid regime values
		log.warn(`Invalid regime value "${regimeValue}" received, treating as null`);
	}
	return null;
}

function normalizedMarketPrice(price: number | null): number {
	if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price >= 1) {
		return 0.5;
	}
	return price;
}

function computeTradeSize(
	signal: TradeSignal,
	riskConfig: RiskConfig,
	balance: number,
	strategyConfig?: StrategyConfig,
): PositionSizeResult {
	const configuredMaxSize = Number(riskConfig.maxTradeSizeUsdc || 0);
	if (!Number.isFinite(configuredMaxSize) || configuredMaxSize <= 0) {
		return {
			size: 0,
			rawKelly: 0,
			adjustedKelly: 0,
			reason: "max_size_zero",
		};
	}

	const marketPrice =
		signal.side === "UP" ? normalizedMarketPrice(signal.marketUp) : normalizedMarketPrice(signal.marketDown);
	const winProbability = signal.side === "UP" ? signal.modelUp : signal.modelDown;
	const avgWinPayout = 1 - marketPrice;
	const avgLossPayout = marketPrice;

	const strategy = strategyConfig ?? getConfigForTimeframe(signal.timeframe).strategy;

	const result = calculateKellyPositionSize({
		winProbability,
		avgWinPayout,
		avgLossPayout,
		bankroll: balance,
		maxSize: configuredMaxSize,
		minSize: strategy.minTradeSize ?? 0.5,
		kellyFraction: strategy.kellyFraction ?? 0.5,
		confidence: asSignalConfidence(signal),
		regime: asSignalRegime(signal),
		side: signal.side,
	});

	log.info(
		`Kelly sizing ${signal.marketId} ${signal.side}: size=${result.size.toFixed(4)} raw=${result.rawKelly.toFixed(4)} adjusted=${result.adjustedKelly.toFixed(4)} reason=${result.reason}`,
	);

	return result;
}

function canTrade(riskConfig: RiskConfig, mode: "paper" | "live"): boolean {
	if (mode === "live") {
		if (!getClient()) {
			log.error("Client not initialized");
			return false;
		}

		if (!getWallet()) {
			log.error("No wallet available");
			return false;
		}

		if (isHeartbeatReconnecting()) {
			log.warn("Heartbeat reconnecting — blocking live trade");
			return false;
		}
		// Pre-check USDC balance to avoid wasted CLOB API calls
		// Block when balance is 0 (not yet fetched or actually empty) or too low
		const usdcBalance = getUsdcBalance();
		const maxTradeSize = Number(riskConfig.maxTradeSizeUsdc || 0);
		if (usdcBalance < maxTradeSize * 0.5) {
			log.warn(`USDC balance too low for live trade: ${usdcBalance.toFixed(2)} < ${(maxTradeSize * 0.5).toFixed(2)}`);
			return false;
		}

		// Cumulative drawdown protection: sum recent live daily PnL from DB
		// Blocks trading if rolling 7-day cumulative loss exceeds 7x daily limit
		const cumulativeLossLimit = Number(riskConfig.dailyMaxLossUsdc || 0) * 7;
		if (cumulativeLossLimit > 0) {
			try {
				const rows = statements.getRecentDailyStatsByMode().all({ $mode: "live", $limit: 7 }) as Array<{
					pnl: number;
				}>;
				const recentPnl = rows.reduce((sum, r) => sum + Number(r.pnl ?? 0), 0);
				if (recentPnl <= -cumulativeLossLimit) {
					log.error(
						`Live cumulative loss limit reached: ${recentPnl.toFixed(2)} <= -${cumulativeLossLimit.toFixed(2)} (7-day rolling)`,
					);
					return false;
				}
			} catch {
				// DB query failure should not block trading
			}
		}
	}

	// Reset daily state before checking limits — otherwise yesterday's exceeded
	// limit would block the first trade of a new day
	const today = new Date().toDateString();
	const daily = mode === "paper" ? getPaperDailyState() : getLiveDailyState();
	if (daily.date !== today) {
		daily.date = today;
		daily.pnl = 0;
		daily.trades = 0;
		updatePnl(0, mode);
	}

	const currentDaily = mode === "paper" ? getPaperDailyState() : getLiveDailyState();
	if (currentDaily.pnl <= -Number(riskConfig.dailyMaxLossUsdc || 0)) {
		log.error(`${mode} daily ${mode === "live" ? "spending cap" : "loss limit"} reached`);
		return false;
	}

	return true;
}

function logTrade(
	trade: {
		timestamp?: string;
		market?: string;
		side: string;
		amount: number;
		price: number;
		orderId?: string;
		status: string;
	},
	marketId: string | null | undefined,
	mode: "paper" | "live",
	timeframe?: string,
): void {
	const timestamp = trade.timestamp ?? new Date().toISOString();

	statements.insertTrade().run({
		$timestamp: timestamp,
		$market: marketId ?? trade.market ?? "",
		$side: trade.side,
		$amount: trade.amount,
		$price: trade.price,
		$orderId: trade.orderId ?? "",
		$status: trade.status,
		$mode: mode,
		$pnl: null,
		$won: null,
		$timeframe: timeframe ?? "15m",
		$slug: trade.market ?? "",
	});
}

export async function executeTrade(
	signal: TradeSignal,
	options: { marketConfig?: MarketConfig | null; riskConfig: RiskConfig; strategyConfig?: StrategyConfig },
	mode: "paper" | "live" = "paper",
): Promise<TradeResult> {
	const { marketConfig = null, riskConfig, strategyConfig } = options;

	if (mode === "paper") {
		const { side, marketUp, marketDown, marketSlug } = signal;
		const paperBalance = getPaperBalance().current;
		const paperSizing = computeTradeSize(signal, riskConfig, paperBalance, strategyConfig);
		const tradeSize = paperSizing.size;
		if (tradeSize <= 0) {
			log.warn(`Skipping paper trade for ${signal.marketId}: ${paperSizing.reason}`);
			return { success: false, reason: "size_zero" };
		}
		const isUp = side === "UP";
		const marketPrice = isUp ? parseFloat(String(marketUp)) : parseFloat(String(marketDown));
		// P0-1: Guard against NaN/Infinity propagation into trades
		if (!Number.isFinite(marketPrice)) {
			log.warn(`Non-finite market price for ${signal.marketId}, aborting paper trade`);
			return { success: false, reason: "price_not_finite" };
		}
		const limitDiscount = Number(riskConfig.limitDiscount ?? 0.1);
		const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
		const price = Math.round(priceRaw * 100) / 100;
		const arbitrageDetected = signal.arbitrageDetected === true;
		const arbitrageDirection = signal.arbitrageDirection ?? (side === "UP" ? "BUY_UP" : "BUY_DOWN");
		const arbitrageSpread =
			typeof signal.arbitrageSpread === "number" && Number.isFinite(signal.arbitrageSpread)
				? signal.arbitrageSpread
				: null;
		const arbitrageStatusMarker =
			arbitrageDetected && arbitrageSpread !== null
				? `ARB:${arbitrageDirection}:spread=${arbitrageSpread.toFixed(4)}`
				: arbitrageDetected
					? `ARB:${arbitrageDirection}:spread=n/a`
					: null;

		if (price < 0.02 || price > 0.98) {
			log.info(`Price ${price} out of tradeable range`);
			return { success: false, reason: "price_out_of_range" };
		}

		const windowMinutes = TIMEFRAME_WINDOW_MINUTES[signal.timeframe] ?? 15;
		const timing = getCandleWindowTiming(windowMinutes);
		const paperId = addPaperTrade({
			marketId: signal.marketId,
			windowStartMs: timing.startMs,
			side: signal.side,
			price,
			size: tradeSize,
			priceToBeat: signal.priceToBeat ?? 0,
			currentPriceAtEntry: signal.currentPrice,
			timestamp: new Date().toISOString(),
			timeframe: signal.timeframe,
		});

		storeSignalMetadata(paperId, {
			edge: Math.max(Number(signal.edgeUp ?? 0), Number(signal.edgeDown ?? 0)),
			confidence: asSignalConfidence(signal),
			phase: signal.phase,
			regime: asSignalRegime(signal),
			volatility15m: Number(signal.volatility15m ?? 0),
			modelUp: Number(signal.modelUp ?? 0.5),
			orderbookImbalance: signal.orderbookImbalance ?? null,
			rsi: null,
			vwapSlope: null,
		});

		if (arbitrageDetected) {
			log.info(
				`[ARBITRAGE][PAPER] ${signal.marketId} ${arbitrageDirection} spread=${arbitrageSpread?.toFixed(4) ?? "n/a"}`,
			);
		}

		log.info(`Simulated fill: ${side} at ${price}¢ | ${marketSlug} (${paperId})`);

		const paperTradeTimestamp = new Date().toISOString();

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: tradeSize,
				price,
				orderId: paperId,
				status: arbitrageStatusMarker === null ? "paper_filled" : `paper_filled|${arbitrageStatusMarker}`,
			},
			signal.marketId || marketConfig?.id,
			mode,
			signal.timeframe,
		);

		emitTradeExecuted({
			marketId: signal.marketId,
			mode,
			side,
			price,
			size: tradeSize,
			timestamp: paperTradeTimestamp,
			orderId: paperId,
			status: "paper_filled",
		});

		getPaperDailyState().trades++;
		updatePnl(0, "paper");

		return {
			success: true,
			order: { orderID: paperId, status: "paper_filled" },
		};
	}

	if (!canTrade(riskConfig, "live")) {
		return { success: false, reason: "trading_disabled" };
	}

	const liveBankroll = getUsdcBalance() || Number(riskConfig.maxTradeSizeUsdc || 0) * 10;
	const liveSizing = computeTradeSize(signal, riskConfig, liveBankroll, strategyConfig);
	const tradeSize = liveSizing.size;
	if (tradeSize <= 0) {
		log.warn(`Skipping live trade for ${signal.marketId}: ${liveSizing.reason}`);
		return { success: false, reason: "size_zero" };
	}

	const { side, marketUp, marketDown, marketSlug, tokens } = signal;

	const isUp = side === "UP";
	const marketPrice = isUp ? parseFloat(String(marketUp)) : parseFloat(String(marketDown));
	// P0-1: Guard against NaN/Infinity propagation into live trades
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

	const liveClient = getClient();
	if (!liveClient) {
		return { success: false, reason: "trading_disabled" };
	}

	try {
		const negRisk = false;
		const isLatePhase = signal.phase === "LATE";
		const isHighConfidence = signal.strength === "STRONG" || signal.strength === "GOOD";

		let result: unknown;

		if (isLatePhase && isHighConfidence) {
			// LATE phase + high confidence → FOK for immediate fill
			log.info(`Posting FOK market order: ${side} amount=${tradeSize} worst-price=${price} (token: ${tokenId})`);
			result = await liveClient.createAndPostMarketOrder(
				{
					tokenID: tokenId,
					side: Side.BUY,
					amount: tradeSize,
					price, // worst-price limit (slippage protection)
				},
				{ negRisk },
				OrderType.FOK,
			);
			// FOK is fill-or-kill: if no liquidity at worst-price, order is rejected.
			// Check for empty result indicating rejection.
			const fokResult = asRecord(result);
			if (!fokResult.orderID && !fokResult.id) {
				log.warn(`FOK order rejected (no fill): ${side} amount=${tradeSize} worst-price=${price}`);
				return { success: false, reason: "fok_no_fill" };
			}
		} else {
			// EARLY/MID phase → GTD with post-only for maker rebate.
			// postOnly guarantees maker status; if order would take, it is rejected.
			// No taker fallback — conservative: skip rather than pay taker fees.
			const timing = getCandleWindowTiming(TIMEFRAME_WINDOW_MINUTES[signal.timeframe] ?? 15);
			// Dynamic expiration buffer: minimum 10s, max 50% of remaining time
			// This ensures orders don't expire too early in LATE phase
			const bufferMs = Math.max(10_000, Math.min(timing.remainingMs / 2, 60_000));
			const expiration = Math.floor((timing.endMs - bufferMs) / 1000);
			const nowSec = Math.floor(Date.now() / 1000);
			if (expiration <= nowSec) {
				log.warn(`GTD expiration in the past (${expiration} <= ${nowSec}), skipping trade`);
				return { success: false, reason: "gtd_expiration_invalid" };
			}

			const orderArgs = {
				tokenID: tokenId,
				price,
				size: tradeSize,
				side: Side.BUY,
				expiration,
			};

			log.info(
				`Posting GTD+postOnly order: ${side} size=${tradeSize} price=${price} exp=${expiration}s (token: ${tokenId})`,
			);
			result = await liveClient.createAndPostOrder(
				orderArgs,
				{ negRisk }, // tickSize auto-resolved by SDK
				OrderType.GTD,
				false, // deferExec
				true, // postOnly — guarantee maker, get 20% fee rebate
			);
		}
		const resultObj = asRecord(result);
		const resultOrderId = typeof resultObj.orderID === "string" ? resultObj.orderID : undefined;
		const resultId = typeof resultObj.id === "string" ? resultObj.id : undefined;
		const resultStatus = typeof resultObj.status === "string" ? resultObj.status : undefined;

		log.info("Order result:", JSON.stringify(result));
		const liveTradeTimestamp = new Date().toISOString();

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: tradeSize,
				price,
				orderId: resultOrderId || resultId || "unknown",
				status: resultStatus || "placed",
			},
			signal.marketId || marketConfig?.id,
			mode,
			signal.timeframe,
		);

		if (!(resultOrderId || resultId)) {
			log.error(`Order placed but no orderID returned — possible fire-and-forget: ${side} ${marketSlug}`);
			return { success: false, reason: "no_order_id" };
		}

		const finalOrderId = resultOrderId || resultId || "unknown";
		emitTradeExecuted({
			marketId: signal.marketId,
			mode,
			side,
			price,
			size: tradeSize,
			timestamp: liveTradeTimestamp,
			orderId: finalOrderId,
			status: resultStatus || "placed",
		});
		getLiveDailyState().trades++;
		updatePnl(0, "live");

		// Clear stats cache after new trade
		clearLiveStatsCache();

		// Store signal metadata for adaptive model feedback during settlement
		storeSignalMetadata(finalOrderId, {
			edge: Math.max(Number(signal.edgeUp ?? 0), Number(signal.edgeDown ?? 0)),
			confidence: asSignalConfidence(signal),
			phase: signal.phase,
			regime: asSignalRegime(signal),
			volatility15m: Number(signal.volatility15m ?? 0),
			modelUp: Number(signal.modelUp ?? 0.5),
			orderbookImbalance: signal.orderbookImbalance ?? null,
			rsi: null,
			vwapSlope: null,
		});

		if (tokenId && tokenId.length > 0) {
			try {
				onchainStatements.upsertKnownCtfToken().run({
					$tokenId: tokenId,
					$marketId: signal.marketId ?? "",
					$side: side,
					$conditionId: null,
				});
				enrichPosition(tokenId, signal.marketId ?? "", side);
			} catch (err) {
				log.warn("Failed to persist known CTF token:", err);
			}
		}

		// Start heartbeat and track order ONLY for GTD orders
		// FOK orders fill immediately and don't need heartbeat
		if (!isLatePhase || !isHighConfidence) {
			registerOpenGtdOrder(finalOrderId);
			startHeartbeat();
		}

		// Conservative PnL: debit full trade cost as worst-case loss.
		// Daily loss limit in canTrade() now acts as a spending cap for live mode.
		const liveTradeSize = tradeSize;
		updatePnl(-liveTradeSize * price, "live");

		// Track for settlement at window boundary
		if (signal.priceToBeat && signal.priceToBeat > 0) {
			const liveWindowMinutes = TIMEFRAME_WINDOW_MINUTES[signal.timeframe] ?? 15;
			const liveTiming = getCandleWindowTiming(liveWindowMinutes);
			const pendingTrade = {
				orderId: finalOrderId,
				marketId: signal.marketId ?? "",
				side,
				buyPrice: price,
				size: liveTradeSize,
				priceToBeat: signal.priceToBeat,
				windowStartMs: liveTiming.startMs,
				timeframe: signal.timeframe,
			};

			// Persist to DB first for data consistency
			try {
				pendingLiveStatements.insertPendingLiveTrade().run({
					$orderId: finalOrderId,
					$marketId: signal.marketId ?? "",
					$side: side,
					$buyPrice: price,
					$size: liveTradeSize,
					$priceToBeat: signal.priceToBeat,
					$windowStartMs: liveTiming.startMs,
					$timeframe: signal.timeframe,
				});
				// Only add to memory after successful DB write
				addPendingLiveTrade(pendingTrade);
			} catch (err) {
				log.error("Failed to persist pending live trade to DB, skipping:", err);
				// Do not add to memory if DB write failed - prevents inconsistency
			}
		}

		const isGtdOrder = !isLatePhase || !isHighConfidence;
		return {
			success: !!(resultOrderId || resultId),
			order: result,
			orderId: resultOrderId || resultId,
			tradePrice: price,
			isGtdOrder,
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Order error:", msg);

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: tradeSize,
				price,
				orderId: "error",
				status: `error: ${msg}`,
			},
			signal.marketId || marketConfig?.id,
			mode,
			signal.timeframe,
		);

		return {
			success: false,
			error: msg,
		};
	}
}

export {
	connectWallet,
	disconnectWallet,
	getClientStatus,
	getDailyState,
	getLiveByMarket,
	getLiveDailyState,
	getLiveStats,
	getLiveTodayStats,
	getPaperDailyState,
	getWallet,
	getWalletAddress,
	initTraderState,
	updatePnl,
} from "./wallet.ts";
