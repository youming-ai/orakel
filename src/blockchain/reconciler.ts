import type { ReconResult } from "../contracts/stateTypes.ts";
import { createLogger } from "../core/logger.ts";
import { onchainQueries, tradeQueries } from "../db/queries.ts";
import { USDC_E_DECIMALS } from "./contracts.ts";
import { statusFromConfidence } from "./reconciler-utils.ts";
import {
	buildBaseReconResult,
	findBestReconMatch,
	findMatchingTokens,
	type ReconEventCandidate,
	type ReconKnownTokenCandidate,
	type ReconTradeCandidate,
} from "./reconcilerMatching.ts";

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
type EventRow = Awaited<ReturnType<typeof onchainQueries.getByToken>>[number] & ReconEventCandidate;
type KnownTokenRow = Awaited<ReturnType<typeof onchainQueries.getKnownCtfTokens>>[number] & ReconKnownTokenCandidate;

function hasOrderId(row: DrizzleTradeRow): row is TradeRow {
	return typeof row.orderId === "string" && row.orderId.length > 0;
}

// --- Core reconciliation ---

async function reconcileTrade(trade: TradeRow): Promise<ReconResult> {
	const base = buildBaseReconResult(trade.orderId);

	try {
		const allTokens = (await onchainQueries.getKnownCtfTokens()) as KnownTokenRow[];
		const reconTrade: ReconTradeCandidate = {
			orderId: trade.orderId,
			market: trade.market,
			side: trade.side,
			amount: trade.amount,
			price: trade.price,
			timestamp: trade.timestamp,
		};
		const matchingTokens = findMatchingTokens(allTokens, reconTrade);
		if (matchingTokens.length === 0) {
			return base;
		}

		const bestMatch = await findBestReconMatch({
			trade: reconTrade,
			matchingTokens,
			loadEvents: async (tokenId: string) =>
				(await onchainQueries.getByToken(tokenId, RECON_BATCH_LIMIT)) as EventRow[],
			walletAddress,
			usdcDecimals: USDC_E_DECIMALS,
			usdcTolerance: USDC_TOLERANCE,
			timeCloseMs: TIME_CLOSE_MS,
			timeMaxMs: TIME_MAX_MS,
		});
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
