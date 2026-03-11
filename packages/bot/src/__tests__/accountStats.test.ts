import { describe, expect, it, vi } from "vitest";

vi.mock("../db/queries.ts", () => ({
	unifiedTradeQueries: { upsert: vi.fn().mockResolvedValue(undefined), getAllByMode: vi.fn().mockResolvedValue([]) },
	stateQueries: {
		getPaperState: vi.fn().mockResolvedValue(null),
		getLiveState: vi.fn().mockResolvedValue(null),
		upsertPaperState: vi.fn().mockResolvedValue(undefined),
		upsertLiveState: vi.fn().mockResolvedValue(undefined),
	},
	dailyStatsQueries: {
		upsertDaily: vi.fn().mockResolvedValue(undefined),
		getToday: vi.fn().mockResolvedValue(null),
	},
}));

vi.mock("../core/config.ts", () => ({
	CONFIG: {
		paperRisk: { dailyMaxLossUsdc: 100, maxTradeSizeUsdc: 30 },
		liveRisk: { dailyMaxLossUsdc: 100, maxTradeSizeUsdc: 30 },
	},
}));

import { AccountStatsManager } from "../trading/accountStats.ts";

function makeManager(): AccountStatsManager {
	return new AccountStatsManager("paper");
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
		marketId: overrides.marketId ?? "ETH-15m",
		windowStartMs: overrides.windowStartMs ?? 1000,
		side: overrides.side ?? "UP",
		price: overrides.price ?? 0.4,
		size: overrides.size ?? 10,
		priceToBeat: overrides.priceToBeat ?? 2100,
		currentPriceAtEntry: overrides.currentPriceAtEntry ?? 2110,
		timestamp: new Date().toISOString(),
	});
}

describe("addTrade + resolveTrades", () => {
	it("should add a trade and resolve it correctly", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { price: 0.4, size: 10 });

		expect(mgr.getStats().pending).toBe(1);

		// Resolve: UP side wins when finalPrice > priceToBeat
		const prices = new Map([["ETH-15m", 2200]]);
		const resolved = await mgr.resolveTrades(1000, prices);
		expect(resolved).toBe(1);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.pending).toBe(0);
		// Won pnl = size * (1 - price) = 10 * 0.6 = 6
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
	});

	it("should resolve a losing trade correctly", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { side: "UP", price: 0.4, size: 10 });

		// Resolve: UP side loses when finalPrice <= priceToBeat
		const prices = new Map([["ETH-15m", 1900]]);
		const resolved = await mgr.resolveTrades(1000, prices);
		expect(resolved).toBe(1);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		// Lost pnl = -(size * price) = -(10 * 0.4) = -4
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
	});

	it("should not resolve trades from a different window", async () => {
		const mgr = makeManager();
		addTestTrade(mgr); // windowStartMs = 1000

		const prices = new Map([["ETH-15m", 2200]]);
		// Pass a different windowStartMs
		const resolved = await mgr.resolveTrades(2000, prices);
		expect(resolved).toBe(0);
		expect(mgr.getStats().pending).toBe(1);
	});

	it("should track max drawdown on loss", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { side: "UP", price: 0.5, size: 20 });

		const prices = new Map([["ETH-15m", 1900]]);
		await mgr.resolveTrades(1000, prices);

		// Lost: -(20 * 0.5) = -10, drawdown = 10
		expect(mgr.getMaxDrawdown()).toBeCloseTo(10, 2);
	});

	it("should update daily pnl tracking", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { price: 0.4, size: 10 });

		const prices = new Map([["ETH-15m", 2200]]);
		await mgr.resolveTrades(1000, prices);

		const todayStats = mgr.getTodayStats();
		expect(todayStats.pnl).toBeCloseTo(6.0, 2);
		expect(todayStats.trades).toBe(1);
	});

	it("should return won trades via getWonTrades()", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { price: 0.4, size: 10 });

		expect(mgr.getWonTrades()).toHaveLength(0);

		const prices = new Map([["ETH-15m", 2200]]);
		await mgr.resolveTrades(1000, prices);

		const won = mgr.getWonTrades();
		expect(won).toHaveLength(1);
		expect(won[0]?.won).toBe(true);
		expect(won[0]?.pnl).toBeCloseTo(6.0, 2);
	});
});

