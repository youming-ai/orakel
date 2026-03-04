# Live On-Chain P&L Settlement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace live trade P&L settlement from spot-price simulation to on-chain redemption-driven truth.

**Architecture:** LiveSettler polls pending live trades, checks CLOB WS `market_resolved` events for resolution, determines win/loss by comparing tokenId to winningAssetId, redeems winning positions on-chain, and writes confirmed P&L back to AccountStatsManager. Paper mode unchanged.

**Tech Stack:** Bun + TypeScript, ethers.js (CTF contract), Polymarket CLOB WebSocket, SQLite (known_ctf_tokens), vitest for tests.

**Design doc:** `docs/plans/2026-03-04-live-onchain-pnl-design.md`

---

### Task 1: Add `resolveTradeOnchain()` to AccountStatsManager

Adds the per-trade settlement method that LiveSettler will call. Pure accounting — no on-chain interaction.

**Files:**
- Modify: `src/trading/accountStats.ts` (add method to class)
- Test: `src/__tests__/accountStats.test.ts` (new file)

**Step 1: Write the failing test**

Create `src/__tests__/accountStats.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { AccountStatsManager } from "../trading/accountStats.ts";

// AccountStatsManager reads from DB in init(), but we skip init() in tests
// to operate on in-memory state only. The constructor creates empty state.

function makeManager(initialBalance = 100): AccountStatsManager {
	// Use "paper" mode with a custom balance — avoids DB reads.
	// We're testing pure accounting logic, not persistence.
	const mgr = new AccountStatsManager("paper", initialBalance);
	return mgr;
}

function addTestTrade(
	mgr: AccountStatsManager,
	overrides: Partial<{
		marketId: string;
		windowStartMs: number;
		side: "UP" | "DOWN";
		price: number;
		size: number;
		priceToBeat: number;
		currentPriceAtEntry: number | null;
		timestamp: string;
	}> = {},
): string {
	return mgr.addTrade({
		marketId: overrides.marketId ?? "BTC",
		windowStartMs: overrides.windowStartMs ?? 1000,
		side: overrides.side ?? "UP",
		price: overrides.price ?? 0.4,
		size: overrides.size ?? 10,
		priceToBeat: overrides.priceToBeat ?? 50000,
		currentPriceAtEntry: overrides.currentPriceAtEntry ?? 50100,
		timestamp: overrides.timestamp ?? new Date().toISOString(),
	});
}

describe("resolveTradeOnchain", () => {
	it("should resolve a winning trade with given pnl", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr, { price: 0.4, size: 10 });

		// Balance after addTrade: 100 - (10 * 0.4) = 96
		expect(mgr.getBalance().current).toBeCloseTo(96, 2);

		mgr.resolveTradeOnchain(tradeId, true, 6.0, "0xabc");

		const stats = mgr.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.losses).toBe(0);
		expect(stats.totalPnl).toBeCloseTo(6.0, 2);
		// Balance: 96 + cost(4) + pnl(6) = 106
		expect(mgr.getBalance().current).toBeCloseTo(106, 2);

		const trades = mgr.getRecentTrades();
		const trade = trades.find((t) => t.id === tradeId);
		expect(trade?.resolved).toBe(true);
		expect(trade?.won).toBe(true);
		expect(trade?.pnl).toBeCloseTo(6.0, 2);
	});

	it("should resolve a losing trade with negative pnl", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr, { price: 0.4, size: 10 });

		mgr.resolveTradeOnchain(tradeId, false, -4.0, null);

		const stats = mgr.getStats();
		expect(stats.wins).toBe(0);
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeCloseTo(-4.0, 2);
		// Balance: 96 + cost(4) + pnl(-4) = 96
		expect(mgr.getBalance().current).toBeCloseTo(96, 2);
	});

	it("should throw if tradeId does not exist", () => {
		const mgr = makeManager(100);
		expect(() => mgr.resolveTradeOnchain("nonexistent", true, 5.0, null)).toThrow();
	});

	it("should throw if trade is already resolved", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr);
		mgr.resolveTradeOnchain(tradeId, true, 6.0, null);
		expect(() => mgr.resolveTradeOnchain(tradeId, false, -4.0, null)).toThrow();
	});

	it("should update daily pnl tracking", () => {
		const mgr = makeManager(100);
		const tradeId = addTestTrade(mgr, { price: 0.4, size: 10 });
		mgr.resolveTradeOnchain(tradeId, true, 6.0, null);

		const todayStats = mgr.getTodayStats();
		expect(todayStats.pnl).toBeCloseTo(6.0, 2);
		expect(todayStats.trades).toBe(1);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/accountStats.test.ts`
