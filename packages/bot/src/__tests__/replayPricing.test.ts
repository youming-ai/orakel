import { describe, expect, it } from "vitest";
import type { ReplayTrade } from "../backtest/replayCore.ts";
import { applyFixedFillPricing, computeBinaryPnlUsdc } from "../backtest/replayPricing.ts";

function makeTrade(overrides: Partial<ReplayTrade> = {}): ReplayTrade {
	return {
		marketId: "BTC-15m",
		windowStartMs: 0,
		entryTimeMs: 60_000,
		timeLeftMin: 5,
		side: "UP",
		phase: "MID",
		strength: "GOOD",
		priceToBeat: 100,
		settlePrice: 101,
		modelUp: 0.7,
		modelDown: 0.3,
		volImpliedUp: 0.72,
		blendSource: "ptb_ta",
		won: true,
		...overrides,
	};
}

describe("replayPricing", () => {
	it("computes binary pnl for a winning trade", () => {
		const priced = computeBinaryPnlUsdc({
			entryPrice: 0.5,
			won: true,
			stakeUsdc: 1,
			slippageBps: 0,
		});

		expect(priced?.effectiveEntryPrice).toBe(0.5);
		expect(priced?.pnlUsdc).toBeCloseTo(1, 10);
	});

	it("computes binary pnl for a losing trade", () => {
		const priced = computeBinaryPnlUsdc({
			entryPrice: 0.42,
			won: false,
			stakeUsdc: 2,
			slippageBps: 0,
		});

		expect(priced?.pnlUsdc).toBeCloseTo(-2, 10);
	});

	it("applies fixed fill pricing when no historical fill is available", () => {
		const priced = applyFixedFillPricing([makeTrade()], {
			fillMode: "fixed",
			quoteMode: "fixed",
			quoteScope: "all",
			stakeUsdc: 1,
			slippageBps: 0,
		});

		expect(priced[0]?.entryPriceSource).toBe("fixed_even");
		expect(priced[0]?.entryPrice).toBe(0.5);
		expect(priced[0]?.pnlUsdc).toBeCloseTo(1, 10);
	});
});
