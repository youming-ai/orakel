import { describe, expect, it } from "vitest";
import {
	applyEvent,
	enrichPosition,
	getAccountSummary,
	getAllPositions,
	getLastBlockNumber,
	getPosition,
	getUsdcBalance,
	getUsdcRaw,
	getWalletAddress,
	initAccountState,
	resetAccountState,
	updateFromSnapshot,
} from "./accountState.ts";
import type { BalanceSnapshotPayload, CtfPosition, OnChainEvent } from "./types.ts";

const WALLET = "0xAbC123";
const OTHER = "0x999";

function makeSnapshot(overrides: Partial<BalanceSnapshotPayload> = {}): BalanceSnapshotPayload {
	return {
		usdcBalance: 12.345678,
		usdcRaw: "12345678",
		positions: [
			{
				tokenId: "1001",
				balance: "4",
				marketId: "mkt-1",
				side: "UP",
			},
		],
		blockNumber: 10,
		timestamp: 1_700_000_000,
		...overrides,
	};
}

function makeUsdcEvent(overrides: Partial<OnChainEvent> = {}): OnChainEvent {
	return {
		type: "usdc_transfer",
		txHash: "0xtx-usdc",
		blockNumber: 11,
		logIndex: 0,
		from: OTHER.toLowerCase(),
		to: WALLET.toLowerCase(),
		tokenId: null,
		value: "1000000",
		timestamp: 1_700_000_100,
		...overrides,
	};
}

function makeCtfEvent(overrides: Partial<OnChainEvent> = {}): OnChainEvent {
	return {
		type: "ctf_transfer_single",
		txHash: "0xtx-ctf",
		blockNumber: 12,
		logIndex: 0,
		from: OTHER.toLowerCase(),
		to: WALLET.toLowerCase(),
		tokenId: "1001",
		value: "3",
		timestamp: 1_700_000_200,
		...overrides,
	};
}

function resetAndInit(wallet = WALLET): void {
	resetAccountState();
	initAccountState(wallet);
}

describe("initAccountState", () => {
	it("sets wallet lowercase and clears balances and positions", () => {
		resetAndInit("0xAbCdEf");

		expect(getWalletAddress()).toBe("0xabcdef");
		expect(getUsdcBalance()).toBe(0);
		expect(getUsdcRaw()).toBe("0");
		expect(getAllPositions()).toEqual([]);
		expect(getLastBlockNumber()).toBe(0);
	});

	it("re-initializing clears prior populated state", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot());
		applyEvent(makeCtfEvent({ tokenId: "2002", value: "1" }));

		initAccountState("0xDEAD");

		expect(getWalletAddress()).toBe("0xdead");
		expect(getUsdcRaw()).toBe("0");
		expect(getAllPositions()).toEqual([]);
		expect(getLastBlockNumber()).toBe(0);
	});
});

describe("resetAccountState", () => {
	it("clears everything back to empty", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot());
		enrichPosition("1001", "mkt-enriched", "DOWN");

		resetAccountState();

		expect(getWalletAddress()).toBe("");
		expect(getUsdcBalance()).toBe(0);
		expect(getUsdcRaw()).toBe("0");
		expect(getAllPositions()).toEqual([]);
		expect(getLastBlockNumber()).toBe(0);
	});
});

describe("updateFromSnapshot", () => {
	it("replaces USDC balance, raw value, and positions", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ usdcBalance: 42.5, usdcRaw: "42500000", positions: [] }));

		expect(getUsdcBalance()).toBeCloseTo(42.5, 10);
		expect(getUsdcRaw()).toBe("42500000");
		expect(getAllPositions()).toEqual([]);
		expect(getLastBlockNumber()).toBe(10);
	});

	it("filters positions with empty tokenId", () => {
		resetAndInit();
		const valid: CtfPosition = { tokenId: "2001", balance: "9", marketId: null, side: null };
		const invalid: CtfPosition = { tokenId: "", balance: "3", marketId: "mkt-x", side: "UP" };

		updateFromSnapshot(makeSnapshot({ positions: [invalid, valid] }));

		expect(getAllPositions()).toEqual([valid]);
	});

	it("replaces old positions map with latest snapshot positions", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "a", balance: "1", marketId: null, side: null }] }));
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "b", balance: "2", marketId: null, side: null }] }));

		expect(getPosition("a")).toBeNull();
		expect(getPosition("b")?.balance).toBe("2");
	});

	it("applies existing enrichment while loading snapshot", () => {
		resetAndInit();
		enrichPosition("3003", "mkt-enriched", "UP");
		updateFromSnapshot(
			makeSnapshot({
				positions: [{ tokenId: "3003", balance: "7", marketId: null, side: null }],
			}),
		);

		expect(getPosition("3003")).toEqual({ tokenId: "3003", balance: "7", marketId: "mkt-enriched", side: "UP" });
	});

	it("preserves enrichment across multiple snapshots", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "4004", balance: "5", marketId: null, side: null }] }));
		enrichPosition("4004", "mkt-4004", "DOWN");
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "4004", balance: "11", marketId: null, side: null }] }));

		expect(getPosition("4004")).toEqual({ tokenId: "4004", balance: "11", marketId: "mkt-4004", side: "DOWN" });
	});
});