Expected: FAIL — `resolveTradeOnchain` is not a function.

**Step 3: Implement `resolveTradeOnchain` in AccountStatsManager**

Add to `src/trading/accountStats.ts`, inside the `AccountStatsManager` class, after the `resolveTrades` method (around line 480):

```typescript
/**
 * Resolve a single trade using on-chain confirmed data.
 * Used by LiveSettler for live trades — bypasses spot-price settlement.
 * Paper mode should continue using resolveTrades().
 */
resolveTradeOnchain(tradeId: string, won: boolean, pnl: number, txHash: string | null): void {
	const trade = this.state.trades.find((t) => t.id === tradeId);
	if (!trade) {
		throw new Error(`Trade not found: ${tradeId}`);
	}
	if (trade.resolved) {
		throw new Error(`Trade already resolved: ${tradeId}`);
	}

	trade.resolved = true;
	trade.won = won;
	trade.pnl = pnl;

	if (won) {
		this.state.wins++;
	} else {
		this.state.losses++;
	}

	// Return cost + apply pnl (same accounting as resolveTrades)
	this.state.currentBalance += trade.size * trade.price + pnl;
	const drawdown = this.state.initialBalance - this.state.currentBalance;
	if (drawdown > this.state.maxDrawdown) this.state.maxDrawdown = drawdown;
	this.state.totalPnl += pnl;

	this.updateDailyPnl(trade.id, pnl);
	this.upsertTrade(trade);
	this.syncTradeLog(trade);
	this.checkAndTriggerStopLoss();
	this.save();
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/__tests__/accountStats.test.ts`
Expected: PASS (all 5 tests).

Note: Tests use `"paper"` mode to avoid SQLite initialization issues. The method logic is mode-agnostic — it's the same class. If DB-dependent tests fail, the constructor may call DB in ways that need mocking. In that case, consider adding `{ skipInit: true }` option or using vi.mock for db.ts.

**Step 5: Run full test suite + lint + typecheck**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: All pass.

**Step 6: Commit**

```
feat(accountStats): add resolveTradeOnchain() for on-chain P&L settlement
```

---

### Task 2: Add `redeemByConditionId()` to redeemer.ts

Extract single-conditionId redemption from `redeemAll()`. Returns structured result with txHash.

**Files:**
- Modify: `src/blockchain/redeemer.ts`
- Test: `src/__tests__/redeemer.test.ts` (new file)

**Step 1: Write the failing test**

Create `src/__tests__/redeemer.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

// We test the pure logic: redeemByConditionId calls CTF contract.
// We mock ethers Contract to avoid real on-chain calls.

// Since redeemer.ts uses raw ethers imports, we test the function signature
// and error handling paths that don't require a real wallet.

describe("redeemByConditionId", () => {
	it("should be exported from redeemer module", async () => {
		// Dynamic import to check the export exists
		const mod = await import("../blockchain/redeemer.ts");
		expect(typeof mod.redeemByConditionId).toBe("function");
	});

	it("should return error for empty conditionId", async () => {
		const mod = await import("../blockchain/redeemer.ts");
		const result = await mod.redeemByConditionId(null as never, "");
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("should return error when wallet is null", async () => {
		const mod = await import("../blockchain/redeemer.ts");
		const result = await mod.redeemByConditionId(null as never, "0x1234");
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/redeemer.test.ts`
Expected: FAIL — `redeemByConditionId` is not exported.

**Step 3: Implement `redeemByConditionId`**

Add to `src/blockchain/redeemer.ts`, after the `redeemAll` function:

