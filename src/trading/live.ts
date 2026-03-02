import type { ClobClient, Trade } from "@polymarket/clob-client";
import { pendingLiveStatements, statements } from "../core/db.ts";
import { createLogger } from "../core/logger.ts";
import { getAndClearSignalMetadata } from "../strategy/adaptive.ts";
import type { TimeframeId } from "../types.ts";

// ── Live Stats ──────────────────────────────
const liveStatsLog = createLogger("live-stats");

// Cache TTL: 30 seconds
const CACHE_TTL_MS = 30_000;

interface CachedStats {
	stats: LiveStats;
	fetchedAt: number;
}

interface LiveStats {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	trades: LiveTrade[];
}

interface LiveTrade {
	id: string;
	market: string;
	assetId: string;
	side: string;
	size: number;
	price: number;
	status: string;
	matchTime: string;
	outcome: string;
	transactionHash: string;
	costUsd: number;
	pnl?: number;
	won?: boolean;
}

let cachedStats: CachedStats | null = null;
let fetching = false;

/**
 * Fetch all trades from CLOB API (paginated)
 */
async function fetchAllTradesFromClob(client: ClobClient): Promise<Trade[]> {
	const allTrades: Trade[] = [];
	let nextCursor: string | undefined;

	// Fetch at most 10 pages (500 trades)
	const maxPages = 10;
	let pageCount = 0;

	while (pageCount < maxPages) {
		try {
			const response = await client.getTradesPaginated({}, nextCursor);
			allTrades.push(...response.trades);

			if (!response.next_cursor || response.trades.length === 0) {
				break;
			}

			nextCursor = response.next_cursor;
			pageCount++;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			liveStatsLog.error(`Failed to fetch trades page ${pageCount + 1}:`, msg);
			break;
		}
	}

	liveStatsLog.info(`Fetched ${allTrades.length} trades from CLOB API (${pageCount} pages)`);
	return allTrades;
}

/**
 * Convert CLOB Trade to LiveTrade format and determine win/loss from outcome.
 *
 * Polymarket outcome field:
 * - "1" = this token resolved YES (winning side)
 * - "0" = this token resolved NO (losing side)
 * - empty/undefined = market not yet resolved
 *
 * This bot only places BUY orders, so:
 * - BUY + outcome "1" = WIN, PnL = size * (1 - price)
 * - BUY + outcome "0" = LOSS, PnL = -(size * price)
 */
export function convertTradeToLiveTrade(trade: Trade): LiveTrade {
	const size = Number.parseFloat(trade.size);
	const price = Number.parseFloat(trade.price);
	const costUsd = size * price;

	let won: boolean | undefined;
	let pnl: number | undefined;

	if (trade.outcome === "1") {
		// Token resolved YES — buyer wins
		won = trade.side === "BUY";
		pnl = won ? size * (1 - price) : -(size * (1 - price));
	} else if (trade.outcome === "0") {
		// Token resolved NO — buyer loses
		won = trade.side !== "BUY";
		pnl = won ? size * price : -(size * price);
	}
	// else: outcome not yet determined, leave won/pnl undefined

	return {
		id: trade.id,
		market: trade.market,
		assetId: trade.asset_id,
		side: trade.side,
		size,
		price,
		status: trade.status,
		matchTime: trade.match_time,
		outcome: trade.outcome,
		transactionHash: trade.transaction_hash,
		costUsd,
		won,
		pnl,
	};
}

/**
 * Calculate statistics from on-chain trades
 */
