import { beforeEach, describe, expect, it } from "vitest";
import { type AccountManager, createAccountManager } from "../trading/account.ts";

describe("AccountManager", () => {
	let account: AccountManager;

	beforeEach(() => {
		account = createAccountManager(1000); // 1000 USDC starting
	});

	it("starts with correct initial state", () => {
		const stats = account.getStats();
		expect(stats.balanceUsdc).toBe(1000);
		expect(stats.totalTrades).toBe(0);
		expect(stats.totalPnl).toBe(0);
	});

	it("records a winning trade", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, true); // win
		const stats = account.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.totalTrades).toBe(1);
		expect(stats.totalPnl).toBeGreaterThan(0);
	});

	it("records a losing trade", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, false); // loss
		const stats = account.getStats();
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeLessThan(0);
	});

	it("tracks pending trades", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		expect(account.getStats().pending).toBe(1);
		account.settleTrade(0, true);
		expect(account.getStats().pending).toBe(0);
	});

	it("computes win rate correctly", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, true);
		account.recordTrade({ side: "DOWN", size: 5, price: 0.55 });
		account.settleTrade(1, false);
		expect(account.getStats().winRate).toBeCloseTo(0.5, 6);
	});

	it("computes today P&L", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, true);
		const stats = account.getStats();
		expect(stats.todayPnl).toBeGreaterThan(0);
	});
});
