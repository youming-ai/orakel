import { describe, expect, it, vi } from "vitest";

vi.mock("../db/queries.ts", () => ({
	unifiedTradeQueries: { upsert: vi.fn().mockResolvedValue(undefined), getAllByMode: vi.fn().mockResolvedValue([]) },
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
		windowStartMs: number;
		side: "UP" | "DOWN";
		price: number;
		size: number;
		priceToBeat: number;
		currentPriceAtEntry: number;
	}> = {},
): string {
	return mgr.addTrade({
		marketId: overrides.marketId ?? "BTC-15m",
		windowStartMs: overrides.windowStartMs ?? 1000,
		side: overrides.side ?? "UP",
		price: overrides.price ?? 0.4,
		size: overrides.size ?? 10,
		priceToBeat: overrides.priceToBeat ?? 50000,
		currentPriceAtEntry: overrides.currentPriceAtEntry ?? 50100,
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
		const prices = new Map([["BTC-15m", 60000]]);
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
		const prices = new Map([["BTC-15m", 49000]]);
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

		const prices = new Map([["BTC-15m", 60000]]);
		// Pass a different windowStartMs
		const resolved = await mgr.resolveTrades(2000, prices);
		expect(resolved).toBe(0);
		expect(mgr.getStats().pending).toBe(1);
	});

	it("should track max drawdown on loss", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { side: "UP", price: 0.5, size: 20 });

		const prices = new Map([["BTC-15m", 49000]]);
		await mgr.resolveTrades(1000, prices);

		const balance = mgr.getBalance();
		// Lost: -(20 * 0.5) = -10, balance = 90
		expect(balance.current).toBeCloseTo(90, 2);
		expect(balance.maxDrawdown).toBeCloseTo(10, 2);
	});

	it("should update daily pnl tracking", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { price: 0.4, size: 10 });

		const prices = new Map([["BTC-15m", 60000]]);
		await mgr.resolveTrades(1000, prices);

		const todayStats = mgr.getTodayStats();
		expect(todayStats.pnl).toBeCloseTo(6.0, 2);
		expect(todayStats.trades).toBe(1);
	});

	it("should return won trades via getWonTrades()", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { price: 0.4, size: 10 });

		expect(mgr.getWonTrades()).toHaveLength(0);

		const prices = new Map([["BTC-15m", 60000]]);
		await mgr.resolveTrades(1000, prices);

		const won = mgr.getWonTrades();
		expect(won).toHaveLength(1);
		expect(won[0]?.won).toBe(true);
		expect(won[0]?.pnl).toBeCloseTo(6.0, 2);
	});
});

describe("resolveSingle side-awareness (BUG 1)", () => {
	it("DOWN trade should WIN when settlePrice <= priceToBeat", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { side: "DOWN", price: 0.4, size: 10, priceToBeat: 50000 });
		const prices = new Map([["BTC-15m", 49000]]);
		await mgr.resolveTrades(1000, prices);
		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
		expect(mgr.getBalance().current).toBeCloseTo(106, 2);
	});

	it("DOWN trade should LOSE when settlePrice > priceToBeat", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { side: "DOWN", price: 0.4, size: 10, priceToBeat: 50000 });
		const prices = new Map([["BTC-15m", 51000]]);
		await mgr.resolveTrades(1000, prices);
		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
		expect(mgr.getBalance().current).toBeCloseTo(96, 2);
	});

	it("DOWN trade should WIN when settlePrice equals priceToBeat", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { side: "DOWN", price: 0.4, size: 10, priceToBeat: 50000 });
		const prices = new Map([["BTC-15m", 50000]]);
		await mgr.resolveTrades(1000, prices);
		expect(mgr.getStats().wins).toBe(1);
		expect(mgr.getStats().losses).toBe(0);
	});

	it("UP trade still resolves correctly (regression)", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { side: "UP", price: 0.4, size: 10, priceToBeat: 50000 });
		const prices = new Map([["BTC-15m", 60000]]);
		await mgr.resolveTrades(1000, prices);
		expect(mgr.getStats().wins).toBe(1);
		expect(mgr.getStats().totalPnl).toBeCloseTo(6.0, 2);
	});
});

