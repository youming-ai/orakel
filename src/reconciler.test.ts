import { describe, expect, it, vi } from "vitest";

vi.mock("./db.ts", () => ({
	onchainStatements: {},
}));

import { isEventRow, isKnownTokenRow, isTradeRow, rawToUsdc, statusFromConfidence } from "./reconciler.ts";
import type { ReconStatus } from "./types.ts";

describe("statusFromConfidence", () => {
	const confidenceCases: Array<[number, ReconStatus]> = [
		[0.7, "confirmed"],
		[0.8, "confirmed"],
		[1.0, "confirmed"],
		[0.5, "pending"],
		[0.6, "pending"],
		[0.69, "pending"],
		[0.0, "disputed"],
		[0.3, "disputed"],
		[0.49, "disputed"],
	];

	it.each(confidenceCases)("returns %s when confidence is %s", (confidence, expected) => {
		expect(statusFromConfidence(confidence)).toBe(expected);
	});
});

describe("rawToUsdc", () => {
	it("converts valid raw values to USDC", () => {
		const cases: Array<[string, number]> = [
			["1000000", 1],
			["0", 0],
			["500000", 0.5],
		];

		for (const [raw, expected] of cases) {
			expect(rawToUsdc(raw)).toBe(expected);
		}
	});

	it("returns zero for invalid inputs", () => {
		const invalid = ["abc", "Infinity", ""];
		for (const raw of invalid) {
			expect(rawToUsdc(raw)).toBe(0);
		}
	});
});

describe("isTradeRow", () => {
	it("recognizes a valid trade row", () => {
		const trade = {
			order_id: "order-1",
			market: "BTC",
			side: "buy",
			amount: 1,
			price: 100,
			timestamp: "2026-02-26T00:00:00.000Z",
			mode: "live",
			recon_status: null,
		};
		expect(isTradeRow(trade)).toBe(true);
	});

	it("returns false for non-object inputs", () => {
		const invalid = [null, undefined, 42, "row"] as const;
		for (const value of invalid) {
			expect(isTradeRow(value)).toBe(false);
		}
	});

	it("returns false when required trade fields are missing", () => {
		const missingOrder = {
			market: "BTC",
		};
		const missingMarket = {
			order_id: "order-1",
		};
		expect(isTradeRow(missingOrder)).toBe(false);
		expect(isTradeRow(missingMarket)).toBe(false);
	});
});

describe("isEventRow", () => {
	it("recognizes a valid event row", () => {
		const event = {
			tx_hash: "0xabc",
			log_index: 1,
			block_number: 1,
			event_type: "usdc_transfer",
			from_addr: "0xfrom",
			to_addr: "0xto",
			token_id: null,
			value: "1000000",
			raw_data: null,
			created_at: "2026-02-26T00:00:00.000Z",
		};
		expect(isEventRow(event)).toBe(true);
	});

	it("returns false without a tx_hash", () => {
		const missingTx = {
			log_index: 1,
			block_number: 1,
			event_type: "usdc_transfer",
		};
		expect(isEventRow(missingTx)).toBe(false);
	});

	it("returns false without an event_type", () => {
		const missingEvent = {
			tx_hash: "0xabc",
			log_index: 1,
			block_number: 1,
		};
		expect(isEventRow(missingEvent)).toBe(false);
	});
});

describe("isKnownTokenRow", () => {
	it("recognizes a valid token row", () => {
		const token = {
			token_id: "token-1",
			market_id: "BTC",
			side: "buy",
			condition_id: null,
		};
		expect(isKnownTokenRow(token)).toBe(true);
	});

	it("returns false without a token_id or market_id", () => {
		const missingToken = {
			market_id: "BTC",
		};
		const missingMarket = {
			token_id: "token-1",
		};
		expect(isKnownTokenRow(missingToken)).toBe(false);
		expect(isKnownTokenRow(missingMarket)).toBe(false);
	});
});
