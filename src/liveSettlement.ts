import { pendingLiveStatements, statements } from "./db.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("liveSettlement");

interface PendingLiveTrade {
	orderId: string;
	marketId: string;
	side: "UP" | "DOWN";
	buyPrice: number;
	size: number;
	priceToBeat: number;
	windowStartMs: number;
}

const pendingLiveTrades: PendingLiveTrade[] = [];

export function addPendingLiveTrade(trade: PendingLiveTrade): void {
	pendingLiveTrades.push(trade);
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
): number {
	let resolved = 0;
	const remaining: PendingLiveTrade[] = [];

	for (const trade of pendingLiveTrades) {
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
			log.warn(`Failed to update trade outcome for ${trade.orderId}:`, err);
		}

		// Correct daily PnL: at trade time we debited worst-case (-size*price).
		// If won, actual PnL is +size*(1-price). Correction = actual - worstCase = size.
		if (won) {
			onPnlUpdate(trade.size, "live");
		}

		log.info(
			`Live settle: ${trade.marketId} ${trade.side} ${won ? "WON" : "LOST"} | PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} | final=${finalPrice.toFixed(2)} ptb=${trade.priceToBeat.toFixed(2)}`,
		);
		resolved++;
	}

	// Atomically replace the array with remaining trades
	const nextTrades = [...remaining];
	pendingLiveTrades.length = 0;
	pendingLiveTrades.push(...nextTrades);

	// Clean up resolved trades from DB
	if (resolved > 0) {
		try {
			pendingLiveStatements.deleteResolvedPendingLiveTrades().run({ $windowStartMs: windowStartMs });
		} catch (err) {
			log.warn("Failed to clean up resolved pending live trades from DB:", err);
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
			});
		}
		if (rows.length > 0) {
			log.info(`Restored ${rows.length} pending live trade(s) from DB`);
		}
		return rows.length;
	} catch (err) {
		log.warn("Failed to restore pending live trades from DB:", err);
		return 0;
	}
}

/**
 * Clean up stale pending live trades that were never settled.
 * For live trades, on-chain data is the source of truth — local tracking is just for logging.
 * Trades older than 2 windows are dropped from local tracking and DB.
 */
export function cleanupStaleLiveTrades(currentWindowStartMs: number, windowMinutes: number): number {
	const timeoutMs = windowMinutes * 60_000 * 2; // 2 windows
	let cleaned = 0;
	const remaining: PendingLiveTrade[] = [];

	for (const trade of pendingLiveTrades) {
		const age = currentWindowStartMs - trade.windowStartMs;
		if (age > timeoutMs) {
			log.warn(
				`Stale live trade dropped from local tracking: ${trade.marketId} ${trade.side} orderId=${trade.orderId.slice(0, 12)} (age: ${(age / 60_000).toFixed(0)}min)`,
			);
			try {
				pendingLiveStatements.deletePendingLiveTrade().run({ $orderId: trade.orderId });
			} catch (err) {
				log.warn("Failed to delete stale pending live trade from DB:", err);
			}
			cleaned++;
		} else {
			remaining.push(trade);
		}
	}

	if (cleaned > 0) {
		pendingLiveTrades.length = 0;
		pendingLiveTrades.push(...remaining);
		log.warn(`Dropped ${cleaned} stale live trade(s) from local tracking (on-chain is source of truth)`);
	}

	return cleaned;
}
