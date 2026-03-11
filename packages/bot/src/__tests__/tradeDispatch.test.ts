import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketConfig } from "../core/configTypes.ts";
import type { ProcessMarketResult } from "../pipeline/processMarket.ts";
import type { TradeSignal } from "../trading/tradeTypes.ts";

const CONFIG = {
	strategy: {
		maxGlobalTradesPerWindow: 2,
	},
	paperRisk: {
		maxTradeSizeUsdc: 10,
		limitDiscount: 0.01,
		dailyMaxLossUsdc: 100,
		maxOpenPositions: 2,
		minLiquidity: 5_000,
		maxTradesPerWindow: 2,
	},
	liveRisk: {
		maxTradeSizeUsdc: 10,
		limitDiscount: 0.01,
		dailyMaxLossUsdc: 100,
		maxOpenPositions: 2,
		minLiquidity: 5_000,
		maxTradesPerWindow: 2,
	},
};

const executeTrade = vi.fn();
const getAccount = vi.fn();
const isLiveRunning = vi.fn();
const isPaperRunning = vi.fn();

vi.mock("../core/config.ts", () => ({
	CONFIG,
}));

vi.mock("../trading/trader.ts", () => ({
	executeTrade,
}));

vi.mock("../trading/accountStats.ts", () => ({
	getAccount,
}));

vi.mock("../core/state.ts", () => ({
	isLiveRunning,
	isPaperRunning,
}));