```typescript
export interface RedeemOneResult {
	success: boolean;
	txHash: string | null;
	error?: string;
}

export async function redeemByConditionId(
	wallet: Wallet | null,
	conditionId: string,
): Promise<RedeemOneResult> {
	if (!wallet) {
		return { success: false, txHash: null, error: "no_wallet" };
	}
	if (!conditionId || conditionId.length === 0) {
		return { success: false, txHash: null, error: "empty_condition_id" };
	}

	try {
		const ctf = new Contract(CTF_ADDRESS, CTF_ABI, wallet);

		const denominator = await ctf.payoutDenominator(conditionId);
		if (denominator.isZero()) {
			return { success: false, txHash: null, error: "not_resolved" };
		}

		const tx = await ctf.redeemPositions(
			USDC_E_ADDRESS,
			constants.HashZero,
			conditionId,
			[1, 2],
			GAS_OVERRIDES,
		);
		log.info(`Redeem tx sent: ${tx.hash} (condition: ${conditionId.slice(0, 10)}...)`);

		const receipt = await Promise.race([
			tx.wait(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("tx.wait timeout 60s")), 60_000),
			),
		]);

		if (receipt.status !== 1) {
			log.error(`Tx reverted: ${tx.hash}`);
			return { success: false, txHash: tx.hash, error: "tx_reverted" };
		}

		redeemed.add(conditionId.toLowerCase());
		log.info(`Redeemed condition: ${conditionId.slice(0, 10)}... tx: ${tx.hash}`);
		return { success: true, txHash: tx.hash };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error(`redeemByConditionId failed (${conditionId.slice(0, 10)}...):`, msg);
		return { success: false, txHash: null, error: msg };
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/__tests__/redeemer.test.ts`
Expected: PASS.

**Step 5: Run lint + typecheck**

Run: `bun run lint && bun run typecheck`
Expected: Pass.

**Step 6: Commit**

```
feat(redeemer): add redeemByConditionId() for per-trade redemption
```

---

### Task 3: Add DB helpers for tokenId / conditionId lookup

LiveSettler needs to map `(marketId, side) -> tokenId` and `tokenId -> conditionId`. Both are in `known_ctf_tokens`.

**Files:**
- Modify: `src/core/db.ts` (add prepared statements)
- Test: No new test file — these are SQL queries tested via integration in Task 5.

**Step 1: Add prepared statements to `onchainStatements`**

In `src/core/db.ts`, find the `onchainStatements` object and add:

```typescript
getCtfTokenByMarketSide: () =>
	cachedQuery(`
		SELECT * FROM known_ctf_tokens WHERE market_id = $marketId AND side = $side LIMIT 1
	`),
```

This returns the row with `token_id` and `condition_id` for a given market+side pair.

**Step 2: Run lint + typecheck**

Run: `bun run lint && bun run typecheck`
Expected: Pass.

**Step 3: Commit**

```
feat(db): add getCtfTokenByMarketSide query for LiveSettler
```

---

### Task 4: Create LiveSettler

Core module. Polls pending live trades, checks resolution via CLOB WS, redeems winners, marks losers.

**Files:**
- Create: `src/trading/liveSettler.ts`
- Test: `src/__tests__/liveSettler.test.ts` (new file)

**Step 1: Write the failing tests**

Create `src/__tests__/liveSettler.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import type { AccountStatsManager, TradeEntry } from "../trading/accountStats.ts";

// We test LiveSettler with fully mocked dependencies.
// No real DB, no real wallet, no real WebSocket.

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
		const { LiveSettler } = await import("../trading/liveSettler.ts");
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

	it("should resolve losing trade immediately when tokenId !== winningAssetId", async () => {
		const { LiveSettler } = await import("../trading/liveSettler.ts");
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockReturnValue(true),
			getWinningAssetId: vi.fn().mockReturnValue("token-down-456"), // different from UP token
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
		expect(account.resolveTradeOnchain).toHaveBeenCalledWith(
			"trade-1",
			false,
			expect.closeTo(-4.0, 2),
			null,
		);
	});

	it("should redeem and resolve winning trade when redeem succeeds", async () => {
		const { LiveSettler } = await import("../trading/liveSettler.ts");
		const clobWs = makeFakeClobWs({
			isResolved: vi.fn().mockReturnValue(true),
			getWinningAssetId: vi.fn().mockReturnValue("token-up-123"), // matches
		});
		const account = makeFakeAccount([makePendingTrade({ price: 0.4, size: 10 })]);
		const redeemFn = vi.fn().mockResolvedValue({ success: true, txHash: "0xabc" });
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: {} as never, // non-null sentinel
			lookupTokenId: () => "token-up-123",
			lookupConditionId: () => "cond-123",
			redeemFn,
		});

		const settled = await settler.settle();
		expect(settled).toBe(1);
		expect(redeemFn).toHaveBeenCalledWith({} as never, "cond-123");
		expect(account.resolveTradeOnchain).toHaveBeenCalledWith(
			"trade-1",
			true,
			expect.closeTo(6.0, 2), // size*(1-price) = 10*0.6
			"0xabc",
		);
	});

	it("should NOT resolve winning trade when redeem fails", async () => {
		const { LiveSettler } = await import("../trading/liveSettler.ts");
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
		const { LiveSettler } = await import("../trading/liveSettler.ts");
		const clobWs = makeFakeClobWs({ isResolved: vi.fn().mockReturnValue(true) });
		const account = makeFakeAccount([makePendingTrade()]);
		const settler = new LiveSettler({
			clobWs,
			liveAccount: account as unknown as AccountStatsManager,
			wallet: null,
			lookupTokenId: () => null, // no mapping
			lookupConditionId: () => null,
			redeemFn: vi.fn(),
		});

		const settled = await settler.settle();
		expect(settled).toBe(0);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/liveSettler.test.ts`
