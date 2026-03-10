import { describe, expect, it } from "vitest";
import type { TradeEntry } from "../trading/accountTypes.ts";
import { checkTakeProfit, checkTradeTakeProfit, type TakeProfitConfig } from "../trading/takeProfit.ts";

function buildTrade(overrides: Partial<TradeEntry> = {}): TradeEntry {
	return {
		id: "tp-test-1",
		marketId: "BTC-15m",
		windowStartMs: Date.now() - 300_000,
		side: "UP",
		price: 0.5,
		size: 10,
		priceToBeat: 84000,
		currentPriceAtEntry: 84100,
		timestamp: new Date().toISOString(),
		resolved: false,
		won: null,
		pnl: null,
		settlePrice: null,
		...overrides,
	};
}

const config: TakeProfitConfig = {
	takeProfitPercent: 0.15,
	checkIntervalMs: 5000,
};

describe("checkTradeTakeProfit", () => {
	it("triggers take-profit when gain exceeds threshold", () => {
		const trade = buildTrade({ price: 0.5 });
		// Token price rose from 0.50 to 0.60 → 20% gain
		const result = checkTradeTakeProfit(trade, 0.6, config);
		expect(result.shouldTakeProfit).toBe(true);
		expect(result.gainPercent).toBeCloseTo(0.2, 8);
		expect(result.reason).toContain("take_profit_");
	});

	it("does not trigger when gain is below threshold", () => {
		const trade = buildTrade({ price: 0.5 });
		// Token price rose from 0.50 to 0.55 → 10% gain (below 15%)
		const result = checkTradeTakeProfit(trade, 0.55, config);
		expect(result.shouldTakeProfit).toBe(false);
		expect(result.gainPercent).toBeCloseTo(0.1, 8);
	});

	it("does not trigger when price dropped", () => {
		const trade = buildTrade({ price: 0.5 });
		const result = checkTradeTakeProfit(trade, 0.45, config);
		expect(result.shouldTakeProfit).toBe(false);
		expect(result.gainPercent).toBeCloseTo(-0.1, 8);
	});

	it("triggers just above threshold", () => {
		const trade = buildTrade({ price: 0.5 });
		// 0.58 / 0.5 - 1 = 0.16 (above 15%)
		const result = checkTradeTakeProfit(trade, 0.58, config);
		expect(result.shouldTakeProfit).toBe(true);
		expect(result.gainPercent).toBeCloseTo(0.16, 8);
	});

	it("works for DOWN trades with high entry price", () => {
		const trade = buildTrade({ side: "DOWN", price: 0.4 });
		// NO token price rose from 0.40 to 0.50 → 25% gain
		const result = checkTradeTakeProfit(trade, 0.5, config);
		expect(result.shouldTakeProfit).toBe(true);
		expect(result.gainPercent).toBeCloseTo(0.25, 8);
	});
});

describe("checkTakeProfit (batch)", () => {
	it("checks UP trades using marketUp price", () => {
		const trades = [buildTrade({ side: "UP", price: 0.5 })];
		const prices = new Map([["BTC-15m", { up: 0.6, down: 0.4 }]]);
		const results = checkTakeProfit(trades, prices, config);
		expect(results).toHaveLength(1);
		expect(results[0]!.shouldTakeProfit).toBe(true);
		expect(results[0]!.currentTokenPrice).toBe(0.6);
	});

	it("checks DOWN trades using marketDown price", () => {
		const trades = [buildTrade({ side: "DOWN", price: 0.4 })];
		const prices = new Map([["BTC-15m", { up: 0.5, down: 0.5 }]]);
		const results = checkTakeProfit(trades, prices, config);
		expect(results).toHaveLength(1);
		expect(results[0]!.shouldTakeProfit).toBe(true);
		expect(results[0]!.currentTokenPrice).toBe(0.5);
	});

	it("skips resolved trades", () => {
		const trades = [buildTrade({ resolved: true })];
		const prices = new Map([["BTC-15m", { up: 0.9, down: 0.1 }]]);
		const results = checkTakeProfit(trades, prices, config);
		expect(results).toHaveLength(0);
	});

	it("skips trades with no matching market price", () => {
		const trades = [buildTrade({ marketId: "ETH-15m" })];
		const prices = new Map([["BTC-15m", { up: 0.9, down: 0.1 }]]);
		const results = checkTakeProfit(trades, prices, config);
		expect(results).toHaveLength(0);
	});

	it("skips trades when token price is null", () => {
		const trades = [buildTrade({ side: "UP" })];
		const prices = new Map([["BTC-15m", { up: null, down: 0.5 }]]);
		const results = checkTakeProfit(trades, prices, config);
		expect(results).toHaveLength(0);
	});
});
