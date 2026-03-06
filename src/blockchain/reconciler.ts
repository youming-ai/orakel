import { createLogger } from "../core/logger.ts";
import { onchainQueries, tradeQueries } from "../db/queries.ts";
import type { ReconResult } from "../types.ts";
import { USDC_E_DECIMALS } from "./contracts.ts";
import { rawToUsdc, statusFromConfidence } from "./reconciler-utils.ts";

const log = createLogger("reconciler");

const DEFAULT_INTERVAL_MS = 60_000;
const USDC_TOLERANCE = 0.05;
const TIME_CLOSE_MS = 2 * 60_000;
const TIME_MAX_MS = 5 * 60_000;
const RECON_BATCH_LIMIT = 50;
const STATUS_QUERY_LIMIT = 10_000;

let walletAddress = "";

type DrizzleTradeRow = Awaited<ReturnType<typeof tradeQueries.getUnreconciledTrades>>[number];
type TradeRow = DrizzleTradeRow & { orderId: string };
type EventRow = Awaited<ReturnType<typeof onchainQueries.getByToken>>[number];

function parseCreatedAtMs(value: string | number | null): number | null {
	if (value === null) return null;
	const rawNum = Number(value);
	if (Number.isFinite(rawNum)) {
		// SQLite created_at is Unix seconds; some rows may already be ms.
		return rawNum > 1_000_000_000_000 ? rawNum : rawNum * 1000;
	}
	const parsed = Date.parse(String(value));
	return Number.isFinite(parsed) ? parsed : null;
}

function hasOrderId(row: DrizzleTradeRow): row is TradeRow {
	return typeof row.orderId === "string" && row.orderId.length > 0;
}

// --- Core reconciliation ---

async function reconcileTrade(trade: TradeRow): Promise<ReconResult> {
	const base: ReconResult = {
		orderId: trade.orderId,
		status: "unreconciled",
		confidence: 0,
		txHash: null,
		blockNumber: null,
	};

	try {
		// 1. Look up known tokens for this trade's market + side
		const allTokens = await onchainQueries.getKnownCtfTokens();
		const matchingTokens = allTokens.filter(
			(t) => t.marketId === trade.market && t.side.toUpperCase().includes(trade.side.toUpperCase()),
		);

		if (matchingTokens.length === 0) {
			return base;
		}

		const tradeTimestamp = new Date(trade.timestamp).getTime();
		if (!Number.isFinite(tradeTimestamp)) {
			return base;
		}

		const expectedUsdcDelta = Number(trade.amount) * Number(trade.price);

		let bestMatch: {
			event: EventRow;
			confidence: number;
			usdcDelta: number;
			tokenId: string;
		} | null = null;

		// 2. For each known token, search on-chain events
		for (const token of matchingTokens) {
			const events = await onchainQueries.getByToken(token.tokenId, RECON_BATCH_LIMIT);

			for (const rawEvent of events) {
				// Check temporal proximity
				const eventTime = parseCreatedAtMs(rawEvent.createdAt);
				if (eventTime === null) continue;
				const timeDiff = Math.abs(eventTime - tradeTimestamp);
				if (timeDiff > TIME_MAX_MS) continue;

				// Scoring: base 0.3 (token match) + USDC delta match 0.3 / CTF transfer 0.15 + time proximity 0.2 + direction 0.15
				let confidence = 0.3;

				if (rawEvent.eventType === "usdc_transfer") {
					if (rawEvent.value === null) continue;
					const usdcValue = rawToUsdc(BigInt(rawEvent.value), USDC_E_DECIMALS);
					const delta = Math.abs(usdcValue - expectedUsdcDelta);
					const tolerance = expectedUsdcDelta * USDC_TOLERANCE;
					if (delta <= tolerance) {
						confidence += 0.3;
					}
				} else if (rawEvent.eventType === "ctf_transfer_single") {
					confidence += 0.15;
				}

				// Time proximity bonus
				if (timeDiff <= TIME_CLOSE_MS) {
					confidence += 0.2;
				}

				// Direction match bonus
				if (walletAddress) {
					const wallet = walletAddress.toLowerCase();
					const toAddr = typeof rawEvent.toAddr === "string" ? rawEvent.toAddr.toLowerCase() : "";
					const fromAddr = typeof rawEvent.fromAddr === "string" ? rawEvent.fromAddr.toLowerCase() : "";
					const isIncoming = toAddr === wallet;
					const isOutgoing = fromAddr === wallet;
					if (isIncoming || isOutgoing) {
						confidence += 0.15;
					}
				}

				if (!bestMatch || confidence > bestMatch.confidence) {
					bestMatch = {
						event: rawEvent,
						confidence,
						usdcDelta:
							rawEvent.eventType === "usdc_transfer" && rawEvent.value !== null
								? rawToUsdc(BigInt(rawEvent.value), USDC_E_DECIMALS)
								: 0,
						tokenId: token.tokenId,
					};
				}
			}
		}

		if (!bestMatch) {
			return base;
		}

		return {
			orderId: trade.orderId,
			status: statusFromConfidence(bestMatch.confidence),
			confidence: bestMatch.confidence,
			txHash: bestMatch.event.txHash,
			blockNumber: bestMatch.event.blockNumber,
		};
	} catch (err) {
		log.warn("reconcileTrade failed", {
			orderId: trade.orderId,
			error: err instanceof Error ? err.message : String(err),
		});
		return base;
	}
}

