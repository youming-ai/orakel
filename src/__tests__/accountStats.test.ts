import { describe, expect, it, vi } from "vitest";

vi.mock("../db/queries.ts", () => ({
	paperTradeQueries: { upsert: vi.fn().mockResolvedValue(undefined), getAll: vi.fn().mockResolvedValue([]) },
	liveTradeQueries: { upsert: vi.fn().mockResolvedValue(undefined), getAll: vi.fn().mockResolvedValue([]) },
	stateQueries: {
		getPaperState: vi.fn().mockResolvedValue(null),
		getLiveState: vi.fn().mockResolvedValue(null),
		upsertPaperState: vi.fn().mockResolvedValue(undefined),
		upsertLiveState: vi.fn().mockResolvedValue(undefined),
	},
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

describe("addTrade + resolveTrades", () => {
	it("should add a trade and resolve it correctly", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { price: 0.4, size: 10 });

		// Balance deducted: 100 - (10 * 0.4) = 96
		expect(mgr.getBalance().current).toBeCloseTo(96, 2);
		expect(mgr.getStats().pending).toBe(1);

		// Resolve: UP side wins when finalPrice > priceToBeat
		const prices = new Map([["BTC", 60000]]);
		const resolved = await mgr.resolveTrades(1000, prices);
		expect(resolved).toBe(1);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.pending).toBe(0);
		// Won pnl = size * (1 - price) = 10 * 0.6 = 6
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
		expect(mgr.getBalance().current).toBeCloseTo(106, 2);
	});

	it("should resolve a losing trade correctly", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { side: "UP", price: 0.4, size: 10 });

		// Resolve: UP side loses when finalPrice <= priceToBeat
		const prices = new Map([["BTC", 49000]]);
		const resolved = await mgr.resolveTrades(1000, prices);
		expect(resolved).toBe(1);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		// Lost pnl = -(size * price) = -(10 * 0.4) = -4
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
		expect(mgr.getBalance().current).toBeCloseTo(96, 2);
	});

	it("should not resolve trades from a different window", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr); // windowStartMs = 1000

		const prices = new Map([["BTC", 60000]]);
		// Pass a different windowStartMs
		const resolved = await mgr.resolveTrades(2000, prices);
		expect(resolved).toBe(0);
		expect(mgr.getStats().pending).toBe(1);
	});

	it("should track max drawdown on loss", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { side: "UP", price: 0.5, size: 20 });

		const prices = new Map([["BTC", 49000]]);
		await mgr.resolveTrades(1000, prices);

		const balance = mgr.getBalance();
		// Lost: -(20 * 0.5) = -10, balance = 90
		expect(balance.current).toBeCloseTo(90, 2);
		expect(balance.maxDrawdown).toBeCloseTo(10, 2);
	});

	it("should update daily pnl tracking", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { price: 0.4, size: 10 });

		const prices = new Map([["BTC", 60000]]);
		await mgr.resolveTrades(1000, prices);

		const todayStats = mgr.getTodayStats();
		expect(todayStats.pnl).toBeCloseTo(6.0, 2);
		expect(todayStats.trades).toBe(1);
	});

	it("should return won trades via getWonTrades()", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { price: 0.4, size: 10 });

		expect(mgr.getWonTrades()).toHaveLength(0);

		const prices = new Map([["BTC", 60000]]);
		await mgr.resolveTrades(1000, prices);

		const won = mgr.getWonTrades();
		expect(won).toHaveLength(1);
		expect(won[0]?.won).toBe(true);
		expect(won[0]?.pnl).toBeCloseTo(6.0, 2);
	});
});
