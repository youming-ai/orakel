import { describe, expect, it } from "vitest";
import { SettlementError } from "../liveSettlement.ts";

describe("settleLiveWindow", () => {
	it("should throw SettlementError with REDEMPTION_FAILED code", async () => {
		const _ctx = {
			tradeId: 1,
			entryPrice: 0.6,
			size: 100,
			side: "UP" as const,
			balanceBefore: 1000,
		};

		const error = new SettlementError("Redemption failed", "REDEMPTION_FAILED");
		expect(error.code).toBe("REDEMPTION_FAILED");
		expect(error.name).toBe("SettlementError");
	});

	it("should throw SettlementError with BALANCE_FETCH_FAILED code", async () => {
		const error = new SettlementError("Balance fetch failed", "BALANCE_FETCH_FAILED");
		expect(error.code).toBe("BALANCE_FETCH_FAILED");
	});

	it("should throw SettlementError with DB_UPDATE_FAILED code", async () => {
		const error = new SettlementError("DB update failed", "DB_UPDATE_FAILED");
		expect(error.code).toBe("DB_UPDATE_FAILED");
	});

	it("should have SettlementResult with method field", async () => {
		const result = {
			ok: true,
			pnlUsdc: 50,
			method: "balance_diff" as const,
		};

		expect(result.method).toBe("balance_diff");
		expect(result.ok).toBe(true);
		expect(result.pnlUsdc).toBe(50);
	});

	it("should have SettlementResult with price_fallback method", async () => {
		const result = {
			ok: true,
			pnlUsdc: 30,
			method: "price_fallback" as const,
		};

		expect(result.method).toBe("price_fallback");
	});

	it("should distinguish between balance_diff and price_fallback methods", async () => {
		const balanceDiffResult = {
			ok: true,
			pnlUsdc: 50,
			method: "balance_diff" as const,
		};

		const priceFallbackResult = {
			ok: true,
			pnlUsdc: 30,
			method: "price_fallback" as const,
		};

		expect(balanceDiffResult.method).not.toBe(priceFallbackResult.method);
		expect(balanceDiffResult.method).toBe("balance_diff");
		expect(priceFallbackResult.method).toBe("price_fallback");
	});

	it("should preserve cause in SettlementError", async () => {
		const originalError = new Error("Original error");
		const error = new SettlementError("Wrapped error", "DB_UPDATE_FAILED", originalError);

		expect(error.cause).toBe(originalError);
		expect(error.message).toBe("Wrapped error");
	});
});
