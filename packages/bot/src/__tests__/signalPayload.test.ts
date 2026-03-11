import { describe, expect, it } from "vitest";
import type { SignalPayloadParams } from "../trading/signalPayload.ts";
import { buildSignalNewPayload, buildSignalRecommendation, buildTradeSignalPayload } from "../trading/signalPayload.ts";

function makeParams(overrides: Partial<SignalPayloadParams> = {}): SignalPayloadParams {
	return {
		market: {
			id: "BTC-15m",
			coin: "BTC",
			label: "Bitcoin 15m",
			candleWindowMinutes: 15,
			resolutionSource: "chainlink",
			spotSymbol: "BTCUSDT",
			polymarket: { seriesId: "1", seriesSlug: "btc-up-or-down-15m", slugPrefix: "btc-" },
			chainlink: { aggregator: "0x1", decimals: 8, wsSymbol: "btc" },
			pricePrecision: 0,
		},
		regimeInfo: { regime: "TREND_UP" },
		edge: {
			marketUp: 0.48,
			marketDown: 0.52,
			edgeUp: 0.08,
			edgeDown: -0.08,
			rawSum: 1,
			arbitrage: false,
			overpriced: false,
		},
		finalUp: 0.56,
		finalDown: 0.44,
		volatility15m: 0.02,
		priceToBeat: 50000,
		spotChainlinkDelta: 0.001,
		orderbookImbalance: 0.1,
		timeLeftMin: 6,
		marketUp: 0.48,
		marketDown: 0.52,
		spotPrice: 50100,
		currentPrice: 50120,
		marketSlug: "btc-updown-15m-x",
		rec: {
			action: "ENTER",
			side: "UP",
			phase: "MID",
			regime: "TREND_UP",
			strength: "GOOD",
			edge: 0.08,
		},
		poly: {
			ok: true,
			market: {
				slug: "btc-updown-15m-x",
				endDate: "2026-03-07T00:15:00.000Z",
				outcomes: ["Yes", "No"],
				outcomePrices: [0.48, 0.52],
				clobTokenIds: ["up-1", "down-1"],
				conditionId: "cond-1",
			},
			tokens: { upTokenId: "up-1", downTokenId: "down-1" },
		},
		...overrides,
	};
}

describe("signalPayload helpers", () => {
	it("buildTradeSignalPayload returns null for NO_TRADE", () => {
		const payload = buildTradeSignalPayload(
			makeParams({
				rec: { action: "NO_TRADE", side: null, phase: "MID", regime: "RANGE", reason: "edge_low" },
			}),
		);
		expect(payload).toBeNull();
	});

	it("buildTradeSignalPayload and buildSignalNewPayload keep signal fields aligned", () => {
		const params = makeParams();
		const signalPayload = buildTradeSignalPayload(params);
		expect(signalPayload).not.toBeNull();
		if (!signalPayload) return;

		const eventPayload = buildSignalNewPayload(params, signalPayload);
		expect(eventPayload.marketId).toBe(signalPayload.marketId);
		expect(eventPayload.modelUp).toBe(signalPayload.modelUp);
		expect(eventPayload.recommendation).toBe("UP:MID:GOOD");
		expect(signalPayload.conditionId).toBe("cond-1");
	});

	it("buildSignalRecommendation falls back to reason when not entering", () => {
		expect(
			buildSignalRecommendation({
				action: "NO_TRADE",
				side: null,
				phase: "LATE",
				regime: "CHOP",
				reason: "missing_market_data",
			}),
		).toBe("missing_market_data");
	});
});