vi.mock("../core/logger.ts", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

function makeMarket(id: "BTC-15m" | "ETH-15m"): MarketConfig {
	const candleWindowMinutes = 15;
	const isBtc = id === "BTC-15m";
	return {
		id,
		coin: isBtc ? "BTC" : "ETH",
		label: id,
		candleWindowMinutes,
		resolutionSource: "chainlink",
		spotSymbol: isBtc ? "BTCUSDT" : "ETHUSDT",
		polymarket: {
			seriesId: isBtc ? "10192" : "10191",
			seriesSlug: isBtc ? "btc-up-or-down-15m" : "eth-up-or-down-15m",
			slugPrefix: isBtc ? "btc-updown-15m-" : "eth-updown-15m-",
		},
		chainlink: {
			aggregator: isBtc ? "0xc907E116054Ad103354f2D350FD2514433D57F6f" : "0xF9680D99D6C9589e2a93a78A04A279e509205945",
			decimals: 8,
			wsSymbol: isBtc ? "btc" : "eth",
		},
		pricePrecision: isBtc ? 0 : 2,
	};
}

function makeSignalPayload(params: {
	marketId: "BTC-15m" | "ETH-15m";
	marketSlug: string;
	side: "UP" | "DOWN";
	modelUp?: number;
	modelDown?: number;
}): TradeSignal {
	const { marketId, marketSlug, side, modelUp = 0.62, modelDown = 0.38 } = params;
	return {
		timestamp: new Date().toISOString(),
		marketId,
		marketSlug,
		side,
		phase: "MID",
		strength: "GOOD",
		edgeUp: side === "UP" ? 0.12 : 0.02,
		edgeDown: side === "DOWN" ? 0.11 : 0.01,
		modelUp,
		modelDown,
		marketUp: 0.5,
		marketDown: 0.5,
		timeLeftMin: 4,
		spotPrice: 90_500,
		priceToBeat: 90_000,
		currentPrice: 90_550,
		blendSource: "ptb_ta",
		volImpliedUp: 0.63,
		volatility15m: 0.002,
		spotChainlinkDelta: 0,
		orderbookImbalance: 0,
		rawSum: 1.01,
		arbitrage: false,
		tokens: null,
		conditionId: null,
	};
}

function makeResult(params: {
	marketId: "BTC-15m" | "ETH-15m";
	marketSlug: string;
	side: "UP" | "DOWN";
	edge: number;
	timeLeftMin?: number;
}): ProcessMarketResult {
	const { marketId, marketSlug, side, edge, timeLeftMin } = params;
	return {
		ok: true,
		market: makeMarket(marketId),
		rec: {
			action: "ENTER",
			side,
			phase: "MID",
			regime: "TREND_UP",
			strength: "GOOD",
			edge,
		},
		timeLeftMin: timeLeftMin ?? 4,
		rawSum: 1.01,
		orderbook: {
			up: {
				bestBid: 0.49,
				bestAsk: 0.51,
				spread: 0.02,
				bidLiquidity: 10_000,
				askLiquidity: 10_000,
				bidNotional: 4_900,
				askNotional: 5_100,
			},
			down: {
				bestBid: 0.49,
				bestAsk: 0.51,
				spread: 0.02,
				bidLiquidity: 10_000,
				askLiquidity: 10_000,
				bidNotional: 4_900,
				askNotional: 5_100,
			},
		},
		signalPayload: makeSignalPayload({
			marketId,
			marketSlug,
			side,
		}),
	};
}

function makeLiveAccount() {
	return {
		canTradeWithStopCheck: vi.fn().mockReturnValue({ canTrade: true }),
	};
}

function makeLiveTracker() {
	return {
		hasOrder: vi.fn().mockReturnValue(false),
		totalActive: vi.fn().mockReturnValue(0),
		record: vi.fn(),
		onCooldown: vi.fn().mockReturnValue(false),
		canTradeGlobally: vi.fn().mockReturnValue(true),
	};
}

describe("dispatchTradeCandidates", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-07T15:56:00.000Z"));
		vi.clearAllMocks();
		isPaperRunning.mockReturnValue(false);
		isLiveRunning.mockReturnValue(true);
		getAccount.mockReturnValue(makeLiveAccount());
		executeTrade.mockResolvedValue({
			success: true,
			orderId: "live-order-1",
			tradePrice: 0.53,
			isGtdOrder: true,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("places only one live trade for candidates that share the same settlement time", async () => {
		const { dispatchTradeCandidates } = await import("../runtime/tradeDispatch.ts");
		const liveTracker = makeLiveTracker();
		const onLiveOrderPlaced = vi.fn();

		await dispatchTradeCandidates({
			results: [
				makeResult({
					marketId: "BTC-15m",
					marketSlug: "btc-updown-15m-1772898300",
					side: "UP",
					edge: 0.12,
				}),
				makeResult({
					marketId: "BTC-15m",
					marketSlug: "btc-updown-15m-1772898300",
					side: "DOWN",
					edge: 0.11,
				}),
			],
			paperTracker: {
				has: vi.fn(),
				record: vi.fn(),
				canTradeGlobally: vi.fn(),
			},
			liveTracker,
			onLiveOrderPlaced,
		});

		expect(executeTrade).toHaveBeenCalledOnce();
		expect(executeTrade).toHaveBeenCalledWith(
			expect.objectContaining({
				marketId: "BTC-15m",
				marketSlug: "btc-updown-15m-1772898300",
			}),
			expect.objectContaining({
				marketConfig: expect.objectContaining({ id: "BTC-15m" }),
			}),
			"live",
		);
		expect(liveTracker.record).toHaveBeenCalledOnce();
		expect(onLiveOrderPlaced).toHaveBeenCalledOnce();
	});

	it("falls through to the next correlated candidate when the best one fails", async () => {
		const { dispatchTradeCandidates } = await import("../runtime/tradeDispatch.ts");
		const liveTracker = makeLiveTracker();

		executeTrade
			.mockResolvedValueOnce({
				success: false,
				reason: "liquidity_rejected",
			})
			.mockResolvedValueOnce({
				success: true,
				orderId: "live-order-2",
				tradePrice: 0.54,
				isGtdOrder: true,
			});

		await dispatchTradeCandidates({
			results: [
				makeResult({
					marketId: "BTC-15m",
					marketSlug: "btc-updown-15m-1772898300",
					side: "UP",
					edge: 0.12,
				}),
				makeResult({
					marketId: "ETH-15m",
					marketSlug: "eth-updown-15m-1772898900",
					side: "UP",
					edge: 0.11,
				}),
			],
			paperTracker: {
				has: vi.fn(),
				record: vi.fn(),
				canTradeGlobally: vi.fn(),
			},
			liveTracker,
			onLiveOrderPlaced: vi.fn(),
		});

		expect(executeTrade).toHaveBeenCalledTimes(2);
		expect(executeTrade).toHaveBeenLastCalledWith(
			expect.objectContaining({
				marketId: "ETH-15m",
				marketSlug: "eth-updown-15m-1772898900",
			}),
			expect.objectContaining({
				marketConfig: expect.objectContaining({ id: "ETH-15m" }),
			}),
			"live",
		);
		expect(liveTracker.record).toHaveBeenCalledOnce();
	});

	it("allows separate trades when the settlements are different", async () => {
		const { dispatchTradeCandidates } = await import("../runtime/tradeDispatch.ts");
		const liveTracker = makeLiveTracker();

		vi.setSystemTime(new Date("2026-03-07T15:54:00.000Z"));

		await dispatchTradeCandidates({
			results: [
				makeResult({
					marketId: "BTC-15m",
					marketSlug: "btc-updown-15m-1772898300",
					side: "UP",
					edge: 0.12,
				}),
				makeResult({
					marketId: "ETH-15m",
					marketSlug: "eth-updown-15m-1772898600",
					side: "DOWN",
					edge: 0.11,
				}),
			],
			paperTracker: {
				has: vi.fn(),
				record: vi.fn(),
				canTradeGlobally: vi.fn(),
			},
			liveTracker,
			onLiveOrderPlaced: vi.fn(),
		});

		expect(executeTrade).toHaveBeenCalledTimes(2);
		expect(liveTracker.record).toHaveBeenCalledTimes(2);
	});

	it("does not add a hidden dispatch buffer once strategy already emitted ENTER", async () => {
		const { dispatchTradeCandidates } = await import("../runtime/tradeDispatch.ts");
		const liveTracker = makeLiveTracker();

		await dispatchTradeCandidates({
			results: [
				makeResult({
					marketId: "ETH-15m",
					marketSlug: "eth-updown-15m-1772898900",
					side: "UP",
					edge: 0.09,
					timeLeftMin: 4.4,
				}),
			],
			paperTracker: {
				has: vi.fn(),
				record: vi.fn(),
				canTradeGlobally: vi.fn(),
			},
			liveTracker,
			onLiveOrderPlaced: vi.fn(),
		});

		expect(executeTrade).toHaveBeenCalledOnce();
		expect(executeTrade).toHaveBeenCalledWith(
			expect.objectContaining({
				marketId: "ETH-15m",
				marketSlug: "eth-updown-15m-1772898900",
			}),
			expect.any(Object),
			"live",
		);
	});

	it("should skip trade when notional liquidity is below minimum", async () => {
		const { dispatchTradeCandidates } = await import("../runtime/tradeDispatch.ts");
		const liveTracker = makeLiveTracker();
		const result = makeResult({
			marketId: "BTC-15m",
			marketSlug: "btc-updown-15m-1772898300",
			side: "UP",
			edge: 0.12,
		});

		if (result.orderbook?.up) {
			result.orderbook.up.askNotional = 4_900;
			result.orderbook.up.askLiquidity = 20_000;
		}

		await dispatchTradeCandidates({
			results: [result],
			paperTracker: {
				has: vi.fn(),
				record: vi.fn(),
				canTradeGlobally: vi.fn(),
			},
			liveTracker,
			onLiveOrderPlaced: vi.fn(),
		});

		expect(executeTrade).not.toHaveBeenCalled();
		expect(liveTracker.record).not.toHaveBeenCalled();
	});

	it("should allow trade when notional liquidity meets minimum", async () => {
		const { dispatchTradeCandidates } = await import("../runtime/tradeDispatch.ts");
		const liveTracker = makeLiveTracker();
		const result = makeResult({
			marketId: "BTC-15m",
			marketSlug: "btc-updown-15m-1772898300",
			side: "UP",
			edge: 0.12,
		});

		if (result.orderbook?.up) {
			result.orderbook.up.askNotional = 5_000;
			result.orderbook.up.askLiquidity = 20_000;
		}

		await dispatchTradeCandidates({
			results: [result],
			paperTracker: {
				has: vi.fn(),
				record: vi.fn(),
				canTradeGlobally: vi.fn(),
			},
			liveTracker,
			onLiveOrderPlaced: vi.fn(),
		});

		expect(executeTrade).toHaveBeenCalledOnce();
		expect(liveTracker.record).toHaveBeenCalledOnce();
	});
});