describe("enrichPosition", () => {
	it("sets enrichment and applies it to an existing position", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "5005", balance: "1", marketId: null, side: null }] }));

		enrichPosition("5005", "mkt-5005", "UP");

		expect(getPosition("5005")).toEqual({ tokenId: "5005", balance: "1", marketId: "mkt-5005", side: "UP" });
	});

	it("stores enrichment for a future snapshot position", () => {
		resetAndInit();
		enrichPosition("6006", "mkt-6006", "DOWN");
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "6006", balance: "2", marketId: null, side: null }] }));

		expect(getPosition("6006")).toEqual({ tokenId: "6006", balance: "2", marketId: "mkt-6006", side: "DOWN" });
	});

	it("returns early when tokenId is empty", () => {
		resetAndInit();
		enrichPosition("", "mkt-x", "UP");
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "7007", balance: "3", marketId: null, side: null }] }));

		expect(getPosition("7007")).toEqual({ tokenId: "7007", balance: "3", marketId: null, side: null });
	});

	it("returns early when marketId is empty", () => {
		resetAndInit();
		enrichPosition("7008", "", "UP");
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "7008", balance: "4", marketId: null, side: null }] }));

		expect(getPosition("7008")).toEqual({ tokenId: "7008", balance: "4", marketId: null, side: null });
	});

	it("returns early when side is empty", () => {
		resetAndInit();
		enrichPosition("7009", "mkt-7009", "");
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "7009", balance: "5", marketId: null, side: null }] }));

		expect(getPosition("7009")).toEqual({ tokenId: "7009", balance: "5", marketId: null, side: null });
	});
});

describe("applyEvent - USDC", () => {
	it("returns early before init and does not crash", () => {
		resetAccountState();
		applyEvent(makeUsdcEvent());

		expect(getWalletAddress()).toBe("");
		expect(getUsdcRaw()).toBe("0");
		expect(getLastBlockNumber()).toBe(0);
	});

	it("increases balance on incoming transfer", () => {
		resetAndInit();
		applyEvent(makeUsdcEvent({ value: "2500000" }));

		expect(getUsdcRaw()).toBe("2500000");
		expect(getUsdcBalance()).toBeCloseTo(2.5, 10);
	});

	it("decreases balance on outgoing transfer", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ usdcBalance: 5, usdcRaw: "5000000", positions: [] }));
		applyEvent(makeUsdcEvent({ from: WALLET.toLowerCase(), to: OTHER.toLowerCase(), value: "1250000" }));

		expect(getUsdcRaw()).toBe("3750000");
		expect(getUsdcBalance()).toBeCloseTo(3.75, 10);
	});

	it("ignores non-matching wallet transfer", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ usdcBalance: 1, usdcRaw: "1000000", positions: [] }));
		applyEvent(makeUsdcEvent({ from: OTHER, to: "0x111", value: "777" }));

		expect(getUsdcRaw()).toBe("1000000");
		expect(getUsdcBalance()).toBeCloseTo(1, 10);
	});

	it("accumulates across multiple sequential USDC events", () => {
		resetAndInit();
		applyEvent(makeUsdcEvent({ value: "1000000" }));
		applyEvent(makeUsdcEvent({ value: "500000" }));
		applyEvent(makeUsdcEvent({ from: WALLET.toLowerCase(), to: OTHER.toLowerCase(), value: "250000" }));

		expect(getUsdcRaw()).toBe("1250000");
		expect(getUsdcBalance()).toBeCloseTo(1.25, 10);
	});

	it("handles underflow defensively without crashing", () => {
		resetAndInit();
		applyEvent(makeUsdcEvent({ from: WALLET.toLowerCase(), to: OTHER.toLowerCase(), value: "100" }));

		expect(getUsdcRaw()).toBe("-100");
		expect(getUsdcBalance()).toBeCloseTo(-0.0001, 10);
	});

	it("handles large raw BigInt values near safe integer limit", () => {
		resetAndInit();
		const nearMaxSafe = (BigInt(Number.MAX_SAFE_INTEGER) - 1n).toString();
		applyEvent(makeUsdcEvent({ value: nearMaxSafe }));

		expect(getUsdcRaw()).toBe(nearMaxSafe);
		expect(Number.isFinite(getUsdcBalance())).toBe(true);
	});
});