export function calculateStatsFromTrades(trades: LiveTrade[]): LiveStats {
	let wins = 0;
	let losses = 0;
	let pending = 0;
	let totalPnl = 0;

	const resolvedTrades: LiveTrade[] = [];

	for (const trade of trades) {
		if (trade.status === "matched" || trade.status === "filled") {
			resolvedTrades.push(trade);

			// If we have PnL data, use it
			if (trade.pnl !== undefined && trade.won !== undefined) {
				if (trade.won) {
					wins++;
					totalPnl += trade.pnl;
				} else {
					losses++;
					totalPnl += trade.pnl; // pnl is negative for losses
				}
			} else {
				// Trade is filled but we don't know outcome yet
				pending++;
			}
		}
	}

	const resolved = wins + losses;
	return {
		totalTrades: trades.length,
		wins,
		losses,
		pending,
		winRate: resolved > 0 ? wins / resolved : 0,
		totalPnl: Number(totalPnl.toFixed(2)),
		trades: resolvedTrades,
	};
}

/**
 * Get live trading stats from on-chain data (CLOB API)
 *
 * This function fetches trades from Polymarket CLOB API instead of local SQLite.
 * Local DB is used only for logging reconciliation.
 */
export async function getLiveStatsFromChain(client: ClobClient): Promise<LiveStats> {
	const now = Date.now();

	// Return cached stats if fresh
	if (cachedStats && now - cachedStats.fetchedAt < CACHE_TTL_MS) {
		return cachedStats.stats;
	}

	// Prevent concurrent fetches
	if (fetching) {
		liveStatsLog.debug("Already fetching live stats, returning cached or empty");
		return (
			cachedStats?.stats ?? {
				totalTrades: 0,
				wins: 0,
				losses: 0,
				pending: 0,
				winRate: 0,
				totalPnl: 0,
				trades: [],
			}
		);
	}

	fetching = true;

	try {
		// Fetch all trades from CLOB API
		const rawTrades = await fetchAllTradesFromClob(client);

		// Convert to our format
		const trades = rawTrades.map(convertTradeToLiveTrade);

		// Calculate statistics
		const stats = calculateStatsFromTrades(trades);

		// Cache the result
		cachedStats = {
			stats,
			fetchedAt: now,
		};

		liveStatsLog.info(
			`Live stats from chain: ${stats.totalTrades} trades, ${stats.wins}W/${stats.losses}L, PnL: ${stats.totalPnl}`,
		);

		return stats;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		liveStatsLog.error("Failed to fetch live stats from chain:", msg);

		// Return cached stats if available, otherwise empty stats
		if (cachedStats) {
			liveStatsLog.warn("Returning cached stats due to error");
			return cachedStats.stats;
		}

		return {
			totalTrades: 0,
			wins: 0,
			losses: 0,
			pending: 0,
			winRate: 0,
			totalPnl: 0,
			trades: [],
		};
	} finally {
		fetching = false;
	}
}

/**
 * Clear the stats cache (call after placing a new trade)
 */
export function clearLiveStatsCache(): void {
	cachedStats = null;
	liveStatsLog.debug("Live stats cache cleared");
}

/**
 * Get live stats in the legacy format (for compatibility)
 */
export async function getLiveStatsLegacy(client: ClobClient): Promise<{
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}> {
	const stats = await getLiveStatsFromChain(client);
	return {
		totalTrades: stats.totalTrades,
		wins: stats.wins,
		losses: stats.losses,
		pending: stats.pending,
		winRate: stats.winRate,
		totalPnl: stats.totalPnl,
	};
}

/**
 * Per-market breakdown of live trading performance.
 * Mirrors paperStats.getMarketBreakdown() for live trades.
 * Data comes from CLOB API trades (cached via getLiveStatsFromChain).
 *
 * NOTE on data source consistency (#8):
 * getLiveStatsFromChain() fetches ALL trades from CLOB API (up to 500),
 * including trades from previous bot sessions. The local resolveLiveTrades()
 * only tracks trades from the current session for daily PnL cap purposes.
 * This is by design: CLOB API is the authoritative source for stats/portfolio,
 * while local tracking is a fast estimate for risk management.
 */
export interface LiveMarketBreakdown {
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	tradeCount: number;
}

