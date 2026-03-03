import { USDC_E_DECIMALS } from "./contracts.ts";
import { onchainStatements } from "./db.ts";
import { createLogger } from "./logger.ts";
import type { ReconResult, ReconStatus } from "./types.ts";

const log = createLogger("reconciler");

const DEFAULT_INTERVAL_MS = 60_000;
const USDC_TOLERANCE = 0.05;
const TIME_CLOSE_MS = 2 * 60_000;
const TIME_MAX_MS = 5 * 60_000;
const RECON_BATCH_LIMIT = 50;
const STATUS_QUERY_LIMIT = 10_000;

let walletAddress = "";

// --- Local row types ---

interface TradeRow {
	order_id: string;
	market: string;
	side: string;
	amount: number;
	price: number;
	timestamp: string;
	mode: string;
	recon_status: string | null;
}

interface EventRow {
	tx_hash: string;
	log_index: number;
	block_number: number;
	event_type: string;
	from_addr: string;
	to_addr: string;
	token_id: string | null;
	value: string;
	raw_data: string | null;
	created_at: string;
}

interface KnownTokenRow {
	token_id: string;
	market_id: string;
	side: string;
	condition_id: string | null;
}

// --- Helpers ---

export function isTradeRow(row: unknown): row is TradeRow {
	if (!row || typeof row !== "object") return false;
	const r = row as Record<string, unknown>;
	return typeof r.order_id === "string" && typeof r.market === "string";
}

export function isEventRow(row: unknown): row is EventRow {
	if (!row || typeof row !== "object") return false;
	const r = row as Record<string, unknown>;
	return typeof r.tx_hash === "string" && typeof r.event_type === "string";
}

export function isKnownTokenRow(row: unknown): row is KnownTokenRow {
	if (!row || typeof row !== "object") return false;
	const r = row as Record<string, unknown>;
	return typeof r.token_id === "string" && typeof r.market_id === "string";
}

export function statusFromConfidence(confidence: number): ReconStatus {
	if (confidence >= 0.7) return "confirmed";
	if (confidence >= 0.5) return "pending";
	return "disputed";
}

export function rawToUsdc(raw: string): number {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 0;
	return n / 10 ** USDC_E_DECIMALS;
}

// --- Core reconciliation ---

function reconcileTrade(trade: TradeRow): ReconResult {
	const base: ReconResult = {
		orderId: trade.order_id,
		status: "unreconciled",
		confidence: 0,
		txHash: null,
		blockNumber: null,
	};

	try {
		// 1. Look up known tokens for this trade's market + side
		const allTokensRaw = onchainStatements.getKnownCtfTokens().all({});
		if (!Array.isArray(allTokensRaw)) {
			log.error("getKnownCtfTokens returned non-array");
			return base;
		}
		const allTokens = allTokensRaw as unknown[];
		const matchingTokens = allTokens
			.filter(isKnownTokenRow)
			.filter((t) => t.market_id === trade.market && t.side.toUpperCase().includes(trade.side.toUpperCase()));

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
			const events = onchainStatements
				.getOnchainEventsByToken()
				.all({ $tokenId: token.token_id, $limit: RECON_BATCH_LIMIT }) as unknown[];

			for (const rawEvent of events) {
				if (!isEventRow(rawEvent)) continue;

				// Check temporal proximity
				const eventTime = new Date(rawEvent.created_at).getTime();
				if (!Number.isFinite(eventTime)) continue;
				const timeDiff = Math.abs(eventTime - tradeTimestamp);
				if (timeDiff > TIME_MAX_MS) continue;

				// Scoring: base 0.3 (token match) + USDC delta match 0.3 / CTF transfer 0.15 + time proximity 0.2 + direction 0.15
				let confidence = 0.3;

				if (rawEvent.event_type === "usdc_transfer") {
					const usdcValue = rawToUsdc(rawEvent.value);
					const delta = Math.abs(usdcValue - expectedUsdcDelta);
					const tolerance = expectedUsdcDelta * USDC_TOLERANCE;
					if (delta <= tolerance) {
						confidence += 0.3;
					}
				} else if (rawEvent.event_type === "ctf_transfer_single") {
					confidence += 0.15;
				}

				// Time proximity bonus
				if (timeDiff <= TIME_CLOSE_MS) {
					confidence += 0.2;
				}

				// Direction match bonus
				if (walletAddress) {
					const wallet = walletAddress.toLowerCase();
					const isIncoming = rawEvent.to_addr.toLowerCase() === wallet;
					const isOutgoing = rawEvent.from_addr.toLowerCase() === wallet;
					if (isIncoming || isOutgoing) {
						confidence += 0.15;
					}
				}

				if (!bestMatch || confidence > bestMatch.confidence) {
					bestMatch = {
						event: rawEvent,
						confidence,
						usdcDelta: rawEvent.event_type === "usdc_transfer" ? rawToUsdc(rawEvent.value) : 0,
						tokenId: token.token_id,
					};
				}
			}
		}

		if (!bestMatch) {
			return base;
		}

		return {
			orderId: trade.order_id,
			status: statusFromConfidence(bestMatch.confidence),
			confidence: bestMatch.confidence,
			txHash: bestMatch.event.tx_hash,
			blockNumber: bestMatch.event.block_number,
		};
	} catch (err) {
		log.warn("reconcileTrade failed", {
			orderId: trade.order_id,
			error: err instanceof Error ? err.message : String(err),
		});
		return base;
	}
}

// --- Batch reconciliation ---

export async function runReconciliation(): Promise<number> {
	let updated = 0;

	try {
		const rows = onchainStatements.getUnreconciledTrades().all({ $limit: RECON_BATCH_LIMIT }) as unknown[];

		for (const rawRow of rows) {
			if (!isTradeRow(rawRow)) continue;

			const result = reconcileTrade(rawRow);
			if (result.status === "unreconciled") continue;

			try {
				onchainStatements.updateTradeReconStatus().run({
					$orderId: result.orderId,
					$reconStatus: result.status,
					$reconConfidence: result.confidence,
					$txHash: result.txHash,
					$blockNumber: result.blockNumber,
					$logIndex: null,
					$onchainUsdcDelta: null,
					$onchainTokenId: null,
					$onchainTokenDelta: null,
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

export function getReconStatus(): {
	unreconciled: number;
	pending: number;
	confirmed: number;
	disputed: number;
} {
	const result = {
		unreconciled: 0,
		pending: 0,
		confirmed: 0,
		disputed: 0,
	};

	try {
		const unreconRows = onchainStatements.getUnreconciledTrades().all({ $limit: STATUS_QUERY_LIMIT }) as unknown[];
		result.unreconciled = unreconRows.length;

		const reconRows = onchainStatements.getReconciledTrades().all({ $limit: STATUS_QUERY_LIMIT }) as unknown[];
		for (const raw of reconRows) {
			if (!raw || typeof raw !== "object") continue;
			const row = raw as Record<string, unknown>;
			const status = String(row.recon_status ?? "");
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
