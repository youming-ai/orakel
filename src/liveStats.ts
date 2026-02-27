import type { ClobClient, Trade } from "@polymarket/clob-client";
import { createLogger } from "./logger.ts";

const log = createLogger("live-stats");

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
			log.error(`Failed to fetch trades page ${pageCount + 1}:`, msg);
			break;
		}
	}

	log.info(`Fetched ${allTrades.length} trades from CLOB API (${pageCount} pages)`);
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
		log.debug("Already fetching live stats, returning cached or empty");
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

		log.info(
			`Live stats from chain: ${stats.totalTrades} trades, ${stats.wins}W/${stats.losses}L, PnL: ${stats.totalPnl}`,
		);

		return stats;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Failed to fetch live stats from chain:", msg);

		// Return cached stats if available, otherwise empty stats
		if (cachedStats) {
			log.warn("Returning cached stats due to error");
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
	log.debug("Live stats cache cleared");
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
