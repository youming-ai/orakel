import { CONFIG } from "../core/config.ts";
import { createLogger } from "../core/logger.ts";
import { isLiveRunning, isPaperRunning } from "../core/state.ts";
import { getCandleWindowTiming } from "../core/utils.ts";
import type { ProcessMarketResult } from "../pipeline/processMarket.ts";
import { getAccount } from "../trading/accountStats.ts";
import { executeTrade } from "../trading/trader.ts";

const log = createLogger("trade-dispatch");

function parseMarketStartMsFromSlug(marketSlug: string | undefined): number | null {
	if (!marketSlug) return null;
	const match = /-(\d+)$/.exec(marketSlug);
	if (!match) return null;
	const timestampSeconds = Number(match[1]);
	if (!Number.isFinite(timestampSeconds)) return null;
	return timestampSeconds * 1_000;
}

function getSettlementExposureKey(candidate: ProcessMarketResult, fallbackEndMs: number): string {
	const marketStartMs = parseMarketStartMsFromSlug(candidate.signalPayload?.marketSlug ?? candidate.marketSlug);
	const settleMs =
		marketStartMs === null ? fallbackEndMs : marketStartMs + candidate.market.candleWindowMinutes * 60_000;
	return `${candidate.market.coin}:${settleMs}`;
}

export interface WindowTradeTracker {
	has(marketId: string, startMs: number): boolean;
	record(marketId: string, startMs: number): void;
	canTradeGlobally(maxGlobal: number): boolean;
}

export interface ActiveOrderTracker {
	hasOrder(marketId: string, windowSlug: string): boolean;
	totalActive(): number;
	record(marketId: string, windowSlug: string, recordedAtMs?: number): void;
	onCooldown(): boolean;
}

interface TradeDispatchParams {
	results: ProcessMarketResult[];
	paperTracker: WindowTradeTracker;
	liveTracker: WindowTradeTracker;
	orderTracker: ActiveOrderTracker;
	onLiveOrderPlaced: (result: {
		orderId: string;
		marketId: string;
		windowKey: string;
		side: "UP" | "DOWN";
		tokenId?: string;
		price: number;
		size: number;
		priceToBeat: number | null;
		currentPriceAtEntry: number | null;
	}) => void;
}

