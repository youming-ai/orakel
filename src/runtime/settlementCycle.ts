import { createLogger } from "../core/logger.ts";
import { getCandleWindowTiming } from "../core/utils.ts";
import type { MarketState } from "../pipeline/processMarket.ts";
import type { AccountStatsManager } from "../trading/accountStats.ts";
import type { MarketConfig } from "../types.ts";
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

export async function runSettlementCycle({
	markets,
	states,
	prevWindowStartMs,
	paperAccount,
	liveAccount,
}: SettlementCycleParams): Promise<Map<string, number>> {
	// Settlement uses the previous tick's price by design. The window closes before
	// the new tick processes, so the last known price at window-end is the correct settle price.
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
			const paperResolved = await paperAccount.resolveTrades(prevStart, latestPrices, market.id);
			if (paperResolved > 0) {
				log.info(`[${market.id}] Paper window settled: ${paperResolved}`);
			}

			const liveResolved = await liveAccount.resolveTrades(prevStart, latestPrices, market.id);
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
