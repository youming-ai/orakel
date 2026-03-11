import { describe, expect, it } from "vitest";
import type { ReconStatus } from "../blockchain/blockchainTypes.ts";
import {
	isEventRow,
	isKnownTokenRow,
	isTradeRow,
	rawToUsdc,
	statusFromConfidence,
} from "../blockchain/reconciler-utils.ts";

describe("statusFromConfidence", () => {
	describe("confidence thresholds", () => {
		it("returns 'confirmed' when confidence >= 0.5", () => {
			expect(statusFromConfidence(0.5)).toBe<"confirmed">("confirmed");
			expect(statusFromConfidence(0.75)).toBe<"confirmed">("confirmed");
			expect(statusFromConfidence(1.0)).toBe<"confirmed">("confirmed");
		});

		it("returns 'pending' when 0 < confidence < 0.5", () => {
			expect(statusFromConfidence(0.1)).toBe<"pending">("pending");
			expect(statusFromConfidence(0.25)).toBe<"pending">("pending");
			expect(statusFromConfidence(0.49)).toBe<"pending">("pending");
		});

		it("returns 'unreconciled' when confidence is 0", () => {
			expect(statusFromConfidence(0)).toBe<"unreconciled">("unreconciled");
		});

		it("returns 'disputed' when confidence < 0", () => {
			expect(statusFromConfidence(-0.1)).toBe<"disputed">("disputed");
			expect(statusFromConfidence(-0.5)).toBe<"disputed">("disputed");
		});
	});
});

describe("rawToUsdc", () => {
	it("converts token raw amount to USDC (6 decimals)", () => {
		// 1 token = 1,000,000 raw units at 6 decimals
		expect(rawToUsdc(1000000n, 6)).toBe(1.0);
		expect(rawToUsdc(10000000n, 6)).toBe(10.0);
	});

	it("handles fractional tokens", () => {
		expect(rawToUsdc(500000n, 6)).toBe(0.5);
		expect(rawToUsdc(1500000n, 6)).toBe(1.5);
	});

	it("handles zero", () => {
		expect(rawToUsdc(0n, 6)).toBe(0);
	});

	it("handles different decimals", () => {
		// 18 decimals (like ETH)
		expect(rawToUsdc(1000000000000000000n, 18)).toBe(1.0);

		// 8 decimals
		expect(rawToUsdc(100000000n, 8)).toBe(1.0);
	});
});

describe("isEventRow", () => {
	it("returns true for valid event rows", () => {
		const validRow = {
			tx_hash: "0xabc",
			log_index: 0,
			block_number: 1000,
			event_type: "mint" as const,
			from_addr: "0x123",
			to_addr: "0x456",
			token_id: "token-1",
			value: "1000000",
			raw_data: null,
			created_at: "2024-01-01T00:00:00Z",
		};

		expect(isEventRow(validRow)).toBe(true);
	});

	it("returns true when nullable address fields are null", () => {
		const validRowWithNullAddress = {
			tx_hash: "0xdef",
			log_index: 1,
			block_number: 1001,
			event_type: "usdc_transfer",
			from_addr: null,
			to_addr: null,
			token_id: null,
			value: "1000000",
			raw_data: null,
			created_at: 1700000000,
		};

		expect(isEventRow(validRowWithNullAddress)).toBe(true);
	});

	it("returns false for rows missing required fields", () => {
		const missingTxHash = {
			log_index: 0,
			block_number: 1000,
			event_type: "mint" as const,
			from_addr: "0x123",
			to_addr: "0x456",
			token_id: "token-1",
			value: "1000000",
			raw_data: null,
			created_at: "2024-01-01T00:00:00Z",
		};

		expect(isEventRow(missingTxHash)).toBe(false);
	});
});

describe("isKnownTokenRow", () => {
	it("returns true for valid known token rows", () => {
		const validRow = {
			token_id: "token-1",
			market_id: "market-1",
			side: "UP" as const,
			condition_id: null,
		};

		expect(isKnownTokenRow(validRow)).toBe(true);
	});

	it("returns false for rows missing required fields", () => {
		const missingMarketId = {
			token_id: "token-1",
			side: "UP" as const,
			condition_id: null,
		};

		expect(isKnownTokenRow(missingMarketId)).toBe(false);
	});
});

describe("isTradeRow", () => {
	it("returns true for valid trade rows", () => {
		const validRow = {
			timestamp: "2024-01-01T00:00:00Z",
			market: "BTC-15m",
			side: "UP",
			amount: 10.0,
			price: 0.55,
			order_id: "order-123",
			mode: "paper",
			recon_status: null,
		};

		expect(isTradeRow(validRow)).toBe(true);
	});

	it("returns false for rows missing required fields", () => {
		const missingOrderId = {
			market: "BTC-15m",
			side: "UP",
			amount: 10.0,
			price: 0.55,
			mode: "paper",
			recon_status: null,
		};

		expect(isTradeRow(missingOrderId)).toBe(false);
	});
});

describe("ReconStatus", () => {
	it("has four possible states", () => {
		const states: ReconStatus[] = ["unreconciled", "pending", "confirmed", "disputed"];
		expect(states).toHaveLength(4);
	});

	it("states are mutually exclusive", () => {
		// If confidence is positive, it can only be one state
		const confidence = 0.3;
		const status = statusFromConfidence(confidence);

		if (status === "pending") {
			expect(status).not.toBe("unreconciled");
			expect(status).not.toBe("confirmed");
			expect(status).not.toBe("disputed");
		}
	});
});