// --- Batch reconciliation ---

export async function runReconciliation(): Promise<number> {
	let updated = 0;

	try {
		const rows = await tradeQueries.getUnreconciledTrades(RECON_BATCH_LIMIT);

		for (const row of rows) {
			if (!hasOrderId(row)) continue;
			const result = await reconcileTrade(row);
			if (result.status === "unreconciled") continue;

			try {
				await onchainQueries.updateTradeReconStatus(result.orderId, {
					reconStatus: result.status,
					reconConfidence: result.confidence,
					txHash: result.txHash,
					blockNumber: result.blockNumber,
					logIndex: null,
					onchainUsdcDelta: null,
					onchainTokenId: null,
					onchainTokenDelta: null,
				});
				updated++;
				log.debug("Trade reconciled", {
					orderId: result.orderId,
					status: result.status,
					confidence: result.confidence,
				});
			} catch (err) {
				log.warn("Failed to update recon status", {
					orderId: result.orderId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		if (updated > 0) {
			log.info("Reconciliation complete", { updated, total: rows.length });
		}
	} catch (err) {
		log.warn("runReconciliation failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	return updated;
}

// --- Periodic reconciler ---

export function startReconciler(opts?: { intervalMs?: number; wallet?: string }): {
	runNow(): Promise<number>;
	close(): void;
} {
	const intervalMs =
		typeof opts?.intervalMs === "number" && Number.isFinite(opts.intervalMs) && opts.intervalMs > 0
			? opts.intervalMs
			: DEFAULT_INTERVAL_MS;

	if (opts?.wallet) {
		walletAddress = opts.wallet.toLowerCase();
	}

	let closed = false;

	const timer = setInterval(() => {
		if (closed) return;
		void runReconciliation();
	}, intervalMs);

	// Run once immediately
	void runReconciliation();

	return {
		async runNow(): Promise<number> {
			if (closed) return 0;
			return await runReconciliation();
		},
		close(): void {
			closed = true;
			clearInterval(timer);
		},
	};
}

// --- Status query ---

export async function getReconStatus(): Promise<{
	unreconciled: number;
	pending: number;
	confirmed: number;
	disputed: number;
}> {
	const result = {
		unreconciled: 0,
		pending: 0,
		confirmed: 0,
		disputed: 0,
	};

	try {
		const unreconRows = await tradeQueries.getUnreconciledTrades(STATUS_QUERY_LIMIT);
		result.unreconciled = unreconRows.length;

		const reconRows = await tradeQueries.getReconciledTrades(STATUS_QUERY_LIMIT);
		for (const row of reconRows) {
			const status = String(row.reconStatus ?? "");
			if (status === "pending") result.pending++;
			else if (status === "confirmed") result.confirmed++;
			else if (status === "disputed") result.disputed++;
		}
	} catch (err) {
		log.warn("getReconStatus failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	return result;
}
