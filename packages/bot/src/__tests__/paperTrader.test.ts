import { beforeEach, describe, expect, it } from "vitest";
import { type AccountManager, createAccountManager } from "../trading/account.ts";
import { executePaperTrade, type PaperTradeParams } from "../trading/paperTrader.ts";

function makePaperTradeParams(overrides: Partial<PaperTradeParams> = {}): PaperTradeParams {
	return {
		windowSlug: "btc-15m",
		side: "UP",
		price: 0.55,
		size: 5,
		edge: 0.05,
		modelProb: 0.6,
		marketProb: 0.5,
		priceToBeat: 0.52,
		entryBtcPrice: 45000,
		phase: "entry",
		...overrides,
	};
}

describe("executePaperTrade", () => {
	let account: AccountManager;

	beforeEach(() => {
		account = createAccountManager(1000); // 1000 USDC starting
	});

	it("returns success with tradeIndex 0 on first execution", () => {
		const params = makePaperTradeParams();
		const result = executePaperTrade(params, account);

		expect(result.success).toBe(true);
		expect(result.tradeIndex).toBe(0);
	});

	it("returns incrementing tradeIndex for multiple trades", () => {
		const params1 = makePaperTradeParams();
		const params2 = makePaperTradeParams({ side: "DOWN" });
		const params3 = makePaperTradeParams({ size: 10 });

		const result1 = executePaperTrade(params1, account);
		const result2 = executePaperTrade(params2, account);
		const result3 = executePaperTrade(params3, account);

		expect(result1.tradeIndex).toBe(0);
		expect(result2.tradeIndex).toBe(1);
		expect(result3.tradeIndex).toBe(2);
	});

	it("records trade via AccountManager", () => {
		const params = makePaperTradeParams({ side: "UP", size: 5, price: 0.55 });
		executePaperTrade(params, account);

		const stats = account.getStats();
		expect(stats.totalTrades).toBe(0); // not settled yet
		expect(stats.pending).toBe(1); // but pending
	});

	it("correctly records trade parameters in AccountManager", () => {
		const params = makePaperTradeParams({ side: "DOWN", size: 10, price: 0.45 });
		const result = executePaperTrade(params, account);

		// Settle the trade to verify it was recorded correctly
		account.settleTrade(result.tradeIndex, true);
		const stats = account.getStats();

		expect(stats.totalTrades).toBe(1);
		expect(stats.wins).toBe(1);
	});

	it("updates AccountManager balance after settlement", () => {
		const initialStats = account.getStats();
		const initialBalance = initialStats.balanceUsdc;

		const params = makePaperTradeParams({ side: "UP", size: 5, price: 0.55 });
		const result = executePaperTrade(params, account);

		// Settle as a win
		account.settleTrade(result.tradeIndex, true);
		const finalStats = account.getStats();

		expect(finalStats.balanceUsdc).not.toBe(initialBalance);
		expect(finalStats.totalPnl).toBeGreaterThan(0);
	});

	it("handles multiple trades with different outcomes", () => {
		const params1 = makePaperTradeParams({ side: "UP", size: 5, price: 0.55 });
		const params2 = makePaperTradeParams({ side: "DOWN", size: 5, price: 0.45 });

		const result1 = executePaperTrade(params1, account);
		const result2 = executePaperTrade(params2, account);

		account.settleTrade(result1.tradeIndex, true); // win
		account.settleTrade(result2.tradeIndex, false); // loss

		const stats = account.getStats();
		expect(stats.totalTrades).toBe(2);
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(1);
		expect(stats.winRate).toBeCloseTo(0.5, 6);
	});
});
