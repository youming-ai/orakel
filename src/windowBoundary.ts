import { cancelAllOpenOrders } from "./heartbeat.ts";
import { cleanupStaleLiveTrades, resolveLiveTrades } from "./liveSettlement.ts";
import { createLogger } from "./logger.ts";
import { cleanupStalePaperTrades, getPaperStats, resolvePaperTrades } from "./paperStats.ts";
import type { MarketState } from "./pipeline/processMarket.ts";
import { redeemAll } from "./redeemer.ts";
import { isLiveRunning } from "./state.ts";
import { getLiveStats, getWallet, updatePnl } from "./trader.ts";
import type { MarketConfig, TimeframeId } from "./types.ts";

const log = createLogger("window-boundary");

// Track condition IDs that failed redemption for retry on next window boundary
// Maps conditionId -> consecutive failure count for backoff
const pendingRedemptions = new Map<string, number>();

const MAX_REDEMPTION_RETRIES = 5;

interface WindowTracker {
	setWindow(startMs: number): void;
}

interface HandleWindowBoundaryParams {
	prevWindowStartMs: number;
	currentStartMs: number;
	markets: MarketConfig[];
	states: Map<string, MarketState>;
	timeframe: TimeframeId;
	windowMinutes: number;
	paperDailyLossLimitUsdc: number;
	paperTracker: WindowTracker;
	liveTracker: WindowTracker;
}

export async function handleWindowBoundary(params: HandleWindowBoundaryParams): Promise<void> {
	params.paperTracker.setWindow(params.currentStartMs);
	params.liveTracker.setWindow(params.currentStartMs);

	// Settle paper trades from previous window (even if stopped, to resolve pending trades)
	const finalPrices = new Map<string, number>();
	for (const market of params.markets) {
		const st = params.states.get(`${market.id}:${params.timeframe}`);
		if (st?.prevCurrentPrice !== null && st?.prevCurrentPrice !== undefined) {
			finalPrices.set(market.id, st.prevCurrentPrice);
		}
	}
	const prevPnl = getPaperStats().totalPnl;
	const resolved = resolvePaperTrades(
		params.prevWindowStartMs,
		finalPrices,
		params.paperDailyLossLimitUsdc,
		params.timeframe,
	);
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
		// NOTE: Settlement uses local prevCurrentPrice as a best-effort estimate.
		// The authoritative source of truth is on-chain market resolution data,
		// fetched asynchronously via getLiveStatsFromChain(). Local PnL tracking
		// is used only for the daily spending cap — actual portfolio value comes
		// from the chain via balance polling and reconciler.
		const liveFinalPrices = new Map<string, number>();
		for (const market of params.markets) {
			const st = params.states.get(`${market.id}:${params.timeframe}`);
			if (st?.prevCurrentPrice !== null && st?.prevCurrentPrice !== undefined) {
				liveFinalPrices.set(market.id, st.prevCurrentPrice);
			}
		}
		const liveResolved = resolveLiveTrades(params.prevWindowStartMs, liveFinalPrices, updatePnl, params.timeframe);
		if (liveResolved > 0) {
			const stats = await getLiveStats();
			log.info(
				`Live settled ${liveResolved} trade(s) | W:${stats.wins} L:${stats.losses} | WR:${(stats.winRate * 100).toFixed(0)}% | PnL:${stats.totalPnl.toFixed(2)}`,
			);
		}
	}

	// Clean up trades that were never settled (data unavailable for 2+ windows)
	const windowMin = params.windowMinutes;
	cleanupStalePaperTrades(params.currentStartMs, windowMin, params.paperDailyLossLimitUsdc, params.timeframe);
	if (isLiveRunning()) {
		cleanupStaleLiveTrades(params.currentStartMs, windowMin, updatePnl, params.timeframe);
	}

	if (isLiveRunning()) {
		const wallet = getWallet();
		if (wallet) {
			// Retry previously failed redemptions first
			if (pendingRedemptions.size > 0) {
				log.info(`Retrying ${pendingRedemptions.size} previously failed redemption(s)...`);
				redeemAll(wallet)
					.then((retryResults) => {
						for (const r of retryResults) {
							const key = r.conditionId;
							if (!pendingRedemptions.has(key)) continue;
							if (!r.error) {
								pendingRedemptions.delete(key);
								log.info(`Retry succeeded for condition ${key.slice(0, 10)}`);
							} else {
								const count = (pendingRedemptions.get(key) ?? 0) + 1;
								if (count >= MAX_REDEMPTION_RETRIES) {
									pendingRedemptions.delete(key);
									log.error(`Giving up on redemption for ${key.slice(0, 10)} after ${count} retries`);
								} else {
									pendingRedemptions.set(key, count);
								}
							}
						}
					})
					.catch((err: unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						log.error("Retry redemption error:", message);
					});
			}

			// Normal redemption flow: discover new redeemable positions
			log.info("Window changed, checking for redeemable positions...");
			redeemAll(wallet)
				.then((results) => {
					if (results.length) {
						log.info(`Redeemed ${results.length} position(s)`);
					}
					// Track failed redemptions for retry on next window
					const failed = results.filter((r) => r.error);
					if (failed.length > 0) {
						log.warn(`${failed.length} redemption(s) failed, will retry next window`);
						for (const f of failed) {
							if (!pendingRedemptions.has(f.conditionId)) {
								pendingRedemptions.set(f.conditionId, 1);
							}
						}
					}
				})
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					log.error("Redemption error:", message);
				});
		}
	}
}

/** Get count of pending redemption retries (for observability) */
export function getPendingRedemptionCount(): number {
	return pendingRedemptions.size;
}
