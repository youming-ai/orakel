import fs from "node:fs";
import path from "node:path";
import type { CandleWindowTiming } from "../types.ts";

export function clamp(x: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, x));
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatNumber(x: number | null | undefined, digits = 0): string {
	if (x === null || x === undefined || Number.isNaN(x)) return "-";
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(x);
}

export function formatPct(x: number | null | undefined, digits = 2): string {
	if (x === null || x === undefined || Number.isNaN(x)) return "-";
	return `${(x * 100).toFixed(digits)}%`;
}

export function getCandleWindowTiming(windowMinutes: number): CandleWindowTiming {
	const nowMs = Date.now();
	const windowMs = windowMinutes * 60_000;
	const startMs = Math.floor(nowMs / windowMs) * windowMs;
	const endMs = startMs + windowMs;
	const elapsedMs = nowMs - startMs;
	const remainingMs = endMs - nowMs;
	return {
		startMs,
		endMs,
		elapsedMs,
		remainingMs,
		elapsedMinutes: elapsedMs / 60_000,
		remainingMinutes: remainingMs / 60_000,
	};
}

export function ensureDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

/** @deprecated CSV persistence — scheduled for removal. SQLite is the primary backend. */
export function appendCsvRow(filePath: string, header: string[], row: (string | number | null | undefined)[]): void {
	ensureDir(path.dirname(filePath));
	const exists = fs.existsSync(filePath);
	const line = row
		.map((v) => {
			if (v === null || v === undefined) return "";
			const s = String(v);
			if (s.includes(",") || s.includes("\n") || s.includes('"')) {
				return `"${s.replaceAll('"', '""')}"`;
			}
			return s;
		})
		.join(",");

	if (!exists) {
		fs.writeFileSync(filePath, `${header.join(",")}\n${line}\n`, "utf8");
		return;
	}

	fs.appendFileSync(filePath, `${line}\n`, "utf8");
}

/**
 * Estimate Polymarket taker fee for 15-minute crypto markets.
 * Formula: feeRate × (p × (1 - p))^exponent
 * For 15-min/5-min crypto: feeRate = 0.25, exponent = 2
 * @param price - Market price (0-1)
 * @param makerRebate - Maker rebate fraction (0.2 = 20% for 15-min markets)
 * @returns Fee as a fraction of trade amount
 */
export function estimatePolymarketFee(price: number, makerRebate: number = 0): number {
	const FEE_RATE = 0.25;
	const EXPONENT = 2;
	if (price <= 0 || price >= 1) return 0;
	return FEE_RATE * (price * (1 - price)) ** EXPONENT * (1 - makerRebate);
}