describe("resolveSingle side-awareness (BUG 1)", () => {
	it("DOWN trade should WIN when settlePrice <= priceToBeat", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { side: "DOWN", price: 0.4, size: 10, priceToBeat: 2100 });
		const prices = new Map([["ETH-15m", 1900]]);
		await mgr.resolveTrades(1000, prices);
		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
	});

	it("DOWN trade should LOSE when settlePrice > priceToBeat", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { side: "DOWN", price: 0.4, size: 10, priceToBeat: 2100 });
		const prices = new Map([["ETH-15m", 2200]]);
		await mgr.resolveTrades(1000, prices);
		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
	});

	it("DOWN trade should WIN when settlePrice equals priceToBeat", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { side: "DOWN", price: 0.4, size: 10, priceToBeat: 2100 });
		const prices = new Map([["ETH-15m", 2100]]);
		await mgr.resolveTrades(1000, prices);
		expect(mgr.getStats().wins).toBe(1);
		expect(mgr.getStats().losses).toBe(0);
	});

	it("UP trade still resolves correctly (regression)", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { side: "UP", price: 0.4, size: 10, priceToBeat: 2100 });
		const prices = new Map([["ETH-15m", 2200]]);
		await mgr.resolveTrades(1000, prices);
		expect(mgr.getStats().wins).toBe(1);
		expect(mgr.getStats().totalPnl).toBeCloseTo(6.0, 2);
	});
});

describe("resolveTrades marketId filtering (BUG 4)", () => {
	it("should only resolve trades matching the given marketId", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { marketId: "BTC-15m", windowStartMs: 1000, side: "UP", price: 0.4, size: 10 });
		addTestTrade(mgr, { marketId: "ETH-15m", windowStartMs: 1000, side: "UP", price: 0.4, size: 10 });

		const prices = new Map([
			["BTC-15m", 60000],
			["ETH-15m", 2200],
		]);
		const resolved = await mgr.resolveTrades(1000, prices, "BTC-15m");
		expect(resolved).toBe(1);
		expect(mgr.getStats().pending).toBe(1);
		expect(mgr.getStats().wins).toBe(1);
	});

	it("should resolve all matching trades when marketId is omitted", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { marketId: "BTC-15m", windowStartMs: 1000 });
		addTestTrade(mgr, { marketId: "ETH-15m", windowStartMs: 1000 });

		const prices = new Map([
			["BTC-15m", 60000],
			["ETH-15m", 2200],
		]);
		const resolved = await mgr.resolveTrades(1000, prices);
		expect(resolved).toBe(2);
		expect(mgr.getStats().pending).toBe(0);
	});
});

describe("resolveExpiredTrades cross-timeframe (BUG 2)", () => {
	it("should not resolve ETH-15m trade when called with 5min window and BTC-15m marketId", async () => {
		const mgr = makeManager();
		const eightMinAgo = Date.now() - 8 * 60_000;
		addTestTrade(mgr, { marketId: "ETH-15m", windowStartMs: eightMinAgo, side: "UP" });

		const prices = new Map([["ETH-15m", 2200]]);
		const resolved = await mgr.resolveExpiredTrades(prices, 5, "BTC-15m");
		expect(resolved).toBe(0);
		expect(mgr.getStats().pending).toBe(1);
	});

	it("should resolve expired trades matching the given marketId", async () => {
		const mgr = makeManager();
		const tenMinAgo = Date.now() - 10 * 60_000;
		addTestTrade(mgr, { marketId: "ETH-15m", windowStartMs: tenMinAgo, side: "UP" });

		const prices = new Map([["ETH-15m", 2200]]);
		const resolved = await mgr.resolveExpiredTrades(prices, 5, "ETH-15m");
		expect(resolved).toBe(1);
		expect(mgr.getStats().wins).toBe(1);
	});

	it("should resolve all expired when marketId is omitted", async () => {
		const mgr = makeManager();
		const tenMinAgo = Date.now() - 10 * 60_000;
		addTestTrade(mgr, { marketId: "BTC-15m", windowStartMs: tenMinAgo });
		addTestTrade(mgr, { marketId: "ETH-15m", windowStartMs: tenMinAgo });

		const prices = new Map([
			["BTC-15m", 60000],
			["ETH-15m", 2200],
		]);
		const resolved = await mgr.resolveExpiredTrades(prices, 5);
		expect(resolved).toBe(2);
	});
});

