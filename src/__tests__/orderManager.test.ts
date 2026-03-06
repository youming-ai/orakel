import type { ClobClient } from "@polymarket/clob-client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../db/queries.ts", () => ({
	pendingOrderQueries: {
		getAll: vi.fn().mockResolvedValue([]),
		upsert: vi.fn().mockResolvedValue(undefined),
		updateStatus: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock("../core/logger.ts", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

import { OrderManager } from "../trading/orderManager.ts";

describe("OrderManager.pollOrders", () => {
	it("should treat explicit 'filled' status as filled", async () => {
		const manager = new OrderManager();
		const fakeClient = {
			getOrder: async () => ({ status: "filled", size_matched: 10 }),
		} as unknown as ClobClient;
		manager.setClient(fakeClient);

		manager.addOrderWithTracking(
			{
				orderId: "ord-filled-1",
				marketId: "BTC",
				windowSlug: "123",
				side: "UP",
				price: 0.5,
				size: 10,
				placedAt: Date.now(),
			},
			true,
		);

		await manager.pollOrders();

		const updated = manager.getOrder("ord-filled-1");
		expect(updated?.status).toBe("filled");
		expect(updated?.sizeMatched).toBe(10);
	});

	it("should treat ORDER_STATUS_MATCHED as filled", async () => {
		const manager = new OrderManager();
		const fakeClient = {
			getOrder: async () => ({ status: "ORDER_STATUS_MATCHED", size_matched: 10 }),
		} as unknown as ClobClient;
		manager.setClient(fakeClient);

		manager.addOrderWithTracking(
			{
				orderId: "ord-prefixed-1",
				marketId: "BTC",
				windowSlug: "123",
				side: "UP",
				price: 0.5,
				size: 10,
				placedAt: Date.now(),
			},
			true,
		);

		await manager.pollOrders();

		const updated = manager.getOrder("ord-prefixed-1");
		expect(updated?.status).toBe("filled");
		expect(updated?.sizeMatched).toBe(10);
	});

	it("should treat ORDER_STATUS_CANCELED as cancelled", async () => {
		const manager = new OrderManager();
		const fakeClient = {
			getOrder: async () => ({ status: "ORDER_STATUS_CANCELED", size_matched: 0 }),
		} as unknown as ClobClient;
		manager.setClient(fakeClient);

		manager.addOrderWithTracking(
			{
				orderId: "ord-canceled-1",
				marketId: "ETH",
				windowSlug: "456",
				side: "DOWN",
				price: 0.4,
				size: 10,
				placedAt: Date.now(),
			},
			true,
		);

		await manager.pollOrders();

		expect(manager.getOrder("ord-canceled-1")?.status).toBe("cancelled");
	});

	it("should emit callback with status transitions and previous status", async () => {
		const manager = new OrderManager();
		const responses = [
			{ status: "ORDER_STATUS_LIVE", size_matched: 0 },
			{ status: "ORDER_STATUS_MATCHED", size_matched: 10 },
		];
		let responseIdx = 0;
		const fakeClient = {
			getOrder: async () => {
				const idx = Math.min(responseIdx, responses.length - 1);
				responseIdx++;
				return responses[idx];
			},
		} as unknown as ClobClient;
		manager.setClient(fakeClient);

		manager.addOrderWithTracking(
			{
				orderId: "ord-transition-1",
				marketId: "ETH",
				windowSlug: "456",
				side: "DOWN",
				price: 0.43,
				size: 10,
				placedAt: Date.now(),
			},
			true,
		);

		const events: Array<{ status: string; previousStatus: string }> = [];
		manager.onOrderStatusChange((order, status, previousStatus) => {
			events.push({
				status,
				previousStatus,
			});
			expect(order.orderId).toBe("ord-transition-1");
		});

		await manager.pollOrders();
		await manager.pollOrders();

		expect(events).toEqual([{ status: "filled", previousStatus: "placed" }]);
	});
});