describe("applyEvent - CTF", () => {
	it("creates a position on incoming transfer", () => {
		resetAndInit();
		applyEvent(makeCtfEvent({ tokenId: "9001", value: "6" }));

		expect(getPosition("9001")).toEqual({ tokenId: "9001", balance: "6", marketId: null, side: null });
	});

	it("decreases existing position on outgoing transfer", () => {
		resetAndInit();
		updateFromSnapshot(
			makeSnapshot({ positions: [{ tokenId: "9002", balance: "10", marketId: "mkt-9002", side: "UP" }] }),
		);
		applyEvent(makeCtfEvent({ tokenId: "9002", from: WALLET.toLowerCase(), to: OTHER.toLowerCase(), value: "3" }));

		expect(getPosition("9002")).toEqual({ tokenId: "9002", balance: "7", marketId: "mkt-9002", side: "UP" });
	});

	it("removes position when outgoing balance reaches zero", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ positions: [{ tokenId: "9003", balance: "3", marketId: null, side: null }] }));
		applyEvent(makeCtfEvent({ tokenId: "9003", from: WALLET.toLowerCase(), to: OTHER.toLowerCase(), value: "3" }));

		expect(getPosition("9003")).toBeNull();
	});

	it("ignores transfer when tokenId is null", () => {
		resetAndInit();
		updateFromSnapshot(makeSnapshot({ positions: [] }));
		applyEvent(makeCtfEvent({ tokenId: null, value: "4" }));

		expect(getAllPositions()).toEqual([]);
	});

	it("applies enrichment when creating position from event", () => {
		resetAndInit();
		enrichPosition("9020", "mkt-9020", "DOWN");
		applyEvent(makeCtfEvent({ tokenId: "9020", value: "2" }));

		expect(getPosition("9020")).toEqual({ tokenId: "9020", balance: "2", marketId: "mkt-9020", side: "DOWN" });
	});
});

describe("getters and summary", () => {
	it("getAllPositions returns array values from map", () => {
		resetAndInit();
		updateFromSnapshot(
			makeSnapshot({
				positions: [
					{ tokenId: "a1", balance: "1", marketId: null, side: null },
					{ tokenId: "a2", balance: "2", marketId: "mkt-a2", side: "UP" },
				],
			}),
		);

		expect(getAllPositions()).toEqual([
			{ tokenId: "a1", balance: "1", marketId: null, side: null },
			{ tokenId: "a2", balance: "2", marketId: "mkt-a2", side: "UP" },
		]);
	});

	it("getLastBlockNumber tracks max block across events", () => {
		resetAndInit();
		applyEvent(makeUsdcEvent({ blockNumber: 40, timestamp: 1000 }));
		applyEvent(makeUsdcEvent({ blockNumber: 39, timestamp: 1001 }));
		applyEvent(makeCtfEvent({ blockNumber: 44, timestamp: 1002, tokenId: "x1", value: "1" }));

		expect(getLastBlockNumber()).toBe(44);
	});

	it("getAccountSummary returns complete state object", () => {
		resetAndInit();
		updateFromSnapshot(
			makeSnapshot({
				usdcBalance: 3.5,
				usdcRaw: "3500000",
				positions: [{ tokenId: "z1", balance: "8", marketId: "mkt-z1", side: "UP" }],
				blockNumber: 123,
				timestamp: 9_999,
			}),
		);

		const summary = getAccountSummary();

		expect(summary.walletAddress).toBe(WALLET.toLowerCase());
		expect(summary.usdcBalance).toBeCloseTo(3.5, 10);
		expect(summary.usdcRaw).toBe("3500000");
		expect(summary.positions).toEqual([{ tokenId: "z1", balance: "8", marketId: "mkt-z1", side: "UP" }]);
		expect(summary.positionCount).toBe(1);
		expect(summary.lastBlockNumber).toBe(123);
		expect(summary.lastTimestamp).toBe(9_999);
	});
});