describe("forceResolveStuckTrades persistence and pricing (BUG 5+6)", () => {
	it("should use actual settle price when latestPrices available (UP wins)", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, {
			windowStartMs: 1,
			marketId: "ETH-15m",
			side: "UP",
			price: 0.4,
			size: 10,
			priceToBeat: 2100,
		});

		const prices = new Map([["ETH-15m", 2200]]);
		await mgr.forceResolveStuckTrades(10, prices);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
	});

	it("should mark as loss when no latestPrices available (fallback)", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { windowStartMs: 1, side: "UP", price: 0.4, size: 10 });

		await mgr.forceResolveStuckTrades(10);

		const stats = mgr.getStats();
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
	});

	it("should use resolveSingle for DOWN trade with actual price", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, {
			windowStartMs: 1,
			marketId: "ETH-15m",
			side: "DOWN",
			price: 0.4,
			size: 10,
			priceToBeat: 2100,
		});

		const prices = new Map([["ETH-15m", 1900]]);
		await mgr.forceResolveStuckTrades(10, prices);

		expect(mgr.getStats().wins).toBe(1);
		expect(mgr.getStats().losses).toBe(0);
	});

	it("should not double-count when resolveSingle is used", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, {
			windowStartMs: 1,
			marketId: "ETH-15m",
			side: "UP",
			price: 0.5,
			size: 20,
			priceToBeat: 2100,
		});

		const prices = new Map([["ETH-15m", 1600]]);
		await mgr.forceResolveStuckTrades(10, prices);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-10.0, 2);
	});
});

describe("projected exposure", () => {
	it("should block trade when projected exposure exceeds daily limit", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { price: 0.5, size: 40, priceToBeat: 2100 });
		await mgr.resolveTrades(1000, new Map([["ETH-15m", 1900]]));

		addTestTrade(mgr, { windowStartMs: 2000 });
		addTestTrade(mgr, { windowStartMs: 3000 });
		addTestTrade(mgr, { windowStartMs: 4000 });

		expect(mgr.canTradeWithStopCheck()).toEqual({ canTrade: false, reason: "projected_exposure_exceeded" });
	});

	it("should allow trade when projected exposure is within limit", async () => {
		const mgr = makeManager();
		addTestTrade(mgr, { price: 0.5, size: 40, priceToBeat: 2100 });
		await mgr.resolveTrades(1000, new Map([["ETH-15m", 1900]]));

		addTestTrade(mgr, { windowStartMs: 2000 });
		addTestTrade(mgr, { windowStartMs: 3000 });

		expect(mgr.canTradeWithStopCheck()).toEqual({ canTrade: true });
	});

	it("should count pending trades in worst-case projection", async () => {
		const withoutPending = makeManager();
		addTestTrade(withoutPending, { price: 0.7, size: 100, priceToBeat: 2100 });
		await withoutPending.resolveTrades(1000, new Map([["ETH-15m", 1900]]));
		expect(withoutPending.canTradeWithStopCheck()).toEqual({ canTrade: true });

		const withPending = makeManager();
		addTestTrade(withPending, { price: 0.7, size: 100, priceToBeat: 2100 });
		await withPending.resolveTrades(1000, new Map([["ETH-15m", 1900]]));
		addTestTrade(withPending, { windowStartMs: 2000 });

		expect(withPending.canTradeWithStopCheck()).toEqual({ canTrade: false, reason: "projected_exposure_exceeded" });
	});
});
