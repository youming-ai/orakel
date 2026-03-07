import { describe, expect, it } from "vitest";
import {
	getWindowPriceToBeat,
	getWindowSettlePrice,
	groupCandlesByWindow,
	resolveWinningSide,
	summarizeReplayTrades,
} from "../backtest/replayCore.ts";
import type { Candle } from "../core/marketDataTypes.ts";

describe("replayCore", () => {
	it("groups candles by window start", () => {
		const candles: Candle[] = [
			{ openTime: 0, open: 1, high: 1, low: 1, close: 1, volume: 1, closeTime: 59_999 },
			{ openTime: 60_000, open: 2, high: 2, low: 2, close: 2, volume: 1, closeTime: 119_999 },
			{ openTime: 300_000, open: 3, high: 3, low: 3, close: 3, volume: 1, closeTime: 359_999 },
		];

		const windows = groupCandlesByWindow(candles, 5);
		expect(windows.size).toBe(2);
		expect(windows.get(0)?.length).toBe(2);
		expect(windows.get(300_000)?.length).toBe(1);
	});

	it("extracts priceToBeat and settlePrice from a window", () => {
		const windowCandles: Candle[] = [
			{ openTime: 0, open: 100, high: 101, low: 99, close: 100.5, volume: 1, closeTime: 59_999 },
			{ openTime: 60_000, open: 100.5, high: 102, low: 100, close: 101.25, volume: 1, closeTime: 119_999 },
		];

		expect(getWindowPriceToBeat(windowCandles)).toBe(100);
		expect(getWindowSettlePrice(windowCandles)).toBe(101.25);
		expect(resolveWinningSide(100, 101.25)).toBe("UP");
		expect(resolveWinningSide(100, 100)).toBe("DOWN");
	});

	it("summarizes replay trades by market", () => {
		const summary = summarizeReplayTrades([
			{
				marketId: "BTC-5m",
				windowStartMs: 0,
				entryTimeMs: 1,
				timeLeftMin: 2,
				side: "UP",
				phase: "MID",
				strength: "GOOD",
				priceToBeat: 100,
				settlePrice: 101,
				modelUp: 0.6,
				modelDown: 0.4,
				volImpliedUp: 0.7,
				blendSource: "ptb_ta",
				won: true,
			},
			{
				marketId: "BTC-5m",
				windowStartMs: 2,
				entryTimeMs: 3,
				timeLeftMin: 1,
				side: "DOWN",
				phase: "LATE",
				strength: "GOOD",
				priceToBeat: 100,
				settlePrice: 101,
				modelUp: 0.4,
				modelDown: 0.6,
				volImpliedUp: 0.3,
				blendSource: "ptb_ta",
				won: false,
			},
		]);

		expect(summary.totalTrades).toBe(2);
		expect(summary.wins).toBe(1);
		expect(summary.winRate).toBe(0.5);
		expect(summary.byMarket["BTC-5m"]?.trades).toBe(2);
	});
});
