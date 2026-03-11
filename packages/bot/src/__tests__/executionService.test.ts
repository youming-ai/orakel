import { describe, expect, it, vi } from "vitest";
import type { RiskConfig } from "../core/configTypes.ts";
import type { TradeSignal } from "../trading/tradeTypes.ts";

vi.mock("../core/config.ts", () => ({
	CONFIG: {
		execution: {
			minOrderPrice: 0.01,
			maxOrderPrice: 0.99,
			confidentPrice: 0.9,
			confidentOpposite: 0.1,
		},
	},
}));

vi.mock("../core/logger.ts", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

vi.mock("../trading/heartbeatService.ts", () => ({
	emitTradeExecuted: vi.fn(),
	registerOpenGtdOrder: vi.fn(),
	startHeartbeat: vi.fn(),
	withTradeLock: async (_mode: "paper" | "live", callback: () => Promise<unknown>) => callback(),
}));

vi.mock("../trading/accountStats.ts", () => ({
	getAccount: () => ({
		addTrade: () => "paper-trade-id",
	}),
}));

vi.mock("../trading/walletService.ts", () => ({
	getClient: vi.fn(),
	getWallet: vi.fn(),
}));

const { computeMakerPrice, computeTakerPrice, executeTrade } = await import("../trading/executionService.ts");

function makeRisk(overrides: Partial<RiskConfig> = {}): RiskConfig {
	return {
		maxTradeSizeUsdc: 5,
		limitDiscount: 0.04,
		dailyMaxLossUsdc: 100,
		maxOpenPositions: 2,
		minLiquidity: 5000,
		maxTradesPerWindow: 2,
		paperSlippage: 0.02,
		...overrides,
	};
}

function makeSignal(overrides: Partial<TradeSignal> = {}): TradeSignal {
	return {
		timestamp: new Date().toISOString(),
		marketId: "BTC-15m",
		marketSlug: "test-slug",
		side: "UP",
		phase: "MID",
		strength: "GOOD",
		edgeUp: 0.1,
		edgeDown: 0.02,
		modelUp: 0.6,
		modelDown: 0.4,
		marketUp: 0.5,
		marketDown: 0.5,
		timeLeftMin: 8,
		spotPrice: 100000,
		priceToBeat: 99900,
		currentPrice: 100000,
		blendSource: "ptb_ta",
		volImpliedUp: 0.55,
		volatility15m: 0.005,
		spotChainlinkDelta: 0.001,
		orderbookImbalance: 0.1,
		rawSum: 1.02,
		arbitrage: false,
		tokens: { upTokenId: "tok1", downTokenId: "tok2" },
		conditionId: "cond1",
		spread: 0.04,
		...overrides,
	};
}

describe("computeMakerPrice", () => {
	it("should discount from market price using spread-based adaptive discount", () => {
		const signal = makeSignal({ marketUp: 0.5, spread: 0.04 });
		const result = computeMakerPrice(signal, makeRisk({ limitDiscount: 0.04 }));
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.price).toBe(0.48);
		}
	});

	it("should clamp discount between 0.01 and limitDiscount", () => {
		const signal = makeSignal({ marketUp: 0.5, spread: 0.005 });
		const result = computeMakerPrice(signal, makeRisk({ limitDiscount: 0.04 }));
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.price).toBe(0.49);
		}
	});

	it("should reject non-finite market price", () => {
		const signal = makeSignal({ marketUp: null });
		const result = computeMakerPrice(signal, makeRisk());
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toBe("price_not_finite");
		}
	});
});

describe("computeTakerPrice", () => {
	it("should add tolerance above market price", () => {
		const signal = makeSignal({ marketUp: 0.5, spread: 0.04 });
		const result = computeTakerPrice(signal, makeRisk());
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.price).toBe(0.53);
		}
	});

	it("should clamp tolerance between 0.01 and 0.03", () => {
		const signal = makeSignal({ marketUp: 0.5, spread: 0.005 });
		const result = computeTakerPrice(signal, makeRisk());
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.price).toBe(0.51);
		}
	});

	it("should cap taker price at 0.99", () => {
		const signal = makeSignal({ marketUp: 0.98, spread: 0.04 });
		const result = computeTakerPrice(signal, makeRisk());
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.price).toBeLessThanOrEqual(0.99);
		}
	});
});

describe("executeTrade expected PnL gate", () => {
	it("should skip paper execution when expected pnl is non-positive", async () => {
		const result = await executeTrade(makeSignal({ edgeUp: 0 }), { riskConfig: makeRisk() }, "paper");
		expect(result.success).toBe(false);
		expect(result.reason).toBe("negative_expected_pnl");
	});

	it("should apply taker fee in pnl gate for late high-confidence live trades", async () => {
		const result = await executeTrade(
			makeSignal({ phase: "LATE", strength: "GOOD", edgeUp: 0.01 }),
			{ riskConfig: makeRisk({ maxTradeSizeUsdc: 5 }) },
			"live",
		);
		expect(result.success).toBe(false);
		expect(result.reason).toBe("negative_expected_pnl");
	});
});
