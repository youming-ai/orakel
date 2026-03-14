import { describe, expect, it } from "vitest";
import {
	ControlResponseSchema,
	ErrorResponseSchema,
	ExecutionConfigSchema,
	SignalRecordSchema,
	StatsDtoSchema,
	StatusDtoSchema,
	StrategyConfigSchema,
	TradeRecordSchema,
} from "../schemas.ts";

describe("TradeRecordSchema", () => {
	it("should validate valid trade record", () => {
		const validTrade = {
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
			phase: "MID",
			orderId: "order-123",
			outcome: null,
			settleBtcPrice: null,
			pnlUsdc: null,
			createdAt: "2024-01-01T00:00:00Z",
			settledAt: null,
		};

		const result = TradeRecordSchema.safeParse(validTrade);
		expect(result.success).toBe(true);
	});

	it("should reject invalid mode", () => {
		const invalidTrade = {
			id: 1,
			mode: "invalid",
			windowSlug: "test",
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
			orderId: null,
			outcome: null,
			settleBtcPrice: null,
			pnlUsdc: null,
			createdAt: "2024-01-01T00:00:00Z",
			settledAt: null,
		};

		const result = TradeRecordSchema.safeParse(invalidTrade);
		expect(result.success).toBe(false);
	});

	it("should reject invalid price format", () => {
		const invalidTrade = {
			id: 1,
			mode: "live",
			windowSlug: "test",
			windowStartMs: 1700000000000,
			windowEndMs: 1700000300000,
			side: "UP",
			price: "invalid",
			size: "100",
			priceToBeat: "50000",
			entryBtcPrice: "51000",
			edge: "0.05",
			modelProb: "0.65",
			marketProb: "0.6",
			phase: "MID",
			orderId: null,
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

describe("SignalRecordSchema", () => {
	it("should validate valid signal record", () => {
		const validSignal = {
			id: 1,
			windowSlug: "test-window",
			btcPrice: "51000",
			priceToBeat: "50000",
			deviation: "1000",
			modelProbUp: "0.65",
			marketProbUp: "0.6",
			edgeUp: "0.05",
			edgeDown: "-0.05",
			volatility: "0.02",
			timeLeftSeconds: 120,
			phase: "MID",
			decision: "ENTER_UP",
			reason: "High edge",
			timestamp: "2024-01-01T00:00:00Z",
		};

		const result = SignalRecordSchema.safeParse(validSignal);
		expect(result.success).toBe(true);
	});

	it("should allow negative edge values", () => {
		const validSignal = {
			id: 1,
			windowSlug: "test-window",
			btcPrice: "51000",
			priceToBeat: "50000",
			deviation: "-1000",
			modelProbUp: "0.35",
			marketProbUp: "0.4",
			edgeUp: "-0.05",
			edgeDown: "0.05",
			volatility: "0.02",
			timeLeftSeconds: 120,
			phase: "MID",
			decision: "SKIP",
			reason: null,
			timestamp: "2024-01-01T00:00:00Z",
		};

		const result = SignalRecordSchema.safeParse(validSignal);
		expect(result.success).toBe(true);
	});
});

describe("StrategyConfigSchema", () => {
	it("should validate valid strategy config", () => {
		const validConfig = {
			edgeThresholdEarly: 0.05,
			edgeThresholdMid: 0.03,
			edgeThresholdLate: 0.01,
			phaseEarlySeconds: 120,
			phaseLateSeconds: 30,
			sigmoidScale: 2,
			minVolatility: 0.001,
			maxEntryPrice: 0.95,
			minTimeLeftSeconds: 30,
			maxTimeLeftSeconds: 270,
		};

		const result = StrategyConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it("should reject invalid edge threshold ordering", () => {
		const invalidConfig = {
			edgeThresholdEarly: 0.02,
			edgeThresholdMid: 0.03,
			edgeThresholdLate: 0.04,
			phaseEarlySeconds: 120,
			phaseLateSeconds: 30,
			sigmoidScale: 2,
			minVolatility: 0.001,
			maxEntryPrice: 0.95,
			minTimeLeftSeconds: 30,
			maxTimeLeftSeconds: 270,
		};

		const result = StrategyConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success && result.error.issues[0]) {
			expect(result.error.issues[0].message).toContain("Edge thresholds");
		}
	});

	it("should reject invalid phase time ordering", () => {
		const invalidConfig = {
			edgeThresholdEarly: 0.05,
			edgeThresholdMid: 0.03,
			edgeThresholdLate: 0.01,
			phaseEarlySeconds: 30,
			phaseLateSeconds: 120,
			sigmoidScale: 2,
			minVolatility: 0.001,
			maxEntryPrice: 0.95,
			minTimeLeftSeconds: 30,
			maxTimeLeftSeconds: 270,
		};

		const result = StrategyConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success && result.error.issues[0]) {
			expect(result.error.issues[0].message).toContain("phaseEarlySeconds");
		}
	});

	it("should reject invalid time range", () => {
		const invalidConfig = {
			edgeThresholdEarly: 0.05,
			edgeThresholdMid: 0.03,
			edgeThresholdLate: 0.01,
			phaseEarlySeconds: 120,
			phaseLateSeconds: 30,
			sigmoidScale: 2,
			minVolatility: 0.001,
			maxEntryPrice: 0.95,
			minTimeLeftSeconds: 300,
			maxTimeLeftSeconds: 270,
		};

		const result = StrategyConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success && result.error.issues[0]) {
			expect(result.error.issues[0].message).toContain("minTimeLeftSeconds");
		}
	});
});

describe("ExecutionConfigSchema", () => {
	it("should validate valid execution config", () => {
		const validConfig = {
			orderType: "GTC",
			limitDiscount: 0.01,
			minOrderPrice: 0.1,
			maxOrderPrice: 0.9,
		};

		const result = ExecutionConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it("should accept all valid order types", () => {
		const orderTypes = ["GTC", "GTD", "FOK", "MARKET"];

		for (const orderType of orderTypes) {
			const config = {
				orderType,
				limitDiscount: 0.01,
				minOrderPrice: 0.1,
				maxOrderPrice: 0.9,
			};

			const result = ExecutionConfigSchema.safeParse(config);
			expect(result.success).toBe(true);
		}
	});

	it("should reject invalid order type", () => {
		const invalidConfig = {
			orderType: "INVALID",
			limitDiscount: 0.01,
			minOrderPrice: 0.1,
			maxOrderPrice: 0.9,
		};

		const result = ExecutionConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
	});

	it("should reject invalid price ordering", () => {
		const invalidConfig = {
			orderType: "GTC",
			limitDiscount: 0.01,
			minOrderPrice: 0.9,
			maxOrderPrice: 0.1,
		};

		const result = ExecutionConfigSchema.safeParse(invalidConfig);
		expect(result.success).toBe(false);
		if (!result.success && result.error.issues[0]) {
			expect(result.error.issues[0].message).toContain("minOrderPrice");
		}
	});
});

describe("StatsDtoSchema", () => {
	it("should validate valid stats", () => {
		const validStats = {
			paper: {
				totalTrades: 10,
				wins: 6,
				totalPnl: 150.5,
			},
			live: {
				totalTrades: 5,
				wins: 3,
				totalPnl: 75.25,
			},
		};

		const result = StatsDtoSchema.safeParse(validStats);
		expect(result.success).toBe(true);
	});

	it("should allow negative pnl", () => {
		const validStats = {
			paper: {
				totalTrades: 10,
				wins: 4,
				totalPnl: -50.5,
			},
			live: {
				totalTrades: 5,
				wins: 2,
				totalPnl: -25.25,
			},
		};

		const result = StatsDtoSchema.safeParse(validStats);
		expect(result.success).toBe(true);
	});
});

describe("StatusDtoSchema", () => {
	it("should validate valid status", () => {
		const validStatus = {
			paperRunning: true,
			liveRunning: false,
			paperPendingStart: false,
			paperPendingStop: false,
			livePendingStart: false,
			livePendingStop: false,
			currentWindow: null,
			btcPrice: 51000,
			btcPriceAgeMs: 1000,
			cliAvailable: true,
			dbConnected: true,
			uptimeMs: 3600000,
		};

		const result = StatusDtoSchema.safeParse(validStatus);
		expect(result.success).toBe(true);
	});

	it("should allow null values for optional fields", () => {
		const validStatus = {
			paperRunning: false,
			liveRunning: false,
			paperPendingStart: false,
			paperPendingStop: false,
			livePendingStart: false,
			livePendingStop: false,
			currentWindow: null,
			btcPrice: null,
			btcPriceAgeMs: null,
			cliAvailable: false,
			dbConnected: false,
			uptimeMs: 0,
		};

		const result = StatusDtoSchema.safeParse(validStatus);
		expect(result.success).toBe(true);
	});
});

describe("ControlResponseSchema", () => {
	it("should validate valid control response", () => {
		const validResponse = {
			ok: true,
			message: "Paper trading started",
			state: {
				paperRunning: true,
				liveRunning: false,
			},
		};

		const result = ControlResponseSchema.safeParse(validResponse);
		expect(result.success).toBe(true);
	});
});

describe("ErrorResponseSchema", () => {
	it("should validate valid error response", () => {
		const validError = {
			ok: false,
			error: "Invalid request",
		};

		const result = ErrorResponseSchema.safeParse(validError);
		expect(result.success).toBe(true);
	});

	it("should reject ok: true", () => {
		const invalidError = {
			ok: true,
			error: "Invalid request",
		};

		const result = ErrorResponseSchema.safeParse(invalidError);
		expect(result.success).toBe(false);
	});
});
