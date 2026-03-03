import type { ReconStatus } from "../types.ts";
import { USDC_E_DECIMALS } from "./contracts.ts";

// --- Local row types for type guards ---

export interface TradeRow {
	order_id: string;
	market: string;
	side: string;
	amount: number;
	price: number;
	timestamp: string;
	mode: string;
	recon_status: string | null;
}

export interface EventRow {
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

// --- Pure utility functions (no database dependencies) ---

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
	if (confidence < 0) return "disputed";
	if (confidence === 0) return "unreconciled";
	if (confidence < 0.5) return "pending";
	return "confirmed";
}

export function rawToUsdc(raw: bigint, decimals: number): number {
	if (raw < 0n) return -rawToUsdc(-raw, decimals);
	return Number(raw) / 10 ** decimals;
}