export async function dispatchTradeCandidates({
	results,
	paperTracker,
	liveTracker,
	orderTracker,
	onLiveOrderPlaced,
}: TradeDispatchParams): Promise<void> {
	const maxGlobalTrades = CONFIG.strategy.maxGlobalTradesPerWindow;
	const paperSettlementKeys = new Set<string>();
	const liveSettlementKeys = new Set<string>();
	const candidates = results
		.filter((r) => r.ok && r.rec?.action === "ENTER" && r.signalPayload)
		.filter((r) => {
			const sig = r.signalPayload;
			if (!sig) return false;
			if (sig.priceToBeat === null || sig.priceToBeat === undefined || sig.priceToBeat === 0) return false;
			if (sig.currentPrice === null || sig.currentPrice === undefined) return false;
			return true;
		})
		.filter((r) => {
			const timeLeftMin = r.timeLeftMin ?? 0;
			const windowMin = r.market.candleWindowMinutes;
			const buffer = Math.max(1, windowMin * 0.2);
			const elapsed = windowMin - timeLeftMin;
			if (elapsed < buffer) return false;
			if (timeLeftMin < buffer) return false;
			return true;
		})
		.sort((a, b) => {
			const edgeA = Number(a.rec?.edge ?? 0);
			const edgeB = Number(b.rec?.edge ?? 0);
			if (edgeB !== edgeA) return edgeB - edgeA;
			return Number(a.rawSum ?? 1) - Number(b.rawSum ?? 1);
		});

	let successfulTradesThisTick = 0;
	for (const candidate of candidates) {
		const signal = candidate.signalPayload;
		if (!signal) continue;

		const market = candidate.market;
		const timing = getCandleWindowTiming(market.candleWindowMinutes);
		const windowKey = String(timing.startMs);
		const settlementKey = getSettlementExposureKey(candidate, timing.endMs);
		const sideBook = signal.side === "UP" ? (candidate.orderbook?.up ?? null) : (candidate.orderbook?.down ?? null);
		const sideLiquidity = sideBook?.askLiquidity ?? sideBook?.bidLiquidity ?? null;

		if (isPaperRunning()) {
			const paperAccount = getAccount("paper");
			const paperTradeSize = Number(CONFIG.paperRisk.maxTradeSizeUsdc || 0);
			const paperAffordCheck = paperAccount.canAffordTradeWithStopCheck(paperTradeSize);
			const minPaperLiquidity = Number(CONFIG.paperRisk.minLiquidity || 0);
			const hasPaperLiquidity = sideLiquidity !== null && sideLiquidity >= minPaperLiquidity;

			if (
				!paperSettlementKeys.has(settlementKey) &&
				!paperTracker.has(market.id, timing.startMs) &&
				paperAffordCheck.canTrade &&
				hasPaperLiquidity &&
				paperTracker.canTradeGlobally(Math.min(maxGlobalTrades, CONFIG.paperRisk.maxTradesPerWindow)) &&
				paperAccount.getPendingTrades().length < CONFIG.paperRisk.maxOpenPositions
			) {
				const result = await executeTrade(signal, { marketConfig: market, riskConfig: CONFIG.paperRisk }, "paper");
				if (result?.success) {
					paperTracker.record(market.id, timing.startMs);
					paperSettlementKeys.add(settlementKey);
				} else {
					log.warn(`Paper trade failed for ${market.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
				}
			} else if (!hasPaperLiquidity) {
				log.info(
					`Skip ${market.id} paper: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minPaperLiquidity.toFixed(0)}`,
				);
			} else if (!paperAffordCheck.canTrade) {
				log.warn(`Trade rejected for ${market.id}: ${paperAffordCheck.reason}`);
			}
		}

		if (!isLiveRunning()) {
			continue;
		}

		const liveAccount = getAccount("live");
		const minLiveLiquidity = Number(CONFIG.liveRisk.minLiquidity || 0);
		const hasLiveLiquidity = sideLiquidity !== null && sideLiquidity >= minLiveLiquidity;
		if (!hasLiveLiquidity) {
			log.info(
				`Skip ${market.id} live: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minLiveLiquidity.toFixed(0)}`,
			);
			continue;
		}

		const liveWindowLimit = Math.min(maxGlobalTrades, CONFIG.liveRisk.maxTradesPerWindow);
		const liveTradeSize = Number(CONFIG.liveRisk.maxTradeSizeUsdc || 0);
		const liveAffordCheck = liveAccount.canAffordTradeWithStopCheck(liveTradeSize);
		const canPlace =
			!liveSettlementKeys.has(settlementKey) &&
			!orderTracker.hasOrder(market.id, windowKey) &&
			!orderTracker.onCooldown() &&
			orderTracker.totalActive() < CONFIG.liveRisk.maxOpenPositions &&
			successfulTradesThisTick < liveWindowLimit &&
			!liveTracker.has(market.id, timing.startMs) &&
			liveTracker.canTradeGlobally(liveWindowLimit) &&
			liveAffordCheck.canTrade;

		if (!canPlace) {
			continue;
		}

		const result = await executeTrade(signal, { marketConfig: market, riskConfig: CONFIG.liveRisk }, "live");
		if (!result?.success) {
			log.warn(`Live trade failed for ${market.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
			continue;
		}

		orderTracker.record(market.id, windowKey);
		liveTracker.record(market.id, timing.startMs);
		liveSettlementKeys.add(settlementKey);
		successfulTradesThisTick += 1;

		if (result.orderId && (result.isGtdOrder ?? true)) {
			const tokenId = signal.tokens
				? signal.side === "UP"
					? signal.tokens.upTokenId
					: signal.tokens.downTokenId
				: undefined;
			onLiveOrderPlaced({
				orderId: result.orderId,
				marketId: market.id,
				windowKey,
				side: signal.side ?? "UP",
				tokenId,
				price: result.tradePrice ?? 0,
				size: liveTradeSize,
				priceToBeat: signal.priceToBeat ?? null,
				currentPriceAtEntry: signal.currentPrice ?? null,
			});
		}
	}
}
