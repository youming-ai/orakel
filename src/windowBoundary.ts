import { CONFIG } from "./config.ts";
import { cancelAllOpenOrders } from "./heartbeat.ts";
import { cleanupStaleLiveTrades, resolveLiveTrades } from "./liveSettlement.ts";
import { createLogger } from "./logger.ts";
import { cleanupStalePaperTrades, getPaperStats, resolvePaperTrades } from "./paperStats.ts";
import type { MarketState } from "./pipeline/processMarket.ts";
import { redeemAll } from "./redeemer.ts";
import { isLiveRunning } from "./state.ts";
import { getLiveStats, getWallet, updatePnl } from "./trader.ts";
import type { MarketConfig } from "./types.ts";

const log = createLogger("window-boundary");

interface WindowTracker {
	setWindow(startMs: number): void;
}

interface HandleWindowBoundaryParams {
	prevWindowStartMs: number;
	currentStartMs: number;
	markets: MarketConfig[];
	states: Map<string, MarketState>;
	paperTracker: WindowTracker;
	liveTracker: WindowTracker;
}

export async function handleWindowBoundary(params: HandleWindowBoundaryParams): Promise<void> {
	params.paperTracker.setWindow(params.currentStartMs);
	params.liveTracker.setWindow(params.currentStartMs);

	// Settle paper trades from previous window (even if stopped, to resolve pending trades)
	const finalPrices = new Map<string, number>();
	for (const market of params.markets) {
		const st = params.states.get(market.id);
		if (st?.prevCurrentPrice !== null && st?.prevCurrentPrice !== undefined) {
			finalPrices.set(market.id, st.prevCurrentPrice);
		}
	}
	const prevPnl = getPaperStats().totalPnl;
	const resolved = resolvePaperTrades(params.prevWindowStartMs, finalPrices);
	if (resolved > 0) {
		const stats = getPaperStats();
		const pnlDelta = stats.totalPnl - prevPnl;
		updatePnl(pnlDelta, "paper");
		log.info(
			`Resolved ${resolved} trade(s) | W:${stats.wins} L:${stats.losses} | WR:${(stats.winRate * 100).toFixed(0)}% | PnL:${stats.totalPnl.toFixed(2)}`,
		);
	}

	// Cancel any open GTD orders before settlement to prevent stale fills
	if (isLiveRunning()) {
		await cancelAllOpenOrders();
	}

	if (isLiveRunning()) {
		const liveFinalPrices = new Map<string, number>();
		for (const market of params.markets) {
			const st = params.states.get(market.id);
			if (st?.prevCurrentPrice !== null && st?.prevCurrentPrice !== undefined) {
				liveFinalPrices.set(market.id, st.prevCurrentPrice);
			}
		}
		const liveResolved = resolveLiveTrades(params.prevWindowStartMs, liveFinalPrices, updatePnl);
		if (liveResolved > 0) {
			const stats = await getLiveStats();
			log.info(
				`Live settled ${liveResolved} trade(s) | W:${stats.wins} L:${stats.losses} | WR:${(stats.winRate * 100).toFixed(0)}% | PnL:${stats.totalPnl.toFixed(2)}`,
			);
		}
	}

	// Clean up trades that were never settled (data unavailable for 2+ windows)
	const windowMin = CONFIG.candleWindowMinutes ?? 15;
	cleanupStalePaperTrades(params.currentStartMs, windowMin);
	if (isLiveRunning()) {
		cleanupStaleLiveTrades(params.currentStartMs, windowMin);
	}

	if (isLiveRunning()) {
		const wallet = getWallet();
		if (wallet) {
			log.info("Window changed, checking for redeemable positions...");
			redeemAll(wallet)
				.then((results) => {
					if (results.length) {
						log.info(`Redeemed ${results.length} position(s)`);
					}
				})
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					log.error("Redemption error:", message);
				});
		}
	}
}
