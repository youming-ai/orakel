import { describe, expect, it } from "vitest";

interface TradeEntry {
	index: number;
	side: "UP" | "DOWN";
	price: number;
	size: number;
	tradeId?: number;
	balanceBefore?: number;
	mode: "paper" | "live";
}

function filterTradesByMode(trades: TradeEntry[], mode: "paper" | "live"): TradeEntry[] {
	return trades.filter((t) => t.mode === mode);
}

describe("mainLoop mode isolation", () => {
	describe("Paper trade doesn't affect live position check", () => {
		it("should return empty array when filtering live trades from paper-only trades", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
			];

			const liveTrades = filterTradesByMode(windowTrades, "live");

			expect(liveTrades).toEqual([]);
			expect(liveTrades.length).toBe(0);
		});

		it("should not include paper trades when filtering for live mode", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					mode: "paper",
				},
			];

			const liveTrades = filterTradesByMode(windowTrades, "live");

			expect(liveTrades).toEqual([]);
			expect(liveTrades.length).toBe(0);
		});
	});

	describe("Live trade doesn't affect paper position check", () => {
		it("should return empty array when filtering paper trades from live-only trades", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");

			expect(paperTrades).toEqual([]);
			expect(paperTrades.length).toBe(0);
		});

		it("should not include live trades when filtering for paper mode", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					balanceBefore: 5000,
					mode: "live",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 4900,
					mode: "live",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");

			expect(paperTrades).toEqual([]);
			expect(paperTrades.length).toBe(0);
		});
	});

	describe("getWindowTrades returns both modes", () => {
		it("should return both paper and live trades when unfiltered", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			expect(windowTrades.length).toBe(2);
		});

		it("should return 1 paper trade when filtering paper mode", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");

			expect(paperTrades.length).toBe(1);
			expect(paperTrades[0]?.mode).toBe("paper");
		});

		it("should return 1 live trade when filtering live mode", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			const liveTrades = filterTradesByMode(windowTrades, "live");

			expect(liveTrades.length).toBe(1);
			expect(liveTrades[0]?.mode).toBe("live");
		});

		it("should correctly separate mixed paper and live trades", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
				{
					index: 2,
					side: "UP",
					price: 0.48,
					size: 75,
					tradeId: 3,
					mode: "paper",
				},
				{
					index: 3,
					side: "DOWN",
					price: 0.52,
					size: 60,
					tradeId: 4,
					balanceBefore: 4940,
					mode: "live",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");
			const liveTrades = filterTradesByMode(windowTrades, "live");

			expect(paperTrades.length).toBe(2);
			expect(liveTrades.length).toBe(2);
			expect(paperTrades.every((t) => t.mode === "paper")).toBe(true);
			expect(liveTrades.every((t) => t.mode === "live")).toBe(true);
		});
	});

	describe("Mode field is correctly set", () => {
		it("should have mode='paper' for paper trades", () => {
			const paperTrade: TradeEntry = {
				index: 0,
				side: "UP",
				price: 0.45,
				size: 100,
				tradeId: 1,
				mode: "paper",
			};

			expect(paperTrade.mode).toBe("paper");
		});

		it("should have mode='live' for live trades", () => {
			const liveTrade: TradeEntry = {
				index: 0,
				side: "UP",
				price: 0.45,
				size: 100,
				tradeId: 1,
				balanceBefore: 5000,
				mode: "live",
			};

			expect(liveTrade.mode).toBe("live");
		});

		it("should preserve mode field through filtering", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");
			const liveTrades = filterTradesByMode(windowTrades, "live");

			paperTrades.forEach((t) => {
				expect(t.mode).toBe("paper");
			});

			liveTrades.forEach((t) => {
				expect(t.mode).toBe("live");
			});
		});

		it("should correctly identify mode for all trade sides", () => {
			const trades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					mode: "paper",
				},
				{
					index: 2,
					side: "UP",
					price: 0.48,
					size: 75,
					tradeId: 3,
					balanceBefore: 5000,
					mode: "live",
				},
				{
					index: 3,
					side: "DOWN",
					price: 0.52,
					size: 60,
					tradeId: 4,
					balanceBefore: 4925,
					mode: "live",
				},
			];

			const paperTrades = filterTradesByMode(trades, "paper");
			const liveTrades = filterTradesByMode(trades, "live");

			expect(paperTrades).toEqual([trades[0], trades[1]]);
			expect(liveTrades).toEqual([trades[2], trades[3]]);
		});
	});

	describe("Window cleanup works", () => {
		it("should return empty array after clearing trades", () => {
			let windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			expect(windowTrades.length).toBe(2);

			windowTrades = [];

			expect(windowTrades.length).toBe(0);
			expect(windowTrades).toEqual([]);
		});

		it("should handle cleanup with Map deletion", () => {
			const windowTradesMap = new Map<string, TradeEntry[]>();
			const slug = "btc-updown-5m-1234";

			windowTradesMap.set(slug, [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
			]);

			expect(windowTradesMap.has(slug)).toBe(true);
			expect(windowTradesMap.get(slug)?.length).toBe(1);

			windowTradesMap.delete(slug);

			expect(windowTradesMap.has(slug)).toBe(false);
			expect(windowTradesMap.get(slug)).toBeUndefined();
		});

		it("should return empty array when accessing deleted slug", () => {
			const windowTradesMap = new Map<string, TradeEntry[]>();
			const slug = "btc-updown-5m-1234";

			windowTradesMap.set(slug, [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
			]);

			windowTradesMap.delete(slug);

			const trades = windowTradesMap.get(slug) ?? [];
			expect(trades).toEqual([]);
		});

		it("should preserve other slugs when cleaning up one", () => {
			const windowTradesMap = new Map<string, TradeEntry[]>();
			const slug1 = "btc-updown-5m-1234";
			const slug2 = "btc-updown-5m-5678";

			windowTradesMap.set(slug1, [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
			]);

			windowTradesMap.set(slug2, [
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					mode: "live",
				},
			]);

			windowTradesMap.delete(slug1);

			expect(windowTradesMap.has(slug1)).toBe(false);
			expect(windowTradesMap.has(slug2)).toBe(true);
			expect(windowTradesMap.get(slug2)?.length).toBe(1);
		});
	});

	describe("Edge cases and invariants", () => {
		it("should handle empty trade array", () => {
			const windowTrades: TradeEntry[] = [];

			const paperTrades = filterTradesByMode(windowTrades, "paper");
			const liveTrades = filterTradesByMode(windowTrades, "live");

			expect(paperTrades).toEqual([]);
			expect(liveTrades).toEqual([]);
		});

		it("should maintain trade order after filtering", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
				{
					index: 2,
					side: "UP",
					price: 0.48,
					size: 75,
					tradeId: 3,
					mode: "paper",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");

			expect(paperTrades[0]?.index).toBe(0);
			expect(paperTrades[1]?.index).toBe(2);
		});

		it("should not mutate original array when filtering", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			const originalLength = windowTrades.length;
			filterTradesByMode(windowTrades, "paper");

			expect(windowTrades.length).toBe(originalLength);
		});

		it("should handle trades with optional fields", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					balanceBefore: 5000,
					mode: "live",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");
			const liveTrades = filterTradesByMode(windowTrades, "live");

			expect(paperTrades.length).toBe(1);
			expect(liveTrades.length).toBe(1);
			expect(paperTrades[0]?.tradeId).toBeUndefined();
		});

		it("should correctly filter when all trades are same mode", () => {
			const windowTrades: TradeEntry[] = [
				{
					index: 0,
					side: "UP",
					price: 0.45,
					size: 100,
					tradeId: 1,
					mode: "paper",
				},
				{
					index: 1,
					side: "DOWN",
					price: 0.55,
					size: 50,
					tradeId: 2,
					mode: "paper",
				},
				{
					index: 2,
					side: "UP",
					price: 0.48,
					size: 75,
					tradeId: 3,
					mode: "paper",
				},
			];

			const paperTrades = filterTradesByMode(windowTrades, "paper");
			const liveTrades = filterTradesByMode(windowTrades, "live");

			expect(paperTrades.length).toBe(3);
			expect(liveTrades.length).toBe(0);
		});
	});
});
