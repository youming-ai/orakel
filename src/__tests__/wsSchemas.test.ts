import { describe, expect, it } from "vitest";
import {
	BalanceSnapshotPayloadSchema,
	DashboardStateSchema,
	OkResponseSchema,
	PaperStatsResponseSchema,
	SignalNewMessageSchema,
	StateSnapshotMessageSchema,
	TradeExecutedPayloadSchema,
	TradeRecordSchema,
} from "../../web/src/contracts/schemas";

const mockTradeRecord = {
	timestamp: "2026-03-07T10:00:00Z",
	market: "ETH-15m",
	marketSlug: "eth-up-or-down-15m",
	side: "UP",
	amount: "100",
	price: "0.52",
	orderId: "order-123",
	status: "filled",
	mode: "paper",
	pnl: 5.2,
	won: 1,
	currentPriceAtEntry: 0.51,
};

const mockDashboardState = {
	markets: [],
	updatedAt: "2026-03-07T10:00:00Z",
	paperMode: true,
	wallet: { address: null, connected: false },
	paperDaily: { date: "2026-03-07", pnl: 0, trades: 0 },
	liveDaily: { date: "2026-03-07", pnl: 0, trades: 0 },
	config: {
		strategy: {},
		paperRisk: {
			maxTradeSizeUsdc: 100,
			limitDiscount: 0.02,
			dailyMaxLossUsdc: 500,
			maxOpenPositions: 5,
			minLiquidity: 1000,
			maxTradesPerWindow: 2,
		},
		liveRisk: {
			maxTradeSizeUsdc: 100,
			limitDiscount: 0.02,
			dailyMaxLossUsdc: 500,
			maxOpenPositions: 5,
			minLiquidity: 1000,
			maxTradesPerWindow: 2,
		},
	},
	paperRunning: false,
	liveRunning: false,
	paperStats: null,
	liveStats: null,
	paperBalance: { initial: 10000, current: 10000, maxDrawdown: 0 },
	liveBalance: { initial: 10000, current: 10000, maxDrawdown: 0 },
	liveWallet: { address: null, connected: false, clientReady: false },
	paperPendingStart: false,
	paperPendingStop: false,
	livePendingStart: false,
	livePendingStop: false,
	paperPendingSince: null,
	livePendingSince: null,
	stopLoss: null,
	liveStopLoss: null,
	todayStats: { pnl: 0, trades: 0, limit: 100 },
	liveTodayStats: { pnl: 0, trades: 0, limit: 100 },
};

const mockPaperStatsResponse = {
	stats: {
		totalTrades: 10,
		wins: 6,
		losses: 4,
		pending: 0,
		winRate: 0.6,
		totalPnl: 50.5,
	},
	trades: [],
	byMarket: {},
	balance: { initial: 10000, current: 10050, maxDrawdown: -100 },
	stopLoss: null,
	todayStats: { pnl: 5.2, trades: 2, limit: 100 },
};

describe("Frontend Zod schemas parse backend DTOs", () => {
	describe("TradeRecordSchema", () => {
		it("should parse valid trade record", () => {
			const result = TradeRecordSchema.safeParse(mockTradeRecord);
			expect(result.success).toBe(true);
		});

		it("should require mandatory fields", () => {
			const invalid = { ...mockTradeRecord, orderId: undefined };
			const result = TradeRecordSchema.safeParse(invalid);
			expect(result.success).toBe(false);
		});
	});

	describe("DashboardStateSchema", () => {
		it("should parse valid dashboard state", () => {
			const result = DashboardStateSchema.safeParse(mockDashboardState);
			expect(result.success).toBe(true);
		});

		it("should reject missing required fields", () => {
			const invalid = { ...mockDashboardState, markets: undefined };
			const result = DashboardStateSchema.safeParse(invalid);
			expect(result.success).toBe(false);
		});
	});

	describe("PaperStatsResponseSchema", () => {
		it("should parse valid stats response", () => {
			const result = PaperStatsResponseSchema.safeParse(mockPaperStatsResponse);
			expect(result.success).toBe(true);
		});
	});

	describe("OkResponseSchema", () => {
		it("should parse ok response", () => {
			const result = OkResponseSchema.safeParse({ ok: true });
			expect(result.success).toBe(true);
		});

		it("should reject missing ok field", () => {
			const result = OkResponseSchema.safeParse({});
			expect(result.success).toBe(false);
		});
	});
});

describe("WS message schemas", () => {
	describe("StateSnapshotMessageSchema", () => {
		it("should parse valid state snapshot message", () => {
			const message = {
				type: "state:snapshot" as const,
				data: {
					markets: [],
					updatedAt: "2026-03-07T10:00:00Z",
					paperRunning: false,
					liveRunning: false,
					paperPendingStart: false,
					paperPendingStop: false,
					livePendingStart: false,
					livePendingStop: false,
					paperPendingSince: null,
					livePendingSince: null,
					paperStats: null,
					liveStats: null,
					liveTodayStats: null,
				},
				ts: Date.now(),
				version: 1,
			};
			const result = StateSnapshotMessageSchema.safeParse(message);
			expect(result.success).toBe(true);
		});

		it("should reject invalid type", () => {
			const message = {
				type: "invalid:type" as const,
				data: {},
				ts: Date.now(),
				version: 1,
			};
			const result = StateSnapshotMessageSchema.safeParse(message);
			expect(result.success).toBe(false);
		});
	});

	describe("SignalNewMessageSchema", () => {
		it("should parse valid signal new message", () => {
			const message = {
				type: "signal:new" as const,
				data: {
					marketId: "ETH-15m",
					timestamp: "2026-03-07T10:00:00Z",
					regime: "TREND_UP",
					signal: "ENTER" as const,
					modelUp: 0.55,
					modelDown: 0.45,
					edgeUp: 0.05,
					edgeDown: null,
					recommendation: "LONG",
				},
				ts: Date.now(),
				version: 1,
			};
			const result = SignalNewMessageSchema.safeParse(message);
			expect(result.success).toBe(true);
		});
	});

	describe("TradeExecutedPayloadSchema", () => {
		it("should parse valid trade executed payload", () => {
			const payload = {
				marketId: "ETH-15m",
				mode: "paper" as const,
				side: "UP" as const,
				price: 0.52,
				size: 100,
				timestamp: "2026-03-07T10:00:00Z",
				orderId: "order-123",
				status: "filled",
			};
			const result = TradeExecutedPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});

		it("should reject invalid mode", () => {
			const payload = {
				marketId: "ETH-15m",
				mode: "invalid" as const,
				side: "UP" as const,
				price: 0.52,
				size: 100,
				timestamp: "2026-03-07T10:00:00Z",
				orderId: "order-123",
				status: "filled",
			};
			const result = TradeExecutedPayloadSchema.safeParse(payload);
			expect(result.success).toBe(false);
		});
	});

	describe("BalanceSnapshotPayloadSchema", () => {
		it("should parse valid balance snapshot", () => {
			const payload = {
				usdcBalance: 10000.5,
				usdcRaw: "10000500000",
				positions: [
					{
						tokenId: "0x123",
						balance: "1000000000000000000",
						marketId: "ETH-15m",
						side: "UP",
					},
				],
				blockNumber: 12345678,
				timestamp: Date.now(),
			};
			const result = BalanceSnapshotPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});
	});
});
