import { describe, expect, it, vi } from "vitest";

vi.mock("../core/db.ts", () => ({
	PERSIST_BACKEND: "csv",
	statements: {},
	onchainStatements: {},
	resetPaperDbData: vi.fn(),
	resetLiveDbData: vi.fn(),
}));

vi.mock("../core/config.ts", () => ({
	CONFIG: {
		paperRisk: { dailyMaxLossUsdc: 100 },
		liveRisk: { dailyMaxLossUsdc: 100 },
	},
	PAPER_INITIAL_BALANCE: 100,
	LIVE_INITIAL_BALANCE: 100,
}));

vi.mock("node:fs", () => ({
	default: {
		existsSync: () => false,
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		readFileSync: () => "{}",
	},
}));

import { AccountStatsManager } from "../trading/accountStats.ts";

function makeManager(initialBalance = 100): AccountStatsManager {
	return new AccountStatsManager("paper", initialBalance);
}

function addTestTrade(
	mgr: AccountStatsManager,
	overrides: Partial<{
		marketId: string;
		side: "UP" | "DOWN";
		price: number;
		size: number;
	}> = {},
): string {
	return mgr.addTrade({
		marketId: overrides.marketId ?? "BTC",
		windowStartMs: 1000,
		side: overrides.side ?? "UP",
		price: overrides.price ?? 0.4,
		size: overrides.size ?? 10,
		priceToBeat: 50000,
		currentPriceAtEntry: 50100,
		timestamp: new Date().toISOString(),
	});
}

describe("resolveTradeOnchain", () => {
	it("should resolve a winning trade with given pnl", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr, { price: 0.4, size: 10 });

		expect(mgr.getBalance().current).toBeCloseTo(96, 2);

		mgr.resolveTradeOnchain(tradeId, true, 6.0, "0xabc");

		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
		expect(mgr.getBalance().current).toBeCloseTo(106, 2);

		const trades = mgr.getRecentTrades();
		const trade = trades.find((t) => t.id === tradeId);
		expect(trade?.resolved).toBe(true);
		expect(trade?.won).toBe(true);
		expect(trade?.pnl).toBeCloseTo(6.0, 2);
	});

	it("should resolve a losing trade with negative pnl", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr, { price: 0.4, size: 10 });

		mgr.resolveTradeOnchain(tradeId, false, -4.0, null);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
		expect(mgr.getBalance().current).toBeCloseTo(96, 2);
	});

	it("should throw if tradeId does not exist", () => {
		const mgr = makeManager(100);
		expect(() => mgr.resolveTradeOnchain("nonexistent", true, 5.0, null)).toThrow("Trade not found");
	});

	it("should throw if trade is already resolved", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr);
		mgr.resolveTradeOnchain(tradeId, true, 6.0, null);
		expect(() => mgr.resolveTradeOnchain(tradeId, false, -4.0, null)).toThrow("Trade already resolved");
	});

	it("should update daily pnl tracking", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr, { price: 0.4, size: 10 });
		mgr.resolveTradeOnchain(tradeId, true, 6.0, null);

		const todayStats = mgr.getTodayStats();
		expect(todayStats.pnl).toBeCloseTo(6.0, 2);
		expect(todayStats.trades).toBe(1);
	});

	it("should track max drawdown correctly on loss", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr, { price: 0.5, size: 20 });
		mgr.resolveTradeOnchain(tradeId, false, -10.0, null);

		const balance = mgr.getBalance();
		expect(balance.current).toBeCloseTo(90, 2);
		expect(balance.maxDrawdown).toBeCloseTo(10, 2);
	});
});
