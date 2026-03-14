import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountManager } from "./account.ts";
import { executePaperTrade, type PaperTradeParams } from "./paperTrader.ts";

describe("executePaperTrade", () => {
	it("should execute trade and return trade index", () => {
		const account = createAccountManager(10000, 500);
		const params: PaperTradeParams = {
			windowSlug: "test-window",
			side: "UP",
			price: 0.6,
			size: 100,
			edge: 0.05,
			modelProb: 0.65,
			marketProb: 0.6,
			priceToBeat: 50000,
			entryBtcPrice: 51000,
			phase: "MID",
		};

		const result = executePaperTrade(params, account);

		expect(result.tradeIndex).toBe(0);
		expect(account.getPendingCount()).toBe(1);
	});

	it("should return sequential indices for multiple trades", () => {
		const account = createAccountManager(10000, 500);

		const result1 = executePaperTrade(
			{
				windowSlug: "window-1",
				side: "UP",
				price: 0.6,
				size: 100,
				edge: 0.05,
				modelProb: 0.65,
				marketProb: 0.6,
				priceToBeat: 50000,
				entryBtcPrice: 51000,
				phase: "MID",
			},
			account,
		);

		const result2 = executePaperTrade(
			{
				windowSlug: "window-2",
				side: "DOWN",
				price: 0.4,
				size: 50,
				edge: 0.03,
				modelProb: 0.35,
				marketProb: 0.4,
				priceToBeat: 52000,
				entryBtcPrice: 51000,
				phase: "LATE",
			},
			account,
		);

		expect(result1.tradeIndex).toBe(0);
		expect(result2.tradeIndex).toBe(1);
	});

	it("should handle UP side correctly", () => {
		const account = createAccountManager(10000, 500);

		executePaperTrade(
			{
				windowSlug: "test",
				side: "UP",
				price: 0.5,
				size: 100,
				edge: 0.05,
				modelProb: 0.55,
				marketProb: 0.5,
				priceToBeat: 50000,
				entryBtcPrice: 51000,
				phase: "EARLY",
			},
			account,
		);

		const stats = account.getStats();
		expect(stats.pending).toBe(1);
	});

	it("should handle DOWN side correctly", () => {
		const account = createAccountManager(10000, 500);

		executePaperTrade(
			{
				windowSlug: "test",
				side: "DOWN",
				price: 0.5,
				size: 100,
				edge: 0.05,
				modelProb: 0.45,
				marketProb: 0.5,
				priceToBeat: 50000,
				entryBtcPrice: 49000,
				phase: "EARLY",
			},
			account,
		);

		const stats = account.getStats();
		expect(stats.pending).toBe(1);
	});
});
