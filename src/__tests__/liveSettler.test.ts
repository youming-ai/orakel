import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn().mockReturnValue(false),
		readFileSync: vi.fn().mockReturnValue("[]"),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
	},
	existsSync: vi.fn().mockReturnValue(false),
	readFileSync: vi.fn().mockReturnValue("[]"),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
}));

vi.mock("../core/db.ts", () => ({
	onchainStatements: {
		upsertKnownCtfToken: () => ({ run: vi.fn() }),
	},
}));

vi.mock("../blockchain/redeemer.ts", () => ({
	fetchRedeemablePositions: vi.fn().mockResolvedValue([]),
}));

const mockLog = vi.hoisted(() => ({
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
}));

vi.mock("../core/logger.ts", () => ({
	createLogger: () => mockLog,
}));

import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import type { AccountStatsManager, TradeEntry } from "../trading/accountStats.ts";
import { LiveSettler } from "../trading/liveSettler.ts";

function makeFakeClobWs(overrides: Partial<ClobWsHandle> = {}): ClobWsHandle {
	return {
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		getBestBidAsk: vi.fn().mockReturnValue(null),
		getTickSize: vi.fn().mockReturnValue(null),
		isResolved: vi.fn().mockReturnValue(false),
		getWinningAssetId: vi.fn().mockReturnValue(null),
		close: vi.fn(),
		...overrides,
	};
}

function makeFakeAccount(wonTrades: TradeEntry[] = []): {
	getWonTrades: () => TradeEntry[];
} {
	return {
		getWonTrades: () => wonTrades,
	};
}

/** Create a resolved + won trade (the default state LiveSettler now expects) */
function makeWonTrade(overrides: Partial<TradeEntry> = {}): TradeEntry {
	return {
		id: "trade-1",
		marketId: "BTC-15m",
		windowStartMs: 1000,
		side: "UP",
		price: 0.4,
		size: 10,
		priceToBeat: 50000,
		currentPriceAtEntry: 50100,
		timestamp: new Date().toISOString(),
		resolved: true,
		won: true,
		pnl: 6.0, // 10 * (1 - 0.4)
		settlePrice: 50100,
		...overrides,
	};
}

describe("LiveSettler.settle (redeemer-only)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should skip won trades whose tokenId is not yet resolved on-chain", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(false) });
		const account = makeFakeAccount([makeWonTrade()]);
		const redeemFn = vi.fn();
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn,
		});

		const redeemed = await settler.settle();
		expect(redeemed).toBe(0);
		expect(redeemFn).not.toHaveBeenCalled();
	});

	it("should redeem won trade when on-chain resolution is available", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(true) });
		const account = makeFakeAccount([makeWonTrade({ price: 0.4, size: 10, pnl: 6.0 })]);
		const redeemFn = vi.fn().mockResolvedValue({ success: true, txHash: "0xabc" });
		const fakeWallet = {} as never;
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: fakeWallet,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn,
		});

		const redeemed = await settler.settle();
		expect(redeemed).toBe(1);
		expect(redeemFn).toHaveBeenCalledWith(fakeWallet, "cond-123");
		expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Redeemed: BTC-15m UP"));
	});

	it("should NOT redeem when redeem call fails", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(true) });
		const account = makeFakeAccount([makeWonTrade()]);
		const redeemFn = vi.fn().mockResolvedValue({ success: false, txHash: null, error: "rpc_fail" });
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: {} as never,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn,
		});

		const redeemed = await settler.settle();
		expect(redeemed).toBe(0);
		expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Redeem failed"));
	});

	it("should skip trades with no tokenId mapping", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(true) });
		const account = makeFakeAccount([makeWonTrade()]);
		const redeemFn = vi.fn();
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => null,
			lookupConditionId: () => null,
			redeemFn,
		});

		const redeemed = await settler.settle();
		expect(redeemed).toBe(0);
		expect(redeemFn).not.toHaveBeenCalled();
	});

	it("should skip won trade when wallet is null", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(true) });
		const account = makeFakeAccount([makeWonTrade()]);
		const redeemFn = vi.fn();
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn,
		});

		const redeemed = await settler.settle();
		expect(redeemed).toBe(0);
		expect(redeemFn).not.toHaveBeenCalled();
		expect(mockLog.warn).toHaveBeenCalledWith("Cannot redeem: wallet not connected");
	});

	it("should handle multiple won trades in one settle call", async () => {
		const resolvedTokens = new Set(["token-btc-up", "token-eth-down"]);
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockImplementation((tid: string) => resolvedTokens.has(tid)),
		});
		const trades = [
			makeWonTrade({ id: "t1", marketId: "BTC-15m", side: "UP", price: 0.3, size: 10, pnl: 7.0 }),
			makeWonTrade({ id: "t2", marketId: "BTC-1h", side: "DOWN", price: 0.5, size: 10, pnl: 5.0 }),
		];
		const account = makeFakeAccount(trades);
		const redeemFn = vi.fn().mockResolvedValue({ success: true, txHash: "0x111" });
		const tokenMap: Record<string, string> = { "BTC-15m-UP": "token-btc-up", "BTC-1h-DOWN": "token-eth-down" };

		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: {} as never,
			lookupTokenId: (m, s) => tokenMap[`${m}-${s}`] ?? null,
			lookupConditionId: () => "cond-xxx",
			redeemFn,
		});

		const redeemed = await settler.settle();
		expect(redeemed).toBe(2);
		expect(redeemFn).toHaveBeenCalledTimes(2);
	});

	it("should not re-redeem already redeemed trades on subsequent calls", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(true) });
		const wonTrade = makeWonTrade();
		const account = makeFakeAccount([wonTrade]);
		const redeemFn = vi.fn().mockResolvedValue({ success: true, txHash: "0xdef" });

		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: {} as never,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn,
		});

		// First call redeems
		const first = await settler.settle();
		expect(first).toBe(1);
		expect(redeemFn).toHaveBeenCalledTimes(1);

		// Second call skips (already redeemed)
		const second = await settler.settle();
		expect(second).toBe(0);
		expect(redeemFn).toHaveBeenCalledTimes(1);
	});

	it("should return 0 when no won trades exist", async () => {
		const clobWs = makeFakeClobWs();
		const account = makeFakeAccount([]);
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => null,
			lookupConditionId: () => null,
			redeemFn: vi.fn(),
		});

		const redeemed = await settler.settle();
		expect(redeemed).toBe(0);
	});
});
