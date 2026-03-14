import { describe, expect, it } from "vitest";
import { createAccountManager } from "./account.ts";

describe("createAccountManager", () => {
	it("should return correct initial state", () => {
		const manager = createAccountManager(10000, 500);
		const stats = manager.getStats();

		expect(stats.balanceUsdc).toBe(10000);
		expect(stats.totalTrades).toBe(0);
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(0);
		expect(stats.pending).toBe(0);
		expect(stats.winRate).toBe(0);
		expect(stats.totalPnl).toBe(0);
		expect(stats.todayPnl).toBe(0);
		expect(stats.todayTrades).toBe(0);
	});

	it("should record trade and return sequential index", () => {
		const manager = createAccountManager(10000, 500);

		const idx1 = manager.recordTrade({ side: "UP", size: 100, price: 0.5 });
		const idx2 = manager.recordTrade({ side: "DOWN", size: 50, price: 0.3 });

		expect(idx1).toBe(0);
		expect(idx2).toBe(1);
		expect(manager.getPendingCount()).toBe(2);
	});

	it("should increase pending count on recordTrade", () => {
		const manager = createAccountManager(10000, 500);

		expect(manager.getPendingCount()).toBe(0);
		manager.recordTrade({ side: "UP", size: 100, price: 0.5 });
		expect(manager.getPendingCount()).toBe(1);
		manager.recordTrade({ side: "DOWN", size: 50, price: 0.3 });
		expect(manager.getPendingCount()).toBe(2);
	});

	it("should settle winning trade and update balance positively", () => {
		const manager = createAccountManager(10000, 500);
		const idx = manager.recordTrade({ side: "UP", size: 100, price: 0.5 });

		manager.settleTrade(idx, true);

		const stats = manager.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.totalTrades).toBe(1);
		expect(stats.pending).toBe(0);
		expect(stats.totalPnl).toBeGreaterThan(0);
		expect(stats.balanceUsdc).toBeGreaterThan(10000);
	});

	it("should settle losing trade and update balance negatively", () => {
		const manager = createAccountManager(10000, 500);
		const idx = manager.recordTrade({ side: "UP", size: 100, price: 0.5 });

		manager.settleTrade(idx, false);

		const stats = manager.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		expect(stats.totalTrades).toBe(1);
		expect(stats.pending).toBe(0);
		expect(stats.totalPnl).toBeLessThan(0);
		expect(stats.balanceUsdc).toBeLessThan(10000);
	});

	it("should track today's losses separately", () => {
		const manager = createAccountManager(10000, 500);

		// Record and settle a losing trade
		const idx1 = manager.recordTrade({ side: "UP", size: 100, price: 0.5 });
		manager.settleTrade(idx1, false);

		// Record and settle a winning trade
		const idx2 = manager.recordTrade({ side: "DOWN", size: 50, price: 0.3 });
		manager.settleTrade(idx2, true);

		const todayLoss = manager.getTodayLossUsdc();
		expect(todayLoss).toBeGreaterThan(0);
	});

	it("should handle multiple trades with sequential indices", () => {
		const manager = createAccountManager(10000, 500);

		const indices: number[] = [];
		for (let i = 0; i < 5; i++) {
			indices.push(manager.recordTrade({ side: "UP", size: 100, price: 0.5 }));
		}

		expect(indices).toEqual([0, 1, 2, 3, 4]);
		expect(manager.getPendingCount()).toBe(5);
	});

	it("should be idempotent when settling already settled trade", () => {
		const manager = createAccountManager(10000, 500);
		const idx = manager.recordTrade({ side: "UP", size: 100, price: 0.5 });

		manager.settleTrade(idx, true);
		const statsAfterFirst = manager.getStats();

		// Settle again with different outcome
		manager.settleTrade(idx, false);
		const statsAfterSecond = manager.getStats();

		// Should not change on second settlement
		expect(statsAfterFirst.totalPnl).toBe(statsAfterSecond.totalPnl);
		expect(statsAfterFirst.balanceUsdc).toBe(statsAfterSecond.balanceUsdc);
		expect(statsAfterFirst.wins).toBe(statsAfterSecond.wins);
	});

	it("should return size PnL when price is 0 (guard case)", () => {
		const manager = createAccountManager(10000, 500);
		const idx = manager.recordTrade({ side: "UP", size: 100, price: 0 });

		manager.settleTrade(idx, true);

		const stats = manager.getStats();
		expect(stats.totalPnl).toBe(100);
	});

	it("should return size PnL when price is 1 (guard case)", () => {
		const manager = createAccountManager(10000, 500);
		const idx = manager.recordTrade({ side: "UP", size: 100, price: 1 });

		manager.settleTrade(idx, true);

		const stats = manager.getStats();
		expect(stats.totalPnl).toBe(100);
	});

	it("should return dailyMaxLoss from constructor param in stats", () => {
		const dailyMaxLoss = 500;
		const manager = createAccountManager(10000, dailyMaxLoss);

		const stats = manager.getStats();
		expect(stats.dailyMaxLoss).toBe(dailyMaxLoss);
	});
});