Expected: FAIL — cannot import `LiveSettler`.

**Step 3: Implement LiveSettler**

Create `src/trading/liveSettler.ts`:

```typescript
import type { Wallet } from "ethers";
import { createLogger } from "../core/logger.ts";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import type { RedeemOneResult } from "../blockchain/redeemer.ts";
import type { AccountStatsManager } from "./accountStats.ts";

const log = createLogger("live-settler");

const DEFAULT_POLL_INTERVAL_MS = 15_000;

export interface LiveSettlerDeps {
	clobWs: ClobWsHandle;
	liveAccount: AccountStatsManager;
	wallet: Wallet | null;
	/** Map (marketId, side) -> tokenId. Returns null if unknown. */
	lookupTokenId: (marketId: string, side: string) => string | null;
	/** Map tokenId -> conditionId. Returns null if unknown. */
	lookupConditionId: (tokenId: string) => string | null;
	/** Injectable redeem function (default: redeemByConditionId from redeemer.ts) */
	redeemFn: (wallet: Wallet, conditionId: string) => Promise<RedeemOneResult>;
}

export class LiveSettler {
	private deps: LiveSettlerDeps;
	private timer: ReturnType<typeof setInterval> | null = null;
	private settling = false;

	constructor(deps: LiveSettlerDeps) {
		this.deps = deps;
	}

	async settle(): Promise<number> {
		if (this.settling) return 0;
		this.settling = true;

		let settled = 0;

		try {
			const pending = this.deps.liveAccount.getPendingTrades();

			for (const trade of pending) {
				const tokenId = this.deps.lookupTokenId(trade.marketId, trade.side);
				if (!tokenId) {
					log.debug(`No tokenId mapping for ${trade.marketId}/${trade.side}, skipping`);
					continue;
				}

				if (!this.deps.clobWs.isResolved(tokenId)) {
					continue;
				}

				const winningAssetId = this.deps.clobWs.getWinningAssetId(tokenId);
				const won = tokenId === winningAssetId;

				if (won) {
					const conditionId = this.deps.lookupConditionId(tokenId);
					if (!conditionId) {
						log.warn(`No conditionId for token ${tokenId.slice(0, 12)}..., skipping redeem`);
						continue;
					}

					if (!this.deps.wallet) {
						log.warn("Cannot redeem: wallet not connected");
						continue;
					}

					const result = await this.deps.redeemFn(this.deps.wallet, conditionId);

					if (!result.success) {
						log.warn(
							`Redeem failed for ${trade.id} (${conditionId.slice(0, 10)}...): ${result.error}`,
						);
						continue; // Stay pending, retry next poll
					}

					const pnl = trade.size * (1 - trade.price);
					this.deps.liveAccount.resolveTradeOnchain(trade.id, true, pnl, result.txHash);
					log.info(
						`Settled WON: ${trade.marketId} ${trade.side} pnl=$${pnl.toFixed(2)} tx=${result.txHash}`,
					);
					settled++;
				} else {
					const pnl = -(trade.size * trade.price);
					this.deps.liveAccount.resolveTradeOnchain(trade.id, false, pnl, null);
					log.info(`Settled LOST: ${trade.marketId} ${trade.side} pnl=$${pnl.toFixed(2)}`);
					settled++;
				}
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("settle() error:", msg);
		} finally {
			this.settling = false;
		}

		return settled;
	}

	start(intervalMs?: number): void {
		if (this.timer) return;
		const ms = intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.timer = setInterval(() => {
			void this.settle();
		}, ms);
		// Run once immediately
		void this.settle();
		log.info(`LiveSettler started (poll every ${ms}ms)`);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
			log.info("LiveSettler stopped");
		}
	}

	isRunning(): boolean {
		return this.timer !== null;
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/__tests__/liveSettler.test.ts`
Expected: PASS (all 5 tests).

