import type { Trade } from "@polymarket/clob-client";
import { Side } from "@polymarket/clob-client";
import { describe, expect, it } from "vitest";
import { calculateStatsFromTrades, convertTradeToLiveTrade } from "./liveStats.ts";

// Helper to create mock Trade objects
function makeTrade(overrides: Record<string, unknown> = {}): Trade {
	return {
		id: "trade-1",
		market: "BTC",
		asset_id: "asset-123",
		side: Side.BUY,
		size: "10",
		price: "0.5",
		status: "matched",
		match_time: "2026-02-28T12:00:00Z",
		outcome: "",
		transaction_hash: "0x123",
		...overrides,
	} as Trade;
}

describe("convertTradeToLiveTrade", () => {
	it("should convert BUY trade with outcome '1' (win)", () => {
		const trade = makeTrade({
			side: Side.BUY,
			outcome: "1",
			size: "10",
			price: "0.5",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.id).toBe("trade-1");
		expect(result.side).toBe("BUY");
		expect(result.size).toBe(10);
		expect(result.price).toBe(0.5);
		expect(result.outcome).toBe("1");
		expect(result.won).toBe(true);
		expect(result.pnl).toBe(5); // 10 * (1 - 0.5) = 5
	});

	it("should convert BUY trade with outcome '0' (loss)", () => {
		const trade = makeTrade({
			side: Side.BUY,
			outcome: "0",
			size: "10",
			price: "0.5",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.won).toBe(false);
		expect(result.pnl).toBe(-5); // -(10 * 0.5) = -5
	});

	it("should convert SELL trade with outcome '1' (loss)", () => {
		const trade = makeTrade({
			side: Side.SELL,
			outcome: "1",
			size: "10",
			price: "0.5",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.won).toBe(false);
		expect(result.pnl).toBe(-5); // -(10 * (1 - 0.5)) = -5
	});

	it("should convert SELL trade with outcome '0' (win)", () => {
		const trade = makeTrade({
			side: Side.SELL,
			outcome: "0",
			size: "10",
			price: "0.5",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.won).toBe(true);
		expect(result.pnl).toBe(5); // 10 * 0.5 = 5
	});

	it("should handle trade with no outcome (pending)", () => {
		const trade = makeTrade({
			outcome: "",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.won).toBeUndefined();
		expect(result.pnl).toBeUndefined();
	});

	it("should calculate costUsd correctly", () => {
		const trade = makeTrade({
			size: "20",
			price: "0.75",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.costUsd).toBe(15); // 20 * 0.75 = 15
	});

	it("should preserve all trade fields", () => {
		const trade = makeTrade({
			id: "custom-id",
			market: "ETH",
			asset_id: "eth-asset",
			status: "filled",
			match_time: "2026-02-28T13:00:00Z",
			transaction_hash: "0xabc",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.id).toBe("custom-id");
		expect(result.market).toBe("ETH");
		expect(result.assetId).toBe("eth-asset");
		expect(result.status).toBe("filled");
		expect(result.matchTime).toBe("2026-02-28T13:00:00Z");
		expect(result.transactionHash).toBe("0xabc");
	});

	it("should handle string to number conversion for size and price", () => {
		const trade = makeTrade({
			size: "5.5",
			price: "0.25",
		});

		const result = convertTradeToLiveTrade(trade);

		expect(result.size).toBe(5.5);
		expect(result.price).toBe(0.25);
		expect(result.costUsd).toBeCloseTo(1.375, 3);
	});
});

describe("calculateStatsFromTrades", () => {
	it("should calculate stats from empty array", () => {
		const result = calculateStatsFromTrades([]);

		expect(result.totalTrades).toBe(0);
		expect(result.wins).toBe(0);
		expect(result.losses).toBe(0);
		expect(result.pending).toBe(0);
		expect(result.winRate).toBe(0);
		expect(result.totalPnl).toBe(0);
		expect(result.trades).toEqual([]);
	});

	it("should calculate stats from all winning trades", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "1",
				transactionHash: "0x1",
				costUsd: 5,
				won: true,
				pnl: 5,
			},
			{
				id: "2",
				market: "ETH",
				assetId: "a2",
				side: "BUY",
				size: 20,
				price: 0.4,
				status: "matched",
				matchTime: "2026-02-28T12:01:00Z",
				outcome: "1",
				transactionHash: "0x2",
				costUsd: 8,
				won: true,
				pnl: 12,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalTrades).toBe(2);
		expect(result.wins).toBe(2);
		expect(result.losses).toBe(0);
		expect(result.pending).toBe(0);
		expect(result.winRate).toBe(1);
		expect(result.totalPnl).toBe(17);
	});

	it("should calculate stats from all losing trades", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "0",
				transactionHash: "0x1",
				costUsd: 5,
				won: false,
				pnl: -5,
			},
			{
				id: "2",
				market: "ETH",
				assetId: "a2",
				side: "BUY",
				size: 20,
				price: 0.4,
				status: "matched",
				matchTime: "2026-02-28T12:01:00Z",
				outcome: "0",
				transactionHash: "0x2",
				costUsd: 8,
				won: false,
				pnl: -8,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalTrades).toBe(2);
		expect(result.wins).toBe(0);
		expect(result.losses).toBe(2);
		expect(result.pending).toBe(0);
		expect(result.winRate).toBe(0);
		expect(result.totalPnl).toBe(-13);
	});

	it("should calculate stats from mixed resolved and pending trades", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "1",
				transactionHash: "0x1",
				costUsd: 5,
				won: true,
				pnl: 5,
			},
			{
				id: "2",
				market: "ETH",
				assetId: "a2",
				side: "BUY",
				size: 20,
				price: 0.4,
				status: "matched",
				matchTime: "2026-02-28T12:01:00Z",
				outcome: "",
				transactionHash: "0x2",
				costUsd: 8,
				won: undefined,
				pnl: undefined,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalTrades).toBe(2);
		expect(result.wins).toBe(1);
		expect(result.losses).toBe(0);
		expect(result.pending).toBe(1);
		expect(result.winRate).toBe(1);
		expect(result.totalPnl).toBe(5);
	});

	it("should calculate correct winRate for mixed wins and losses", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "1",
				transactionHash: "0x1",
				costUsd: 5,
				won: true,
				pnl: 5,
			},
			{
				id: "2",
				market: "ETH",
				assetId: "a2",
				side: "BUY",
				size: 20,
				price: 0.4,
				status: "matched",
				matchTime: "2026-02-28T12:01:00Z",
				outcome: "0",
				transactionHash: "0x2",
				costUsd: 8,
				won: false,
				pnl: -8,
			},
			{
				id: "3",
				market: "SOL",
				assetId: "a3",
				side: "BUY",
				size: 15,
				price: 0.6,
				status: "matched",
				matchTime: "2026-02-28T12:02:00Z",
				outcome: "1",
				transactionHash: "0x3",
				costUsd: 9,
				won: true,
				pnl: 6,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalTrades).toBe(3);
		expect(result.wins).toBe(2);
		expect(result.losses).toBe(1);
		expect(result.winRate).toBeCloseTo(2 / 3, 5);
		expect(result.totalPnl).toBe(3);
	});

	it("should accumulate totalPnl correctly with negative values", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "1",
				transactionHash: "0x1",
				costUsd: 5,
				won: true,
				pnl: 10.5,
			},
			{
				id: "2",
				market: "ETH",
				assetId: "a2",
				side: "BUY",
				size: 20,
				price: 0.4,
				status: "matched",
				matchTime: "2026-02-28T12:01:00Z",
				outcome: "0",
				transactionHash: "0x2",
				costUsd: 8,
				won: false,
				pnl: -3.25,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalPnl).toBeCloseTo(7.25, 2);
	});

	it("should only count matched/filled trades as resolved", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "1",
				transactionHash: "0x1",
				costUsd: 5,
				won: true,
				pnl: 5,
			},
			{
				id: "2",
				market: "ETH",
				assetId: "a2",
				side: "BUY",
				size: 20,
				price: 0.4,
				status: "pending",
				matchTime: "2026-02-28T12:01:00Z",
				outcome: "1",
				transactionHash: "0x2",
				costUsd: 8,
				won: true,
				pnl: 12,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalTrades).toBe(2);
		expect(result.wins).toBe(1);
		expect(result.losses).toBe(0);
		expect(result.pending).toBe(0);
		expect(result.totalPnl).toBe(5);
	});

	it("should handle trades with undefined won/pnl fields", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "",
				transactionHash: "0x1",
				costUsd: 5,
				won: undefined,
				pnl: undefined,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalTrades).toBe(1);
		expect(result.wins).toBe(0);
		expect(result.losses).toBe(0);
		expect(result.pending).toBe(1);
		expect(result.totalPnl).toBe(0);
	});

	it("should round totalPnl to 2 decimal places", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "1",
				transactionHash: "0x1",
				costUsd: 5,
				won: true,
				pnl: 1.23456789,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.totalPnl).toBe(1.23);
	});

	it("should include resolved trades in result", () => {
		const trades = [
			{
				id: "1",
				market: "BTC",
				assetId: "a1",
				side: "BUY",
				size: 10,
				price: 0.5,
				status: "matched",
				matchTime: "2026-02-28T12:00:00Z",
				outcome: "1",
				transactionHash: "0x1",
				costUsd: 5,
				won: true,
				pnl: 5,
			},
			{
				id: "2",
				market: "ETH",
				assetId: "a2",
				side: "BUY",
				size: 20,
				price: 0.4,
				status: "pending",
				matchTime: "2026-02-28T12:01:00Z",
				outcome: "1",
				transactionHash: "0x2",
				costUsd: 8,
				won: true,
				pnl: 12,
			},
		];

		const result = calculateStatsFromTrades(trades);

		expect(result.trades).toHaveLength(1);
		expect(result.trades[0]?.id).toBe("1");
	});
});
