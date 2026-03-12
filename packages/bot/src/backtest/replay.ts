import { computeSlug, computeWindowBounds } from "../core/clock.ts";
import { getConfig } from "../core/config.ts";
import { createLogger } from "../core/logger.ts";
import { fetchMarketBySlug } from "../data/polymarket.ts";

const log = createLogger("replay");

export interface BacktestTick {
	timestampMs: number;
	btcPrice: number;
	marketProbUp: number;
}

export interface BacktestResult {
	totalTrades: number;
	wins: number;
	losses: number;
	winRate: number;
	totalPnl: number;
	finalBalance: number;
	trades: Array<{
		side: "UP" | "DOWN";
		entryPrice: number;
		modelProb: number;
		marketProb: number;
		edge: number;
		won: boolean;
		pnl: number;
	}>;
}

export async function fetchWindowTicks(slug: string, startMs: number, endMs: number): Promise<BacktestTick[]> {
	log.debug("Fetching window ticks", { slug, startMs, endMs });
	return [];
}

export async function generateWindowsForRange(
	startDate: Date,
	endDate: Date,
): Promise<Array<{ slug: string; startMs: number; endMs: number; priceToBeat: number; outcome: "UP" | "DOWN" }>> {
	const config = getConfig();
	const windows = [];
	let current = new Date(startDate);

	while (current <= endDate) {
		const sec = Math.floor(current.getTime() / 1000);
		const { startSec, endSec } = computeWindowBounds(sec, config.infra.windowSeconds);
		const slug = computeSlug(endSec, config.infra.slugPrefix);

		const market = await fetchMarketBySlug(slug, config.infra.polymarketGammaUrl);
		if (market) {
			const outcome: "UP" | "DOWN" = "UP";
			windows.push({
				slug,
				startMs: startSec * 1000,
				endMs: endSec * 1000,
				priceToBeat: market.priceToBeat,
				outcome,
			});
		}

		current = new Date((endSec + config.infra.windowSeconds) * 1000);
	}

	return windows;
}