**Step 5: Run full suite**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: All pass.

**Step 6: Commit**

```
feat(liveSettler): create LiveSettler for on-chain trade settlement
```

---

### Task 5: Integrate LiveSettler into index.ts

Wire up LiveSettler in the main loop. Remove live `resolveTrades()` calls.

**Files:**
- Modify: `src/index.ts`

**Step 1: Add imports**

At the top of `src/index.ts`, add:

```typescript
import { LiveSettler } from "./trading/liveSettler.ts";
import { redeemByConditionId } from "./blockchain/redeemer.ts";
import { onchainStatements } from "./core/db.ts";
```

(Some of these may already be imported — deduplicate as needed.)

**Step 2: Add tokenId / conditionId lookup helpers**

Near the top of `main()`, after market initialization, add:

```typescript
function lookupTokenId(marketId: string, side: string): string | null {
	try {
		const row = onchainStatements.getCtfTokenByMarketSide().get({
			$marketId: marketId,
			$side: side,
		}) as { token_id: string } | null;
		return row?.token_id ?? null;
	} catch {
		return null;
	}
}

function lookupConditionId(tokenId: string): string | null {
	try {
		const row = onchainStatements.getCtfTokenById().get({
			$tokenId: tokenId,
		}) as { condition_id: string | null } | null;
		return row?.condition_id ?? null;
	} catch {
		return null;
	}
}
```

**Step 3: Initialize LiveSettler after wallet/CLOB WS setup**

After the CLOB WS is started and wallet is connected, create and start LiveSettler:

```typescript
let liveSettlerInstance: LiveSettler | null = null;

// Inside the block where live trading is set up:
if (isLiveRunning() && clobWsHandle) {
	liveSettlerInstance = new LiveSettler({
		clobWs: clobWsHandle,
		liveAccount,
		wallet: getWallet(),
		lookupTokenId,
		lookupConditionId,
		redeemFn: redeemByConditionId,
	});
	liveSettlerInstance.start();
}
```

Note: `clobWsHandle` refers to the existing CLOB WS instance. Trace where `startClobMarketWs()` is called in `index.ts` and use that handle. If the handle is not currently stored as a variable, extract it into one.

**Step 4: Remove live settlement from main loop**

In the main `while (true)` loop (around line 649-660), change:

```typescript
// BEFORE:
const paperRecovered = paperAccount.resolveExpiredTrades(latestPrices, CONFIG.candleWindowMinutes);
const liveRecovered = liveAccount.resolveExpiredTrades(latestPrices, CONFIG.candleWindowMinutes);

// AFTER:
const paperRecovered = paperAccount.resolveExpiredTrades(latestPrices, CONFIG.candleWindowMinutes);
// Live settlement is handled by LiveSettler — no simulated resolution
```

```typescript
// BEFORE:
const paperResolved = paperAccount.resolveTrades(prevWindowStartMs, latestPrices);
const liveResolved = liveAccount.resolveTrades(prevWindowStartMs, latestPrices);

// AFTER:
const paperResolved = paperAccount.resolveTrades(prevWindowStartMs, latestPrices);
// Live settlement is handled by LiveSettler — no simulated resolution
```

Update the log messages accordingly (remove `live=` from the log strings).

**Step 5: Stop LiveSettler on shutdown**

In the `shutdown` handler:

```typescript
if (liveSettlerInstance) {
	liveSettlerInstance.stop();
	liveSettlerInstance = null;
}
```

**Step 6: Run full suite**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: All pass.

**Step 7: Commit**

```
feat(index): integrate LiveSettler, remove live simulated settlement
```

---

### Task 6: Backfill conditionId in known_ctf_tokens

