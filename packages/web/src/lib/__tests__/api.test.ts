import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { TradeRecordSchema } from "../schemas";

describe("ApiError", () => {
	it("should create error with message", () => {
		const error = new ApiError("Test error");
		expect(error.message).toBe("Test error");
		expect(error.name).toBe("ApiError");
	});

	it("should store status code", () => {
		const error = new ApiError("Not found", 404);
		expect(error.statusCode).toBe(404);
	});

	it("should store response object", () => {
		const mockResponse = { status: 500 } as Response;
		const error = new ApiError("Server error", 500, mockResponse);
		expect(error.response).toBe(mockResponse);
	});
});

describe("API safe parsing", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("should throw ApiError for invalid trade data", async () => {
		const mockFetch = vi.mocked(global.fetch);
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => [{ invalid: "data" }],
		} as Response);

		const result = TradeRecordSchema.safeParse({ invalid: "data" });
		expect(result.success).toBe(false);
	});

	it("should parse valid trade data correctly", async () => {
		const validTrade = {
			id: 1,
			mode: "live" as const,
			windowSlug: "test-window",
			windowStartMs: 1700000000000,
			windowEndMs: 1700000300000,
			side: "UP" as const,
			price: "0.6",
			size: "100",
			priceToBeat: "50000",
			entryBtcPrice: "51000",
			edge: "0.05",
			modelProb: "0.65",
			marketProb: "0.6",
			phase: "MID" as const,
			orderId: "order-123",
			outcome: null,
			settleBtcPrice: null,
			pnlUsdc: null,
			createdAt: "2024-01-01T00:00:00Z",
			settledAt: null,
		};

		const result = TradeRecordSchema.safeParse(validTrade);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.mode).toBe("live");
		}
	});

	it("should reject invalid mode", async () => {
		const invalidTrade = {
			id: 1,
			mode: "invalid",
			windowSlug: "test-window",
			windowStartMs: 1700000000000,
			windowEndMs: 1700000300000,
			side: "UP",
			price: "0.6",
			size: "100",
			priceToBeat: "50000",
			entryBtcPrice: "51000",
			edge: "0.05",
			modelProb: "0.65",
			marketProb: "0.6",
			phase: "MID",
			orderId: "order-123",
			outcome: null,
			settleBtcPrice: null,
			pnlUsdc: null,
			createdAt: "2024-01-01T00:00:00Z",
			settledAt: null,
		};

		const result = TradeRecordSchema.safeParse(invalidTrade);
		expect(result.success).toBe(false);
	});

	it("should reject invalid side", async () => {
		const invalidTrade = {
			id: 1,
			mode: "live",
			windowSlug: "test-window",
			windowStartMs: 1700000000000,
			windowEndMs: 1700000300000,
			side: "INVALID",
			price: "0.6",
			size: "100",
			priceToBeat: "50000",
			entryBtcPrice: "51000",
			edge: "0.05",
			modelProb: "0.65",
			marketProb: "0.6",
			phase: "MID",
			orderId: "order-123",
			outcome: null,
			settleBtcPrice: null,
			pnlUsdc: null,
			createdAt: "2024-01-01T00:00:00Z",
			settledAt: null,
		};

		const result = TradeRecordSchema.safeParse(invalidTrade);
		expect(result.success).toBe(false);
	});

	it("should reject invalid phase", async () => {
		const invalidTrade = {
			id: 1,
			mode: "live",
			windowSlug: "test-window",
			windowStartMs: 1700000000000,
			windowEndMs: 1700000300000,
			side: "UP",
			price: "0.6",
			size: "100",
			priceToBeat: "50000",
			entryBtcPrice: "51000",
			edge: "0.05",
			modelProb: "0.65",
			marketProb: "0.6",
			phase: "INVALID",
			orderId: "order-123",
			outcome: null,
			settleBtcPrice: null,
			pnlUsdc: null,
			createdAt: "2024-01-01T00:00:00Z",
			settledAt: null,
		};

		const result = TradeRecordSchema.safeParse(invalidTrade);
		expect(result.success).toBe(false);
	});
});
