import { describe, expect, it, vi } from "vitest";

vi.mock("../core/db.ts", () => ({
	onchainStatements: {
		upsertKnownCtfToken: () => ({ run: vi.fn() }),
	},
}));

vi.mock("../blockchain/redeemer.ts", () => ({
	fetchRedeemablePositions: vi.fn().mockResolvedValue([]),
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

function makeFakeAccount(pending: TradeEntry[] = []): {
	getPendingTrades: () => TradeEntry[];
	resolveTradeOnchain: ReturnType<typeof vi.fn>;
} {
	return {
		getPendingTrades: () => pending,
		resolveTradeOnchain: vi.fn(),
	};
}

function makePendingTrade(overrides: Partial<TradeEntry> = {}): TradeEntry {
	return {
		id: "trade-1",
		marketId: "BTC",
		windowStartMs: 1000,
		side: "UP",
		price: 0.4,
		size: 10,
		priceToBeat: 50000,
		currentPriceAtEntry: 50100,
		timestamp: new Date().toISOString(),
		resolved: false,
		won: null,
		pnl: null,
		settlePrice: null,
		...overrides,
	};
}

describe("LiveSettler.settle", () => {
	it("should skip trades whose tokenId is not resolved", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(false) });
		const account = makeFakeAccount([makePendingTrade()]);
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn: vi.fn(),
		});

		const settled = await settler.settle();
		expect(settled).toBe(0);
		expect(account.resolveTradeOnchain).not.toHaveBeenCalled();
	});

	it("should resolve losing trade when tokenId !== winningAssetId", async () => {
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockReturnValue(true),
			getWinningAssetId: vi.fn().mockReturnValue("token-down-456"),
		});
		const account = makeFakeAccount([makePendingTrade({ price: 0.4, size: 10 })]);
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn: vi.fn(),
		});

		const settled = await settler.settle();
		expect(settled).toBe(1);
		expect(account.resolveTradeOnchain).toHaveBeenCalledWith("trade-1", false, expect.closeTo(-4.0, 2), null);
	});

	it("should redeem and resolve winning trade when redeem succeeds", async () => {
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockReturnValue(true),
			getWinningAssetId: vi.fn().mockReturnValue("token-up-123"),
		});
		const account = makeFakeAccount([makePendingTrade({ price: 0.4, size: 10 })]);
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

		const settled = await settler.settle();
		expect(settled).toBe(1);
		expect(redeemFn).toHaveBeenCalledWith(fakeWallet, "cond-123");
		expect(account.resolveTradeOnchain).toHaveBeenCalledWith("trade-1", true, expect.closeTo(6.0, 2), "0xabc");
	});

	it("should NOT resolve winning trade when redeem fails", async () => {
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockReturnValue(true),
			getWinningAssetId: vi.fn().mockReturnValue("token-up-123"),
		});
		const account = makeFakeAccount([makePendingTrade()]);
		const redeemFn = vi.fn().mockResolvedValue({ success: false, txHash: null, error: "rpc_fail" });
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: {} as never,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn,
		});

		const settled = await settler.settle();
		expect(settled).toBe(0);
		expect(account.resolveTradeOnchain).not.toHaveBeenCalled();
	});

	it("should skip trades with no tokenId mapping", async () => {
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(true) });
		const account = makeFakeAccount([makePendingTrade()]);
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => null,
			lookupConditionId: () => null,
			redeemFn: vi.fn(),
		});

		const settled = await settler.settle();
		expect(settled).toBe(0);
	});

	it("should skip winning trade when wallet is null", async () => {
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockReturnValue(true),
			getWinningAssetId: vi.fn().mockReturnValue("token-up-123"),
		});
		const account = makeFakeAccount([makePendingTrade()]);
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn: vi.fn(),
		});

		const settled = await settler.settle();
		expect(settled).toBe(0);
		expect(account.resolveTradeOnchain).not.toHaveBeenCalled();
	});

	it("should handle multiple trades in one settle call", async () => {
		const resolvedTokens = new Set(["token-btc-up", "token-eth-down"]);
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockImplementation((tid: string) => resolvedTokens.has(tid)),
			getWinningAssetId: vi.fn().mockReturnValue("token-btc-up"),
		});
		const trades = [
			makePendingTrade({ id: "t1", marketId: "BTC", side: "UP", price: 0.3, size: 10 }),
			makePendingTrade({ id: "t2", marketId: "ETH", side: "DOWN", price: 0.5, size: 10 }),
		];
		const account = makeFakeAccount(trades);
		const redeemFn = vi.fn().mockResolvedValue({ success: true, txHash: "0x111" });
		const tokenMap: Record<string, string> = { "BTC-UP": "token-btc-up", "ETH-DOWN": "token-eth-down" };

		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: {} as never,
			lookupTokenId: (m, s) => tokenMap[`${m}-${s}`] ?? null,
			lookupConditionId: () => "cond-xxx",
			redeemFn,
		});

		const settled = await settler.settle();
		expect(settled).toBe(2);
		expect(account.resolveTradeOnchain).toHaveBeenCalledTimes(2);
	});
});
