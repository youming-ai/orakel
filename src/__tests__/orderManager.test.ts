import type { ClobClient } from "@polymarket/clob-client";
import { describe, expect, it } from "vitest";
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

	it("should emit callback with status transitions and previous status", async () => {
		const manager = new OrderManager();
		const responses = [
			{ status: "live", size_matched: 0 },
			{ status: "filled", size_matched: 10 },
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

		expect(events).toEqual([
			{ status: "live", previousStatus: "placed" },
			{ status: "filled", previousStatus: "live" },
		]);
	});
});
