import { describe, expect, it, vi } from "vitest";
import { getCandleWindowTiming } from "../core/utils.ts";

const pendingOrderQueries = {
	getAll: vi.fn(),
	delete: vi.fn().mockResolvedValue(undefined),
};
const tradeQueries = {
	updateTradeStatus: vi.fn().mockResolvedValue(undefined),
};
const registerOpenGtdOrder = vi.fn();

vi.mock("../db/queries.ts", () => ({
	pendingOrderQueries,
	tradeQueries,
}));

vi.mock("../trading/trader.ts", () => ({
	registerOpenGtdOrder,
}));

vi.mock("../core/logger.ts", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe("restoreRuntimeState", () => {
	it("should recover pending trades, filled pending orders, and open GTD orders", async () => {
		const nowWindow = getCandleWindowTiming(15).startMs;
		pendingOrderQueries.getAll.mockResolvedValueOnce([
			{
				orderId: "filled-order-1",
				marketId: "BTC-15m",
				windowStartMs: nowWindow,
				side: "UP",
				price: 0.52,
				size: 10,
				priceToBeat: 90000,
				currentPriceAtEntry: 90500,
				placedAt: nowWindow + 10_000,
				status: "filled",
			},
			{
				orderId: "placed-order-1",
				marketId: "BTC-15m",
				windowStartMs: nowWindow,
				side: "DOWN",
				price: 0.47,
				size: 8,
				priceToBeat: 90000,
				currentPriceAtEntry: 89800,
				tokenId: "token-down",
				placedAt: nowWindow + 20_000,
				status: "placed",
			},
		]);

		const orderTracker = {
			hasOrder: vi.fn().mockReturnValue(false),
			record: vi.fn(),
		};
		const liveTracker = {
			has: vi.fn().mockReturnValue(false),
			record: vi.fn(),
			canTradeGlobally: vi.fn().mockReturnValue(true),
			prune: vi.fn(),
		};
		const liveAccount = {
			getPendingTrades: vi.fn().mockReturnValue([
				{
					id: "pending-trade-1",
					marketId: "BTC-15m",
					windowStartMs: nowWindow,
					side: "UP",
					price: 0.49,
					size: 5,
					priceToBeat: 90000,
					currentPriceAtEntry: 90100,
					timestamp: new Date(nowWindow + 5_000).toISOString(),
					resolved: false,
					won: null,
					pnl: null,
					settlePrice: null,
				},
			]),
			addTrade: vi.fn(),
		};
		const orderManager = {
			addOrderWithTracking: vi.fn(),
		};

		const { restoreRuntimeState } = await import("../runtime/orderRecovery.ts");
		await restoreRuntimeState({
			orderTracker,
			liveTracker,
			liveAccount: liveAccount as never,
			orderManager: orderManager as never,
		});

		expect(orderTracker.record).toHaveBeenCalledWith("BTC-15m", String(nowWindow), nowWindow + 5_000);
		expect(liveAccount.addTrade).toHaveBeenCalledWith(
			expect.objectContaining({
				marketId: "BTC-15m",
				windowStartMs: nowWindow,
				side: "UP",
				price: 0.52,
				size: 10,
			}),
			"filled-order-1",
			"filled",
		);
		expect(tradeQueries.updateTradeStatus).toHaveBeenCalledWith("filled-order-1", "live", "filled");
		expect(orderManager.addOrderWithTracking).toHaveBeenCalledWith(
			expect.objectContaining({
				orderId: "placed-order-1",
				marketId: "BTC-15m",
				windowSlug: String(nowWindow),
				tokenId: "token-down",
			}),
			true,
		);
		expect(registerOpenGtdOrder).toHaveBeenCalledWith("placed-order-1");
		expect(pendingOrderQueries.delete).toHaveBeenCalledWith("filled-order-1");
		expect(liveTracker.record).toHaveBeenCalledWith("BTC-15m", nowWindow);
	});
});
