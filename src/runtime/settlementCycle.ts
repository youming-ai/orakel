import type { MarketConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import { getCandleWindowTiming } from "../core/utils.ts";
import { fetchChainlinkPrice } from "../data/chainlink.ts";
import type { MarketState } from "../pipeline/processMarket.ts";
import type { AccountStatsManager } from "../trading/accountStats.ts";
import { collectLatestPrices } from "./marketState.ts";

const log = createLogger("settlement-cycle");
const FORCE_RESOLVE_MAX_AGE_MS = 60 * 60_000;

interface SettlementCycleParams {
	markets: MarketConfig[];
	states: Map<string, MarketState>;
	prevWindowStartMs: Map<string, number>;
	paperAccount: AccountStatsManager;
	liveAccount: AccountStatsManager;
}

/**
 * Fetch Chainlink on-chain price for settlement. Polymarket resolves using Chainlink,
 * so using the same source avoids mismatches with our internal settlement.
 * Falls back to the aggregated latestPrices if Chainlink fetch fails.
 */
export async function fetchSettlementPrice(
	market: MarketConfig,
	fallbackPrices: Map<string, number>,
): Promise<number | null> {
	if (market.resolutionSource === "chainlink") {
		try {
			const tick = await fetchChainlinkPrice({
				aggregator: market.chainlink.aggregator,
				decimals: market.chainlink.decimals,
			});
			if (tick.price !== null) {
				log.info(`[${market.id}] Chainlink settlement price: $${tick.price.toFixed(market.pricePrecision)}`);
				return tick.price;
			}
		} catch (err) {
			log.warn(
				`[${market.id}] Chainlink fetch failed, using fallback: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	return fallbackPrices.get(market.id) ?? null;
}

export async function runSettlementCycle({
	markets,
	states,
	prevWindowStartMs,
	paperAccount,
	liveAccount,
}: SettlementCycleParams): Promise<Map<string, number>> {
	const latestPrices = collectLatestPrices(markets, states);

	for (const market of markets) {
		const timing = getCandleWindowTiming(market.candleWindowMinutes);
		const prevStart = prevWindowStartMs.get(market.id);

		if (latestPrices.size > 0) {
			const paperRecovered = await paperAccount.resolveExpiredTrades(
				latestPrices,
				market.candleWindowMinutes,
				market.id,
			);
			if (paperRecovered > 0) {
				log.info(`[${market.id}] Recovered expired paper trades: ${paperRecovered}`);
			}

			const liveRecovered = await liveAccount.resolveExpiredTrades(latestPrices, market.candleWindowMinutes, market.id);
			if (liveRecovered > 0) {
				log.info(`[${market.id}] Recovered expired live trades: ${liveRecovered}`);
			}
		}

		if (prevStart !== undefined && prevStart !== timing.startMs && latestPrices.size > 0) {
			// At window boundary, fetch Chainlink price for accurate settlement
			const settlementPrice = await fetchSettlementPrice(market, latestPrices);
			const settlePrices = new Map(latestPrices);
			if (settlementPrice !== null) {
				settlePrices.set(market.id, settlementPrice);
			}

			const paperResolved = await paperAccount.resolveTrades(prevStart, settlePrices, market.id);
			if (paperResolved > 0) {
				log.info(`[${market.id}] Paper window settled: ${paperResolved}`);
			}

			const liveResolved = await liveAccount.resolveTrades(prevStart, settlePrices, market.id);
			if (liveResolved > 0) {
				log.info(`[${market.id}] Live window settled: ${liveResolved}`);
			}
		}

		prevWindowStartMs.set(market.id, timing.startMs);
	}

	const paperForced = await paperAccount.forceResolveStuckTrades(FORCE_RESOLVE_MAX_AGE_MS, latestPrices);
	if (paperForced > 0) {
		log.warn(`Force-resolved ${paperForced} stuck paper trade(s)`);
	}

	const liveForced = await liveAccount.forceResolveStuckTrades(FORCE_RESOLVE_MAX_AGE_MS, latestPrices);
	if (liveForced > 0) {
		log.warn(`Force-resolved ${liveForced} stuck live trade(s)`);
	}

	return latestPrices;
}