Currently `trader.ts` writes `conditionId: null`. The LiveSettler needs it for redemption.

**Files:**
- Modify: `src/trading/liveSettler.ts` (add lazy conditionId resolution)
- Modify: `src/blockchain/redeemer.ts` (export `fetchRedeemablePositions` result type)

**Step 1: Add conditionId lazy-fetch to LiveSettler**

When `lookupConditionId` returns null, LiveSettler should attempt to fetch it from Polymarket's data API via `fetchRedeemablePositions()` and backfill the DB.

Add a private method to `LiveSettler`:

```typescript
private async resolveConditionId(tokenId: string): Promise<string | null> {
	if (!this.deps.wallet) return null;
	try {
		const { fetchRedeemablePositions } = await import("../blockchain/redeemer.ts");
		const walletAddr = this.deps.wallet.address;
		const positions = await fetchRedeemablePositions(walletAddr);
		for (const pos of positions) {
			if (pos.conditionId) {
				// Backfill to DB
				try {
					onchainStatements.upsertKnownCtfToken().run({
						$tokenId: tokenId,
						$marketId: null,
						$side: null,
						$conditionId: pos.conditionId,
					});
				} catch { /* best-effort */ }
			}
		}
		// Re-check after backfill
		return this.deps.lookupConditionId(tokenId);
	} catch {
		return null;
	}
}
```

Update `settle()` to call this when conditionId is null:

```typescript
let conditionId = this.deps.lookupConditionId(tokenId);
if (!conditionId) {
	conditionId = await this.resolveConditionId(tokenId);
}
if (!conditionId) {
	log.warn(`No conditionId for token ${tokenId.slice(0, 12)}..., skipping redeem`);
	continue;
}
```

**Step 2: Run full suite**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: All pass.

**Step 3: Commit**

```
feat(liveSettler): add lazy conditionId resolution from Polymarket API
```

---

### Task 7: Add fallback for missed CLOB WS resolutions

If the WebSocket disconnects and misses `market_resolved`, pending trades could get stuck. Add a fallback timer.

**Files:**
- Modify: `src/trading/liveSettler.ts`

**Step 1: Add fallback check to `settle()`**

After the main loop over pending trades, add a fallback for trades whose window ended more than `FALLBACK_TIMEOUT_MS` ago:

```typescript
private readonly FALLBACK_TIMEOUT_MS = 10 * 60_000; // 10 minutes after window end

// In settle(), after the main loop:
const now = Date.now();
const windowMs = CONFIG.candleWindowMinutes * 60_000;

for (const trade of pending) {
	if (trade.resolved) continue;
	const windowEndMs = trade.windowStartMs + windowMs;
	if (now - windowEndMs < this.FALLBACK_TIMEOUT_MS) continue;

	const tokenId = this.deps.lookupTokenId(trade.marketId, trade.side);
	if (!tokenId) continue;

	// Already checked via WS above — this is for trades where WS missed the event
	if (this.deps.clobWs.isResolved(tokenId)) continue; // Already handled above

	log.info(`Fallback: trade ${trade.id} window ended ${Math.round((now - windowEndMs) / 60_000)}min ago, checking redeemable`);

	// Use fetchRedeemablePositions as fallback resolution check
	// If the position is redeemable → won. If not redeemable after timeout → lost.
	// This is handled in the next settle() cycle after we learn from the API.
}
```

This is intentionally conservative — the fallback just logs. Full fallback resolution (querying Polymarket REST for market status) can be added in a follow-up if needed.

**Step 2: Run full suite**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: All pass.

**Step 3: Commit**

```
feat(liveSettler): add fallback logging for stale unresolved trades
```

---

### Task 8: Final verification

**Step 1: Run full CI checks**

```bash
bun run lint && bun run typecheck && bun run test
```

Expected: All pass.

**Step 2: Verify no regressions**

- Paper mode P&L: unchanged (still uses `resolveTrades()` with spot prices)
- Live mode P&L: now driven by LiveSettler (CLOB WS `market_resolved` → redeem → pnl)
- Dashboard: unchanged (reads same `totalPnl`, `trades` fields from `AccountStatsManager`)
- Auto-redeem timer: still active as fallback
- Existing tests: all pass

**Step 3: Final commit (if any cleanup needed)**

```
chore: final cleanup for live on-chain P&L settlement
```
