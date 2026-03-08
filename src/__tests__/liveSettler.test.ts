import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/db.ts", () => ({}));

vi.mock("../blockchain/redeemer.ts", () => ({
	fetchRedeemablePositions: vi.fn(),
	redeemByConditionId: vi.fn(),
}));

vi.mock("../db/queries.ts", () => ({
	kvQueries: {
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue(undefined),
	},
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

import type { Wallet } from "ethers";
import { fetchRedeemablePositions, redeemByConditionId } from "../blockchain/redeemer.ts";
import { LiveSettler } from "../trading/liveSettler.ts";

function makeMockWallet(): Wallet {
	return { address: "0xtest123" } as Wallet;
}

describe("LiveSettler (simplified)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchRedeemablePositions).mockReset();
		vi.mocked(redeemByConditionId).mockReset();
	});

	it("should do nothing when wallet is null", async () => {
		const settler = new LiveSettler(null);
		const count = await settler.settle();
		expect(count).toBe(0);
		expect(fetchRedeemablePositions).not.toHaveBeenCalled();
	});

	it("should skip already redeemed positions", async () => {
		const wallet = makeMockWallet();
		vi.mocked(fetchRedeemablePositions).mockResolvedValue([
			{ conditionId: "0xabc123", redeemable: true, currentValue: 10, title: "Test Market" },
		]);
		vi.mocked(redeemByConditionId).mockResolvedValue({ success: true, txHash: "0xtx1" });

		const settler = new LiveSettler(wallet);

		// First settle
		const count1 = await settler.settle();
		expect(count1).toBe(1);
		expect(redeemByConditionId).toHaveBeenCalledTimes(1);

		// Second settle - should skip
		const count2 = await settler.settle();
		expect(count2).toBe(0);
		expect(redeemByConditionId).toHaveBeenCalledTimes(1); // still 1
	});

	it("should handle redeem failures gracefully", async () => {
		const wallet = makeMockWallet();
		vi.mocked(fetchRedeemablePositions).mockResolvedValue([
			{ conditionId: "0xfail", redeemable: true, currentValue: 10, title: "Fail Market" },
			{ conditionId: "0xsucc", redeemable: true, currentValue: 5, title: "Success Market" },
		]);
		vi.mocked(redeemByConditionId)
			.mockResolvedValueOnce({ success: false, txHash: null, error: "not_resolved" })
			.mockResolvedValueOnce({ success: true, txHash: "0xtx2" });

		const settler = new LiveSettler(wallet);
		const count = await settler.settle();

		expect(count).toBe(1);
		expect(redeemByConditionId).toHaveBeenCalledTimes(2);
	});

	it("should handle empty positions", async () => {
		const wallet = makeMockWallet();
		vi.mocked(fetchRedeemablePositions).mockResolvedValue([]);

		const settler = new LiveSettler(wallet);
		const count = await settler.settle();

		expect(count).toBe(0);
		expect(redeemByConditionId).not.toHaveBeenCalled();
	});

	it("should prevent concurrent settle calls", async () => {
		const wallet = makeMockWallet();

		vi.mocked(fetchRedeemablePositions).mockResolvedValue([
			{ conditionId: "0xslow", redeemable: true, currentValue: 10, title: "Slow Market" },
		]);
		vi.mocked(redeemByConditionId).mockResolvedValue({ success: true, txHash: "0xtx" });

		const settler = new LiveSettler(wallet);

		// Start two settle calls concurrently
		const [count1, count2] = await Promise.all([settler.settle(), settler.settle()]);

		// Only one should have run (due to running flag)
		expect(count1 + count2).toBeLessThanOrEqual(1);
	});

	it("should start and stop timer", () => {
		const settler = new LiveSettler(makeMockWallet());

		expect(settler.isRunning()).toBe(false);
		settler.start();
		expect(settler.isRunning()).toBe(true);
		settler.stop();
		expect(settler.isRunning()).toBe(false);
	});

	it("should not start twice", () => {
		const settler = new LiveSettler(makeMockWallet());

		settler.start();
		settler.start(); // second call should be no-op

		expect(settler.isRunning()).toBe(true);
		settler.stop();
	});
});