describe("resolveTrades marketId filtering (BUG 4)", () => {
	it("should only resolve trades matching the given marketId", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { marketId: "BTC-5m", windowStartMs: 1000, side: "UP", price: 0.4, size: 10 });
		addTestTrade(mgr, { marketId: "BTC-1h", windowStartMs: 1000, side: "UP", price: 0.4, size: 10 });

		const prices = new Map([
			["BTC-5m", 60000],
			["BTC-1h", 60000],
		]);
		const resolved = await mgr.resolveTrades(1000, prices, "BTC-5m");
		expect(resolved).toBe(1);
		expect(mgr.getStats().pending).toBe(1);
		expect(mgr.getStats().wins).toBe(1);
	});

	it("should resolve all matching trades when marketId is omitted", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { marketId: "BTC-5m", windowStartMs: 1000 });
		addTestTrade(mgr, { marketId: "BTC-1h", windowStartMs: 1000 });

		const prices = new Map([
			["BTC-5m", 60000],
			["BTC-1h", 60000],
		]);
		const resolved = await mgr.resolveTrades(1000, prices);
		expect(resolved).toBe(2);
		expect(mgr.getStats().pending).toBe(0);
	});
});

describe("resolveExpiredTrades cross-timeframe (BUG 2)", () => {
	it("should not resolve BTC-1h trade when called with 5min window and BTC-5m marketId", async () => {
		const mgr = makeManager(100);
		const eightMinAgo = Date.now() - 8 * 60_000;
		addTestTrade(mgr, { marketId: "BTC-1h", windowStartMs: eightMinAgo, side: "UP" });

		const prices = new Map([["BTC-1h", 60000]]);
		const resolved = await mgr.resolveExpiredTrades(prices, 5, "BTC-5m");
		expect(resolved).toBe(0);
		expect(mgr.getStats().pending).toBe(1);
	});

	it("should resolve expired trades matching the given marketId", async () => {
		const mgr = makeManager(100);
		const tenMinAgo = Date.now() - 10 * 60_000;
		addTestTrade(mgr, { marketId: "BTC-5m", windowStartMs: tenMinAgo, side: "UP" });

		const prices = new Map([["BTC-5m", 60000]]);
		const resolved = await mgr.resolveExpiredTrades(prices, 5, "BTC-5m");
		expect(resolved).toBe(1);
		expect(mgr.getStats().wins).toBe(1);
	});

	it("should resolve all expired when marketId is omitted", async () => {
		const mgr = makeManager(100);
		const tenMinAgo = Date.now() - 10 * 60_000;
		addTestTrade(mgr, { marketId: "BTC-5m", windowStartMs: tenMinAgo });
		addTestTrade(mgr, { marketId: "BTC-15m", windowStartMs: tenMinAgo });

		const prices = new Map([
			["BTC-5m", 60000],
			["BTC-15m", 60000],
		]);
		const resolved = await mgr.resolveExpiredTrades(prices, 5);
		expect(resolved).toBe(2);
	});
});

describe("forceResolveStuckTrades persistence and pricing (BUG 5+6)", () => {
	it("should use actual settle price when latestPrices available (UP wins)", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, {
			windowStartMs: 1,
			marketId: "BTC-5m",
			side: "UP",
			price: 0.4,
			size: 10,
			priceToBeat: 50000,
		});

		const prices = new Map([["BTC-5m", 60000]]);
		await mgr.forceResolveStuckTrades(10, prices);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
	});

	it("should mark as loss when no latestPrices available (fallback)", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, { windowStartMs: 1, side: "UP", price: 0.4, size: 10 });

		await mgr.forceResolveStuckTrades(10);

		const stats = mgr.getStats();
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
	});

	it("should use resolveSingle for DOWN trade with actual price", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, {
			windowStartMs: 1,
			marketId: "BTC-5m",
			side: "DOWN",
			price: 0.4,
			size: 10,
			priceToBeat: 50000,
		});

		const prices = new Map([["BTC-5m", 49000]]);
		await mgr.forceResolveStuckTrades(10, prices);

		expect(mgr.getStats().wins).toBe(1);
		expect(mgr.getStats().losses).toBe(0);
	});

	it("should not double-count when resolveSingle is used", async () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, {
			windowStartMs: 1,
			marketId: "BTC-5m",
			side: "UP",
			price: 0.5,
			size: 20,
			priceToBeat: 50000,
		});

		const prices = new Map([["BTC-5m", 40000]]);
		await mgr.forceResolveStuckTrades(10, prices);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-10.0, 2);
		expect(mgr.getBalance().current).toBeCloseTo(90, 2);
	});
});