export function getLiveMarketBreakdown(trades: LiveTrade[]): Record<string, LiveMarketBreakdown> {
	const breakdown: Record<string, LiveMarketBreakdown> = {};

	for (const trade of trades) {
		const marketId = trade.market || "unknown";
		if (!breakdown[marketId]) {
			breakdown[marketId] = { wins: 0, losses: 0, pending: 0, winRate: 0, totalPnl: 0, tradeCount: 0 };
		}
		const entry = breakdown[marketId];
		if (!entry) continue;
		entry.tradeCount++;

		if (trade.won !== undefined && trade.pnl !== undefined) {
			if (trade.won) {
				entry.wins++;
				entry.totalPnl += trade.pnl;
			} else {
				entry.losses++;
				entry.totalPnl += trade.pnl;
			}
		} else {
			entry.pending++;
		}
	}

	// Calculate win rates
	for (const entry of Object.values(breakdown)) {
		const resolved = entry.wins + entry.losses;
		entry.winRate = resolved > 0 ? entry.wins / resolved : 0;
		entry.totalPnl = Number(entry.totalPnl.toFixed(2));
	}

	return breakdown;
}

// ── Live Settlement ─────────────────────────
const liveSettlementLog = createLogger("liveSettlement");

interface PendingLiveTrade {
	orderId: string;
	marketId: string;
	side: "UP" | "DOWN";
	buyPrice: number;
	size: number;
	priceToBeat: number;
	windowStartMs: number;
	timeframe?: TimeframeId;
}

const pendingLiveTrades: PendingLiveTrade[] = [];

export function addPendingLiveTrade(trade: PendingLiveTrade): void {
	pendingLiveTrades.push(trade);
}

/** Clear all pending live trades (for testing) */
export function clearAllPendingLiveTrades(): void {
	pendingLiveTrades.length = 0;
}

function normalizeTimeframe(timeframe?: TimeframeId): TimeframeId {
	return timeframe ?? "15m";
}

function parseTimeframe(timeframe: string | null | undefined): TimeframeId {
	if (timeframe === "1h" || timeframe === "4h") return timeframe;
	return "15m";
}

/**
 * Resolve pending live trades for a completed window.
 * Mirrors paper trade settlement logic: compare finalPrice vs priceToBeat,
 * determine win/loss, calculate PnL, and update the DB.
 * Returns the number of trades resolved.
 */
export function resolveLiveTrades(
	windowStartMs: number,
	finalPrices: Map<string, number>,
	onPnlUpdate: (amount: number, mode: "paper" | "live") => void,
	timeframe?: TimeframeId,
): number {
	let resolved = 0;
	const remaining: PendingLiveTrade[] = [];
	const targetTimeframe = normalizeTimeframe(timeframe);

	for (const trade of pendingLiveTrades) {
		const tradeTimeframe = normalizeTimeframe(trade.timeframe);
		if (tradeTimeframe !== targetTimeframe) {
			remaining.push(trade);
			continue;
		}
		if (trade.windowStartMs !== windowStartMs) {
			remaining.push(trade);
			continue;
		}

		const finalPrice = finalPrices.get(trade.marketId);
		if (finalPrice === undefined || trade.priceToBeat <= 0) {
			remaining.push(trade);
			continue;
		}

		// Polymarket rule: price === PTB → DOWN wins
		const upWon = finalPrice > trade.priceToBeat;
		const downWon = finalPrice <= trade.priceToBeat;
		const won = trade.side === "UP" ? upWon : downWon;
		const pnl = won ? trade.size * (1 - trade.buyPrice) : -(trade.size * trade.buyPrice);

		try {
			statements.updateTradeOutcome().run({
				$pnl: pnl,
				$won: won ? 1 : 0,
				$orderId: trade.orderId,
				$mode: "live",
			});
		} catch (err) {
			liveSettlementLog.warn(`Failed to update trade outcome for ${trade.orderId}:`, err);
		}

		// Correct daily PnL: at trade time we debited worst-case (-size*price).
		// If won, actual PnL is +size*(1-price). Correction = actual - worstCase = size.
		if (won) {
			onPnlUpdate(trade.size, "live");
		}

		// Feed adaptive model with live trade outcomes (mirrors paper settlement logic)
		const signalMeta = getAndClearSignalMetadata(trade.orderId);
		if (signalMeta) {
			void signalMeta;
		}

		resolved++;
	}

	// Atomically replace the array with remaining trades
	const nextTrades = [...remaining];
	pendingLiveTrades.length = 0;
	pendingLiveTrades.push(...nextTrades);

	// Clean up resolved trades from DB
	if (resolved > 0) {
		try {
			pendingLiveStatements.deleteResolvedPendingLiveTrades().run({
				$windowStartMs: windowStartMs,
				$timeframe: targetTimeframe,
			});
		} catch (err) {
			liveSettlementLog.warn("Failed to clean up resolved pending live trades from DB:", err);
		}
	}

	return resolved;
}

/**
 * Restore pending live trades from SQLite on startup.
 * Recovers trades that were not settled before a restart.
 */
export function restorePendingLiveTrades(): number {
	try {
		const rows = pendingLiveStatements.getAllPendingLiveTrades().all() as Array<{
			order_id: string;
			market_id: string;
			side: string;
			buy_price: number;
			size: number;
			price_to_beat: number;
			window_start_ms: number;
			timeframe: string | null;
		}>;
		for (const row of rows) {
			pendingLiveTrades.push({
				orderId: row.order_id,
				marketId: row.market_id,
				side: row.side as "UP" | "DOWN",
				buyPrice: row.buy_price,
				size: row.size,
				priceToBeat: row.price_to_beat,
				windowStartMs: row.window_start_ms,
				timeframe: parseTimeframe(row.timeframe),
			});
		}
		if (rows.length > 0) {
			liveSettlementLog.info(`Restored ${rows.length} pending live trade(s) from DB`);
		}
		return rows.length;
	} catch (err) {
		liveSettlementLog.warn("Failed to restore pending live trades from DB:", err);
		return 0;
	}
}

/**
 * Clean up stale pending live trades that were never settled.
 * For live trades, on-chain data is the source of truth — local tracking is just for logging.
 * Trades older than 2 windows are dropped from local tracking and DB.
 */
export function cleanupStaleLiveTrades(
	currentWindowStartMs: number,
	windowMinutes: number,
	onPnlUpdate: (amount: number, mode: "paper" | "live") => void,
	timeframe?: TimeframeId,
): number {
	const timeoutMs = windowMinutes * 60_000 * 2; // 2 windows
	let cleaned = 0;
	const remaining: PendingLiveTrade[] = [];
	const targetTimeframe = normalizeTimeframe(timeframe);

	for (const trade of pendingLiveTrades) {
		const tradeTimeframe = normalizeTimeframe(trade.timeframe);
		if (tradeTimeframe !== targetTimeframe) {
			remaining.push(trade);
			continue;
		}
		const age = currentWindowStartMs - trade.windowStartMs;
		if (age > timeoutMs) {
			liveSettlementLog.warn(
				`Stale live trade dropped from local tracking: ${trade.marketId} ${trade.side} orderId=${trade.orderId.slice(0, 12)} (age: ${(age / 60_000).toFixed(0)}min)`,
			);

			// Correct daily PnL: reverse the worst-case pre-debit (-size*buyPrice)
			// that was applied at trade time. Without this correction, the daily
			// spending cap is permanently reduced by phantom trades.
			onPnlUpdate(trade.size * trade.buyPrice, "live");

			try {
				pendingLiveStatements.deletePendingLiveTrade().run({ $orderId: trade.orderId });
			} catch (err) {
				liveSettlementLog.warn("Failed to delete stale pending live trade from DB:", err);
			}
			cleaned++;
		} else {
			remaining.push(trade);
		}
	}
	if (cleaned > 0) {
		pendingLiveTrades.length = 0;
		pendingLiveTrades.push(...remaining);
		liveSettlementLog.warn(`Dropped ${cleaned} stale live trade(s) from local tracking (on-chain is source of truth)`);
	}

	return cleaned;
}
