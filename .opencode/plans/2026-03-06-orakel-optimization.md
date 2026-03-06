# Orakel Trading Bot Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Five targeted optimizations: harden settlement truth source, remove dead code, consolidate order state, isolate CLOB circuit breaker per market, and fix DB pruning scheduling.

**Architecture:** Wave-based execution — independent items (WI-2/4/5) run first in parallel, then WI-1 (settlement changes), then WI-3 (order state consolidation which depends on stable settlement). Each work item follows TDD: write failing test → implement → verify → commit.

**Tech Stack:** Bun + TypeScript + Hono + SQLite backend, React 19 + Vite frontend. Biome for lint/format, Vitest for tests.

**Validation commands:**
```bash
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
bun run test          # Vitest
```

---

## Wave 1: Independent Items (Parallel)

---

### WI-5: DB Pruning Fix (Trivial)

#### Task 5.1: Move Prune Block Inside Main Loop

**Files:**
- Modify: `src/index.ts:743-762`

This is a structural fix — the prune block at lines 747-760 is OUTSIDE the `while(true)` loop that starts at line 762. It runs once at startup, never again. No unit test is practical (it's main loop orchestration), but we verify by inspection and integration.

**Step 1: Move prune block inside the while loop**

Currently the code looks like:

```typescript
// Line 743-760: OUTSIDE loop
const PRUNE_INTERVAL_MS = 3_600_000;
let lastPruneMs = 0;

// Periodic DB pruning (once per hour)
if (Date.now() - lastPruneMs >= PRUNE_INTERVAL_MS) {
    try {
        const result = pruneDatabase();
        const total = Object.values(result.pruned).reduce((a, b) => a + b, 0);
        if (total > 0) {
            log.info("DB pruned", { ...result.pruned, vacuumed: result.vacuumed });
        }
        paperAccount.pruneTrades(500);
        liveAccount.pruneTrades(500);
    } catch (err) {
        log.warn("DB prune failed", { error: err instanceof Error ? err.message : String(err) });
    }
    lastPruneMs = Date.now();
}

while (true) {   // Line 762
    ensureOrderPolling();
    ensureOnchainPipelines();
    ...
```

Move the constant declarations (`PRUNE_INTERVAL_MS`, `lastPruneMs`) to stay where they are (before the loop), but move the `if (Date.now() - lastPruneMs ...)` block **inside** the while loop, after the sleep/continue guard (after line 770). The new structure:

```typescript
const PRUNE_INTERVAL_MS = 3_600_000;
let lastPruneMs = 0;

while (true) {
    ensureOrderPolling();
    ensureOnchainPipelines();

    const shouldRunLoop = isPaperRunning() || isLiveRunning();
    if (!shouldRunLoop) {
        await sleep(1000);
        continue;
    }

    // Periodic DB pruning (once per hour)
    if (Date.now() - lastPruneMs >= PRUNE_INTERVAL_MS) {
        try {
            const result = pruneDatabase();
            const total = Object.values(result.pruned).reduce((a, b) => a + b, 0);
            if (total > 0) {
                log.info("DB pruned", { ...result.pruned, vacuumed: result.vacuumed });
            }
            paperAccount.pruneTrades(500);
            liveAccount.pruneTrades(500);
        } catch (err) {
            log.warn("DB prune failed", { error: err instanceof Error ? err.message : String(err) });
        }
        lastPruneMs = Date.now();
    }

    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
    // ... rest of loop body unchanged
```

**Step 2: Run typecheck and lint**

Run: `bun run lint && bun run typecheck`
Expected: PASS — no type changes, only code moved.

**Step 3: Commit**

```
fix: move DB pruning inside main loop so it runs periodically
```

---

### WI-4: CLOB Circuit Breaker Isolation

#### Task 4.1: Write Failing Tests for Per-Market Circuit Breaker

**Files:**
- Create: `src/__tests__/circuitBreaker.test.ts`
- Create: `src/pipeline/circuitBreaker.ts`

**Step 1: Write failing test file**

Create `src/__tests__/circuitBreaker.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ClobCircuitBreaker } from "../pipeline/circuitBreaker.ts";

describe("ClobCircuitBreaker", () => {
	it("starts closed for all markets", () => {
		const cb = new ClobCircuitBreaker();
		expect(cb.isOpen("BTC")).toBe(false);
		expect(cb.isOpen("ETH")).toBe(false);
	});

	it("opens only the failing market after maxFailures", () => {
		const cb = new ClobCircuitBreaker({ maxFailures: 3, cooldownMs: 60_000 });
		cb.recordFailure("BTC");
		cb.recordFailure("BTC");
		cb.recordFailure("BTC");
		expect(cb.isOpen("BTC")).toBe(true);
		expect(cb.isOpen("ETH")).toBe(false);
	});

	it("does not open below maxFailures", () => {
		const cb = new ClobCircuitBreaker({ maxFailures: 5, cooldownMs: 60_000 });
		for (let i = 0; i < 4; i++) cb.recordFailure("SOL");
		expect(cb.isOpen("SOL")).toBe(false);
	});

	it("resets on success", () => {
		const cb = new ClobCircuitBreaker({ maxFailures: 3, cooldownMs: 60_000 });
		cb.recordFailure("BTC");
		cb.recordFailure("BTC");
		cb.recordSuccess("BTC");
		cb.recordFailure("BTC");
		// Only 1 failure after reset, not 3
		expect(cb.isOpen("BTC")).toBe(false);
	});

	it("closes after cooldown expires", () => {
		const cb = new ClobCircuitBreaker({ maxFailures: 1, cooldownMs: 100 });
		cb.recordFailure("BTC");
		expect(cb.isOpen("BTC")).toBe(true);
		// Simulate time passing by manipulating openUntil
		cb.setOpenUntilForTest("BTC", Date.now() - 1);
		expect(cb.isOpen("BTC")).toBe(false);
	});

	it("tracks multiple markets independently", () => {
		const cb = new ClobCircuitBreaker({ maxFailures: 2, cooldownMs: 60_000 });
		cb.recordFailure("BTC");
		cb.recordFailure("BTC");
		cb.recordFailure("ETH");
		expect(cb.isOpen("BTC")).toBe(true);
		expect(cb.isOpen("ETH")).toBe(false);
		expect(cb.isOpen("SOL")).toBe(false);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/circuitBreaker.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement ClobCircuitBreaker class**

Create `src/pipeline/circuitBreaker.ts`:

```typescript
import { createLogger } from "../core/logger.ts";

const log = createLogger("circuit-breaker");

interface MarketBreakerState {
	failures: number;
	openUntil: number;
}

interface ClobCircuitBreakerOptions {
	maxFailures?: number;
	cooldownMs?: number;
}

export class ClobCircuitBreaker {
	private readonly states = new Map<string, MarketBreakerState>();
	private readonly maxFailures: number;
	private readonly cooldownMs: number;

	constructor(options: ClobCircuitBreakerOptions = {}) {
		this.maxFailures = options.maxFailures ?? 5;
		this.cooldownMs = options.cooldownMs ?? 60_000;
	}

	private getState(marketId: string): MarketBreakerState {
		let state = this.states.get(marketId);
		if (!state) {
			state = { failures: 0, openUntil: 0 };
			this.states.set(marketId, state);
		}
		return state;
	}

	isOpen(marketId: string): boolean {
		const state = this.getState(marketId);
		if (state.failures < this.maxFailures) return false;
		return Date.now() < state.openUntil;
	}

	recordFailure(marketId: string): void {
		const state = this.getState(marketId);
		state.failures++;
		if (state.failures >= this.maxFailures) {
			state.openUntil = Date.now() + this.cooldownMs;
			log.warn(
				`CLOB circuit breaker OPEN for ${marketId} — ${state.failures} consecutive failures, cooldown ${this.cooldownMs}ms`,
			);
		}
	}

	recordSuccess(marketId: string): void {
		const state = this.getState(marketId);
		if (state.failures > 0) {
			log.info(`CLOB circuit breaker reset for ${marketId} after ${state.failures} failures`);
		}
		state.failures = 0;
		state.openUntil = 0;
	}

	/** Test helper — set openUntil for a market to simulate time passing */
	setOpenUntilForTest(marketId: string, timestamp: number): void {
		const state = this.getState(marketId);
		state.openUntil = timestamp;
	}

	/** Get the openUntil timestamp for a market (used for log messages) */
	getOpenUntil(marketId: string): number {
		return this.getState(marketId).openUntil;
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run src/__tests__/circuitBreaker.test.ts`
Expected: PASS — all 6 tests.

**Step 5: Commit**

```
feat: add per-market ClobCircuitBreaker class with tests
```

#### Task 4.2: Integrate Per-Market Circuit Breaker into fetch.ts

**Files:**
- Modify: `src/pipeline/fetch.ts:28-49,175-213`

**Step 1: Replace singleton with class instance**

In `src/pipeline/fetch.ts`:

1. Remove the entire `clobCircuitBreaker` object literal (lines 28-49).
2. Add import and instantiation:

```typescript
import { ClobCircuitBreaker } from "./circuitBreaker.ts";

const clobCircuitBreaker = new ClobCircuitBreaker();
```

3. Update the usage at line 175 — `isOpen()` now takes `marketDef.id`:

```typescript
if (clobCircuitBreaker.isOpen(marketDef.id)) {
    degraded = true;
    log.warn(
        `CLOB fetch skipped for ${marketDef.id} - circuit breaker open until ${new Date(clobCircuitBreaker.getOpenUntil(marketDef.id)).toISOString()}`,
    );
```

4. Update line 210 — `recordSuccess()` now takes `marketDef.id`:

```typescript
clobCircuitBreaker.recordSuccess(marketDef.id);
```

5. Update line 213 — `recordFailure()` now takes `marketDef.id`:

```typescript
clobCircuitBreaker.recordFailure(marketDef.id);
```

**Step 2: Run typecheck and lint**

Run: `bun run lint && bun run typecheck`
Expected: PASS.

**Step 3: Run all tests**

Run: `bun run test`
Expected: PASS — no other code references `clobCircuitBreaker` directly.

**Step 4: Commit**

```
refactor: isolate CLOB circuit breaker per market
```

---

### WI-2: Delete Dead Code

This is the largest Wave 1 item. We do it in phases: types first (to get compiler errors), then implementation, then frontend cleanup.

#### Task 2.1: Remove Dead EdgeResult Fields

**Files:**
- Modify: `src/types.ts:111-113`
- Modify: `src/engines/edge.ts:21,41,56`

**Step 1: Remove fields from EdgeResult interface**

In `src/types.ts`, remove lines 111-113:
```typescript
// REMOVE these three lines:
	vigTooHigh?: boolean;
	feeEstimateUp?: number;
	feeEstimateDown?: number;
```

The interface becomes:
```typescript
export interface EdgeResult {
	marketUp: number | null;
	marketDown: number | null;
	edgeUp: number | null;
	edgeDown: number | null;
	rawSum: number | null;
	arbitrage: boolean;
	overpriced: boolean;
}
```

**Step 2: Remove vigTooHigh from edge.ts return values**

In `src/engines/edge.ts`, remove `vigTooHigh` from the three return objects:

- Line 21: remove `vigTooHigh: false,`
- Line 41: remove `vigTooHigh: overpriced,`
- Line 56: remove `vigTooHigh: overpriced,`

**Step 3: Run typecheck to find remaining references**

Run: `bun run typecheck 2>&1 | head -30`
Expected: PASS or only errors from fields we plan to remove in later steps.

**Step 4: Run tests**

Run: `bun run test`
Expected: PASS — edge.test.ts does not assert on vigTooHigh.

**Step 5: Commit**

```
chore: remove dead EdgeResult fields (vigTooHigh, feeEstimateUp, feeEstimateDown)
```

#### Task 2.2: Remove Dead blendSource and volImpliedUp Fields

**Files:**
- Modify: `src/types.ts:225-226` (TradeSignal)
- Modify: `src/types.ts:329-330` (MarketSnapshot)
- Modify: `src/trading/persistence.ts:182-183`
- Modify: `src/pipeline/processMarket.ts:46-47,147-148`
- Modify: `src/index.ts:1023-1024`

**Step 1: Remove from TradeSignal interface**

In `src/types.ts`, remove from TradeSignal (lines 225-226):
```typescript
// REMOVE:
	blendSource: string;
	volImpliedUp: number | null;
```

**Step 2: Remove from MarketSnapshot interface**

In `src/types.ts`, remove from MarketSnapshot (lines 329-330):
```typescript
// REMOVE:
	blendSource: string | null;
	volImpliedUp: number | null;
```

**Step 3: Remove from ProcessMarketResult**

In `src/pipeline/processMarket.ts`:
- Remove lines 46-47 from the interface: `blendSource?: string;` and `volImpliedUp?: number | null;`
- Remove lines 147-148 from the return object: `blendSource: "ta_only",` and `volImpliedUp: null,`

**Step 4: Remove from persistence.ts signal payload**

In `src/trading/persistence.ts`, remove from the `signalPayload` object (lines 182-183):
```typescript
// REMOVE:
blendSource: "ta_only",
volImpliedUp: null,
```

**Important:** Keep the `$vol_implied_up: null` and `$blend_source: "ta_only"` in the SQLite `insertSignal()` call (lines 141,144) and the CSV write (line 117). These are DB-level concerns — the columns still exist in the DB schema, and removing them would require a DB migration. Only the TypeScript interfaces are being cleaned up.

**Step 5: Remove from index.ts snapshot**

In `src/index.ts`, remove from the market snapshot construction (lines 1023-1024):
```typescript
// REMOVE:
blendSource: r.blendSource ?? null,
volImpliedUp: r.volImpliedUp ?? null,
```

**Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS or errors in frontend types (fixed in Task 2.4).

**Step 7: Run tests**

Run: `bun run test`
Expected: PASS.

**Step 8: Commit**

```
chore: remove dead blendSource and volImpliedUp from TypeScript interfaces
```

#### Task 2.3: Remove Dead Pending State Code

**Files:**
- Modify: `src/core/state.ts:38-44,152-244`
- Modify: `src/api.ts:17-21,285-290,500-505,601-606,757-760`
- Modify: `src/index.ts:14-18,1035-1038`
- Modify: `src/types.ts:378-381` (StateSnapshotPayload)

**Step 1: Remove pending fields from StateSnapshotPayload**

In `src/types.ts`, remove from StateSnapshotPayload (lines 378-381):
```typescript
// REMOVE:
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
```

**Step 2: Remove pending state from BotState interface in state.ts**

In `src/core/state.ts`, remove from the BotState interface (lines 38-44):
```typescript
// REMOVE:
	// Cycle-aware pending start/stop states
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperPendingSince: number | null;
	livePendingSince: number | null;
```

Also remove these fields from the `getStatePayload()` function if they appear there.

**Step 3: Remove pending state variables and functions from state.ts**

In `src/core/state.ts`, remove lines 152-244 (the entire pending state section):
- Variables: `_paperPendingStart`, `_paperPendingStop`, `_livePendingStart`, `_livePendingStop`, `_paperPendingSince`, `_livePendingSince`
- Functions: `isPaperPendingStart`, `setPaperPendingStart`, `isLivePendingStart`, `setLivePendingStart`, `isPaperPendingStop`, `setPaperPendingStop`, `isLivePendingStop`, `setLivePendingStop`, `getPaperPendingSince`, `getLivePendingSince`, `clearPaperPending`, `clearLivePending`

**Step 4: Remove pending imports from index.ts**

In `src/index.ts`, remove from the import block (lines 14-18):
```typescript
// REMOVE these imports:
isLivePendingStart,
isLivePendingStop,
isPaperPendingStart,
isPaperPendingStop,
```

Remove from the WS snapshot (lines 1035-1038):
```typescript
// REMOVE:
paperPendingStart: isPaperPendingStart(),
paperPendingStop: isPaperPendingStop(),
livePendingStart: isLivePendingStart(),
livePendingStop: isLivePendingStop(),
```

**Step 5: Remove pending imports/usage from api.ts**

In `src/api.ts`, remove from import block (lines 17-21):
```typescript
// REMOVE these imports:
isLivePendingStart,
isLivePendingStop,
isPaperPendingStart,
isPaperPendingStop,
```

Remove from /state response (lines 285-290):
```typescript
// REMOVE:
paperPendingStart: isPaperPendingStart(),
paperPendingStop: isPaperPendingStop(),
livePendingStart: isLivePendingStart(),
livePendingStop: isLivePendingStop(),
paperPendingSince: null,
livePendingSince: null,
```

Remove from WebSocket snapshot (lines 757-760):
```typescript
// REMOVE:
paperPendingStart: isPaperPendingStart(),
paperPendingStop: isPaperPendingStop(),
livePendingStart: isLivePendingStart(),
livePendingStop: isLivePendingStop(),
```

Remove the `/paper/cancel` route (lines 500-505):
```typescript
// REMOVE entire route:
.post("/paper/cancel", (c) => {
    return c.json({
        ok: true as const,
        message: "Operation cancelled",
    });
})
```

Remove the `/live/cancel` route (lines 601-606):
```typescript
// REMOVE entire route:
.post("/live/cancel", (c) => {
    return c.json({
        ok: true as const,
        message: "Operation cancelled",
    });
})
```

**Step 6: Run typecheck to find remaining references**

Run: `bun run typecheck 2>&1`
Expected: Errors in frontend — proceed to Task 2.4.

**Step 7: Commit backend changes**

```
chore: remove dead pending state code from backend
```

#### Task 2.4: Remove Dead Code from Frontend

**Files:**
- Modify: `web/src/lib/api.ts:67,70,132-135,177-178`
- Modify: `web/src/lib/queries.ts:188-206`
- Modify: `web/src/App.tsx:15,31-32,42-58,97-105`
- Modify: `web/src/components/Header.tsx:10-13,23-27,70-73,83-85`
- Modify: `web/src/components/Layout.tsx:8-11`
- Modify: `web/src/components/MarketCard.tsx:149-152`

**Step 1: Remove dead fields from MarketSnapshot in api.ts**

In `web/src/lib/api.ts`, remove from MarketSnapshot interface (lines 177-178):
```typescript
// REMOVE:
	blendSource: string | null;
	volImpliedUp: number | null;
```

Remove pending fields from DashboardState (lines 132-135):
```typescript
// REMOVE:
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
```

Remove cancel API calls (lines 67,70):
```typescript
// REMOVE:
	paperCancel: () => post<{ ok: boolean }>("/paper/cancel"),
	liveCancel: () => post<{ ok: boolean }>("/live/cancel"),
```

**Step 2: Remove cancel mutations from queries.ts**

In `web/src/lib/queries.ts`, remove `usePaperCancel` (lines 188-196) and `useLiveCancel` (lines 198-206) functions entirely.

**Step 3: Remove pending/cancel logic from App.tsx**

In `web/src/App.tsx`:
- Remove imports of `usePaperCancel`, `useLiveCancel` (line 15)
- Remove `const paperCancel = usePaperCancel()` and `const liveCancel = useLiveCancel()` (lines 31-32)
- Remove both `useEffect` blocks that check `state.paperPendingStart/Stop` and `state.livePendingStart/Stop` (lines 42-58)
- Remove `paperPendingStart/Stop`, `livePendingStart/Stop` from the props passed to children (lines 97-100)
- Remove `paperCancel.isPending` and `liveCancel.isPending` from mutation pending checks (lines 104-105)

**Step 4: Remove pending props from Header.tsx**

In `web/src/components/Header.tsx`:
- Remove `paperPendingStart`, `paperPendingStop`, `livePendingStart`, `livePendingStop` from HeaderProps interface (lines 10-13)
- Simplify the `getBotStatus` function — remove pending logic, keep only: `running ? "running" : "stopped"` (lines 23-27)
- Remove destructured pending props (lines 70-73)
- Remove `pendingStart`/`pendingStop` local variables (lines 83-84)
- Update `status` to use simplified function (line 85)

Also remove the `"starting"` and `"stopping"` values from the `BotStatus` type if they are no longer used.

**Step 5: Remove pending props from Layout.tsx**

In `web/src/components/Layout.tsx`, remove pending fields from the interface (lines 8-11).

**Step 6: Remove blendSource display from MarketCard.tsx**

In `web/src/components/MarketCard.tsx`, remove the "Blend" display section (lines 149-152):
```tsx
// REMOVE this entire block:
<div className="space-y-1">
  <span className="text-[10px] uppercase text-muted-foreground font-semibold block">Blend</span>
  <span className="font-mono font-medium block truncate" title={m.blendSource ?? undefined}>
    {m.blendSource ?? "-"}
  </span>
</div>
```

**Step 7: Run frontend typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: PASS.

**Step 8: Run full validation**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS.

**Step 9: Commit**

```
chore: remove dead pending states, blendSource, volImpliedUp from frontend
```

#### Task 2.5: Remove regime Input Parameter from decide() — SKIPPED

The `regime` parameter in `decide()` at `src/engines/edge.ts:66` is passed through to the `TradeDecision` return value but never read for logic. However, it IS included in the `TradeDecision` return type and used for logging/UI/persistence. Removing it as an input parameter would require every caller to manually set `rec.regime = regimeInfo.regime` after calling `decide()`, adding complexity for no gain. **This sub-task is intentionally skipped.**

---

## Wave 2: Settlement Truth Source (WI-1)

---

### Task 1.1: Write Tests for Force-Resolve Alarm-Only Behavior

**Files:**
- Modify: `src/__tests__/accountStats.test.ts`

**Step 1: Write failing test for alarm-only force-resolve**

Add to `src/__tests__/accountStats.test.ts` a new describe block. Use the existing `makeManager` and `addTestTrade` helpers:

```typescript
describe("forceResolveStuckTrades", () => {
	it("should NOT write pnl/won/losses for stuck trades (alarm-only)", () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, {
			price: 0.4,
			size: 10,
			windowStartMs: Date.now() - 2 * 60 * 60_000, // 2 hours ago
		});

		const stuckCount = mgr.forceResolveStuckTrades(60 * 60_000); // 1 hour max age
		expect(stuckCount).toBe(1); // detected 1 stuck trade

		const stats = mgr.getStats();
		expect(stats.losses).toBe(0);
		expect(stats.wins).toBe(0);
		// Trade should remain unresolved
		const trades = mgr.getPendingTrades();
		expect(trades.length).toBe(1);
		expect(trades[0]!.resolved).toBe(false);
		expect(trades[0]!.won).toBeNull();
		expect(trades[0]!.pnl).toBeNull();
	});

	it("should not trigger stop-loss for stuck trades", () => {
		const mgr = makeManager(100);
		// Add several trades to potentially trigger stop-loss
		for (let i = 0; i < 5; i++) {
			addTestTrade(mgr, {
				price: 0.4,
				size: 10,
				windowStartMs: Date.now() - 2 * 60 * 60_000,
				marketId: `MKT${i}`,
			});
		}

		mgr.forceResolveStuckTrades(60 * 60_000);
		expect(mgr.isStopped()).toBe(false);
	});

	it("should return 0 when no trades are stuck", () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, {
			price: 0.4,
			size: 10,
			windowStartMs: Date.now() - 30 * 60_000, // 30 min ago (within threshold)
		});

		const stuckCount = mgr.forceResolveStuckTrades(60 * 60_000);
		expect(stuckCount).toBe(0);
	});

	it("should skip already-resolved trades", () => {
		const mgr = makeManager(100);
		addTestTrade(mgr, {
			price: 0.4,
			size: 10,
			windowStartMs: Date.now() - 2 * 60 * 60_000,
		});

		// Resolve the trade normally first
		const prices = new Map([["BTC", 50000]]);
		mgr.resolveTrades(mgr.getPendingTrades()[0]!.windowStartMs, prices);

		const stuckCount = mgr.forceResolveStuckTrades(60 * 60_000);
		expect(stuckCount).toBe(0);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run src/__tests__/accountStats.test.ts -t "forceResolveStuckTrades"`
Expected: FAIL — current implementation writes losses and returns resolved count.

**Step 3: Commit failing test**

```
test: add failing tests for alarm-only forceResolveStuckTrades
```

### Task 1.2: Implement Alarm-Only Force-Resolve

**Files:**
- Modify: `src/trading/accountStats.ts:603-650`
- Modify: `src/index.ts:801-806`

**Step 1: Rewrite forceResolveStuckTrades to alarm-only**

Replace the current `forceResolveStuckTrades` method (lines 603-650) with:

```typescript
/**
 * Detect trades stuck beyond maxAgeMs and log an alarm.
 * Does NOT write pnl, won, or losses to state — settlement must come
 * from an authoritative source (Polymarket resolution or proxy).
 * Returns count of stuck trades detected (for monitoring).
 */
forceResolveStuckTrades(maxAgeMs: number): number {
    const now = Date.now();
    let stuckCount = 0;

    for (const trade of this.state.trades) {
        if (trade.resolved) continue;
        const tradeAgeMs = now - trade.windowStartMs;
        if (tradeAgeMs <= maxAgeMs) continue;

        stuckCount++;
        this.log.error(
            `STUCK TRADE DETECTED: ${trade.id} (market=${trade.marketId}, age=${Math.round(tradeAgeMs / 60_000)}min, side=${trade.side}, size=${trade.size})`,
        );
    }

    return stuckCount;
}
```

Key changes from original:
- Returns count of **detected** stuck trades, but does not resolve them
- Logs `error` level (was `warn`) for better alerting
- Does NOT call `checkAndTriggerStopLoss()`
- Does NOT modify `trade.won`, `trade.pnl`, `trade.resolved`, `trade.settlePrice`
- Does NOT update `state.losses`, `state.currentBalance`, `state.maxDrawdown`, `state.totalPnl`
- Does NOT use DB transactions (no data written)

**Step 2: Update callers in index.ts**

In `src/index.ts` (lines 801-806), the return value meaning changes from "resolved count" to "stuck count". Update log messages:

```typescript
// Force-detect trades stuck beyond 1 hour — alarm only (WI-1)
const FORCE_RESOLVE_MAX_AGE_MS = 60 * 60_000;
const paperStuck = paperAccount.forceResolveStuckTrades(FORCE_RESOLVE_MAX_AGE_MS);
if (paperStuck > 0) log.error(`Detected ${paperStuck} stuck paper trade(s) — manual review required`);
const liveStuck = liveAccount.forceResolveStuckTrades(FORCE_RESOLVE_MAX_AGE_MS);
if (liveStuck > 0) log.error(`Detected ${liveStuck} stuck live trade(s) — manual review required`);
```

**Step 3: Run test to verify it passes**

Run: `bunx vitest run src/__tests__/accountStats.test.ts -t "forceResolveStuckTrades"`
Expected: PASS.

**Step 4: Run full test suite**

Run: `bun run test`
Expected: PASS — no other tests depend on forceResolve writing losses.

**Step 5: Commit**

```
fix: change forceResolveStuckTrades to alarm-only (no PnL writes, no stop-loss trigger)
```

### Task 1.3: Add Provisional Flag to Proxy-Settled Trades

**Files:**
- Modify: `src/types.ts` (PaperTradeEntry)
- Modify: `src/trading/accountStats.ts:574-596` (resolveExpiredTrades)
- Modify: `src/__tests__/accountStats.test.ts`

**Step 1: Write failing test**

Add to `src/__tests__/accountStats.test.ts`:

```typescript
describe("resolveExpiredTrades — provisional flag", () => {
	it("should mark proxy-settled trades as provisional", () => {
		const mgr = makeManager(100);
		const windowMs = 15 * 60_000;
		const windowStartMs = Date.now() - windowMs - 60_000; // ended 1 min ago

		addTestTrade(mgr, {
			price: 0.4,
			size: 10,
			windowStartMs,
		});

		const prices = new Map([["BTC", 50000]]);
		const resolved = mgr.resolveExpiredTrades(prices, 15);
		expect(resolved).toBe(1);

		const trades = mgr.getAllTrades();
		expect(trades[0]!.provisional).toBe(true);
	});

	it("should NOT mark normal window settlement trades as provisional", () => {
		const mgr = makeManager(100);
		const windowStartMs = 1000;

		addTestTrade(mgr, { price: 0.4, size: 10, windowStartMs });

		const prices = new Map([["BTC", 50000]]);
		const resolved = mgr.resolveTrades(windowStartMs, prices);
		expect(resolved).toBe(1);

		const trades = mgr.getAllTrades();
		// provisional should be undefined (not set) for normal settlements
		expect(trades[0]!.provisional).toBeUndefined();
	});
});
```

**Note:** `getAllTrades()` method — verify it exists on `AccountStatsManager`. If not, use an alternative accessor. The class has `getPendingTrades()` for unresolved — check if there's a method for all trades. If not, add it or use the state directly.

**Step 2: Run to verify failure**

Run: `bunx vitest run src/__tests__/accountStats.test.ts -t "provisional"`
Expected: FAIL — `provisional` property doesn't exist on TradeEntry.

**Step 3: Add provisional field to PaperTradeEntry**

In `src/types.ts`, add to `PaperTradeEntry` (before the closing `}`):
```typescript
	/** True if settled via spot price proxy during recovery (not official settlement) */
	provisional?: boolean;
```

Since `TradeEntry = PaperTradeEntry` (line 361), this propagates automatically.

**Step 4: Mark trades as provisional in resolveExpiredTrades**

In `src/trading/accountStats.ts`, modify `resolveExpiredTrades` (lines 574-596). After calling `this.resolveTrades()`, mark the resolved trades in that window as provisional:

```typescript
resolveExpiredTrades(currentPrices: Map<string, number>, windowMinutes: number, maxLagWindows = 2): number {
    const now = Date.now();
    const windowMs = windowMinutes * 60_000;
    let totalResolved = 0;
    const maxRecoveryLagMs = Math.max(windowMs, Math.floor(windowMs * Math.max(1, maxLagWindows)));

    const expiredWindows = new Set<number>();
    for (const trade of this.state.trades) {
        const windowEndMs = trade.windowStartMs + windowMs;
        if (trade.resolved || windowEndMs >= now) continue;
        const lagMs = now - windowEndMs;
        if (lagMs <= maxRecoveryLagMs) {
            expiredWindows.add(trade.windowStartMs);
        }
    }

    for (const windowStartMs of expiredWindows) {
        const resolved = this.resolveTrades(windowStartMs, currentPrices);
        if (resolved > 0) {
            // Mark proxy-settled trades as provisional
            for (const trade of this.state.trades) {
                if (trade.windowStartMs === windowStartMs && trade.resolved) {
                    trade.provisional = true;
                }
            }
        }
        totalResolved += resolved;
    }

    return totalResolved;
}
```

**Step 5: Add getAllTrades method if needed**

If `AccountStatsManager` doesn't have a `getAllTrades()` method, add one:

```typescript
getAllTrades(): TradeEntry[] {
    return [...this.state.trades];
}
```

**Step 6: Run test**

Run: `bunx vitest run src/__tests__/accountStats.test.ts -t "provisional"`
Expected: PASS.

**Step 7: Run full suite**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS.

**Step 8: Commit**

```
feat: add provisional flag to proxy-settled trades during recovery
```

---

## Wave 3: Order State Convergence (WI-3)

---

### Task 3.1: Write Tests for OrderManager as Single Source of Truth

**Files:**
- Modify: `src/__tests__/orderManager.test.ts`

**Step 1: Write tests for the derived query usage**

Add to `src/__tests__/orderManager.test.ts`. Use existing test infrastructure (check the file for mock patterns):

```typescript
describe("OrderManager as single order truth source", () => {
	it("hasOrderForWindow returns true for placed orders", () => {
		const mgr = createTestManager(); // Use existing factory
		mgr.addOrder({
			orderId: "ord-1",
			marketId: "BTC",
			windowSlug: "1000",
			side: "UP",
			price: 0.55,
			size: 10,
			placedAt: Date.now(),
		});
		expect(mgr.hasOrderForWindow("BTC", "1000")).toBe(true);
		expect(mgr.hasOrderForWindow("ETH", "1000")).toBe(false);
		expect(mgr.hasOrderForWindow("BTC", "2000")).toBe(false);
	});

	it("hasOrderForWindow returns true for filled orders", () => {
		const mgr = createTestManager();
		mgr.addOrder({
			orderId: "ord-1",
			marketId: "BTC",
			windowSlug: "1000",
			side: "UP",
			price: 0.55,
			size: 10,
			placedAt: Date.now(),
		});
		const order = mgr.getOrder("ord-1");
		if (order) order.status = "filled";
		expect(mgr.hasOrderForWindow("BTC", "1000")).toBe(true);
	});

	it("hasOrderForWindow returns false for cancelled orders", () => {
		const mgr = createTestManager();
		mgr.addOrder({
			orderId: "ord-1",
			marketId: "BTC",
			windowSlug: "1000",
			side: "UP",
			price: 0.55,
			size: 10,
			placedAt: Date.now(),
		});
		const order = mgr.getOrder("ord-1");
		if (order) order.status = "cancelled";
		expect(mgr.hasOrderForWindow("BTC", "1000")).toBe(false);
	});

	it("totalActive counts placed + filled, excludes cancelled", () => {
		const mgr = createTestManager();
		mgr.addOrder({
			orderId: "ord-1",
			marketId: "BTC",
			windowSlug: "1000",
			side: "UP",
			price: 0.55,
			size: 10,
			placedAt: Date.now(),
		});
		mgr.addOrder({
			orderId: "ord-2",
			marketId: "ETH",
			windowSlug: "1000",
			side: "DOWN",
			price: 0.45,
			size: 10,
			placedAt: Date.now(),
		});
		expect(mgr.totalActive()).toBe(2);

		const order = mgr.getOrder("ord-1");
		if (order) order.status = "cancelled";
		expect(mgr.totalActive()).toBe(1);
	});
});
```

**Note:** Adapt `createTestManager` to whatever factory pattern exists in the current `orderManager.test.ts`. The key is mocking `statements.getAllLivePendingOrders` and `statements.upsertLivePendingOrder`.

**Step 2: Run to verify these pass (they test existing behavior)**

Run: `bunx vitest run src/__tests__/orderManager.test.ts -t "single order truth"`
Expected: PASS — these test existing functionality.

**Step 3: Commit**

```
test: add tests for OrderManager as single source of truth for order dedup
```

### Task 3.2: Replace orderTracker with OrderManager Queries

**Files:**
- Modify: `src/index.ts`
- Modify: `src/types.ts` (remove OrderTracker interface if unused)

This is the most invasive change. The `orderTracker` object (lines 442-483) is used for:
1. **Window dedup** — `orderTracker.hasOrder(marketId, windowSlug)` to prevent duplicate orders
2. **Total count** — `orderTracker.totalActive()` for global limit
3. **Cooldown** — `orderTracker.onCooldown()` (cooldownMs is always 0, effectively unused)

All can be derived from `orderManager`.

**Step 1: Remove SimpleOrderTracker interface and orderTracker object**

In `src/index.ts`:
- Remove `SimpleOrderTracker` interface (lines 58-71)
- Remove `orderTracker` object literal (lines 442-483)

In `src/types.ts`:
- Remove `OrderTracker` interface (lines 248-258) if it exists and is unused elsewhere

**Step 2: Replace all orderTracker usages**

Search for every `orderTracker.` reference in `src/index.ts` and replace:

| Old call | New call | Notes |
|----------|----------|-------|
| `orderTracker.hasOrder(marketId, windowSlug)` | `orderManager.hasOrderForWindow(marketId, windowSlug)` | Window dedup |
| `orderTracker.totalActive()` | `orderManager.totalActive()` | Global limit |
| `orderTracker.record(marketId, windowKey, ...)` | *(remove)* | OrderManager records on `addOrder`/`addOrderWithTracking` |
| `orderTracker.setWindow(timing.startMs)` | *(remove)* | OrderManager tracks by orderId |
| `orderTracker.orders.delete(...)` | *(remove)* | OrderManager handles status internally |
| `orderTracker.prune()` | *(remove)* | OrderManager has its own `prune()` |
| `orderTracker.onCooldown()` | *(remove)* | cooldownMs was always 0 |
| `orderTracker.keyFor(...)` | *(remove)* | Internal helper |

**Step 3: Remove orderTracker from recovery path (lines 485-508)**

The first recovery loop (lines 485-508) restores `orderTracker` and `liveTracker` from pending trades. With `orderTracker` gone, remove the `orderTracker.record` calls. Keep the loop only if `liveTracker` is still present (it gets removed in Task 3.3).

**Step 4: Remove orderTracker from status callback**

In the `onOrderStatusChange` callback (around line 361):
```typescript
// REMOVE:
orderTracker.orders.delete(orderTracker.keyFor(order.marketId, order.windowSlug));
```

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: Fix any remaining references.

**Step 6: Run full suite**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS.

**Step 7: Commit**

```
refactor: replace orderTracker with OrderManager queries for order dedup

Also fixes known bug where FILLED orders weren't deleted from orderTracker
(only CANCELLED/EXPIRED were). OrderManager correctly tracks FILLED status
and hasOrderForWindow() returns true for filled orders.
```

### Task 3.3: Replace liveTracker with OrderManager Queries

**Files:**
- Modify: `src/index.ts`

The `liveTracker` (line 103) tracks per-window trade counts for live trading. Its key method `canTradeGlobally(n)` checks `globalCount < n`. This maps to `orderManager.totalActive() < n`.

**Note:** `paperTracker` (line 102) is for paper trades which don't go through OrderManager. Keep `paperTracker` as-is.

**Step 1: Remove liveTracker**

Remove `const liveTracker = createTradeTracker()` (line 103).

**Step 2: Replace liveTracker usages**

| Old call | New call | Notes |
|----------|----------|-------|
| `liveTracker.canTradeGlobally(n)` | `orderManager.totalActive() < n` | Invert logic (can → count < max) |
| `liveTracker.has(marketId, startMs)` | `orderManager.hasOrderForWindow(marketId, String(startMs))` | |
| `liveTracker.record(marketId, startMs)` | *(remove)* | OrderManager records on `addOrder` |
| `liveTracker.setWindow(timing.startMs)` | *(remove)* | |

**Step 3: Remove from recovery path**

Remove all `liveTracker.record` and `liveTracker.has` calls from the recovery section.

**Step 4: Clean up createTradeTracker if only paperTracker uses it**

If `paperTracker` is the only remaining user of `createTradeTracker`, keep both the factory and `paperTracker`. If neither is used, remove the factory too.

**Step 5: Run full validation**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS.

**Step 6: Commit**

```
refactor: replace liveTracker with OrderManager.totalActive() and hasOrderForWindow()
```

### Task 3.4: Simplify Recovery Path

**Files:**
- Modify: `src/index.ts:485-618`

**Step 1: Remove the first recovery loop**

Lines 485-508 restore `orderTracker` and `liveTracker` from pending trades — both trackers are now removed. Delete this entire block:

```typescript
// REMOVE lines 485-508:
const pendingLive = liveAccount.getPendingTrades();
let restoredCount = 0;
for (const trade of pendingLive) {
    // ... orderTracker.record and liveTracker.record calls
}
if (restoredCount > 0) { log.info(...) }
```

**Step 2: Clean up second recovery loop**

In the remaining recovery loop (lines 510-618), remove all `orderTracker.record` and `liveTracker.record` calls. The `orderManager.addOrderWithTracking()` call (line 595) already handles tracking.

Remove these specific lines from the filled-order handling:
```typescript
// REMOVE within filled-order section:
if (!orderTracker.hasOrder(marketId, windowKey)) {
    orderTracker.record(marketId, windowKey, ...);
}
if (windowStartMs === currentTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
    liveTracker.record(marketId, windowStartMs);
}
```

And from the placed-order handling:
```typescript
// REMOVE within placed-order section:
if (!orderTracker.hasOrder(marketId, windowKey)) {
    orderTracker.record(marketId, windowKey, ...);
}
if (windowStartMs === currentTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
    liveTracker.record(marketId, windowStartMs);
}
```

**Step 3: Run full validation**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS.

**Step 4: Commit**

```
refactor: simplify recovery path to use OrderManager only
```

---

## Final Validation

### Task F.1: Full CI Validation

**Step 1: Run complete validation**

```bash
bun run lint && bun run typecheck && bun run test
```
Expected: All pass.

**Step 2: Verify dead code removal**

```bash
# Verify no references to removed pending functions
grep -rn "isPaperPendingStart\|isPaperPendingStop\|isLivePendingStart\|isLivePendingStop" src/ web/src/

# Verify no references to removed EdgeResult fields
grep -rn "vigTooHigh\|feeEstimateUp\|feeEstimateDown" src/ web/src/

# Verify orderTracker is gone from index.ts
grep -n "orderTracker" src/index.ts

# Verify liveTracker is gone (paperTracker should still exist)
grep -n "liveTracker" src/index.ts
```

All should return zero matches.

**Step 3: Verify circuit breaker isolation**

Run: `bunx vitest run src/__tests__/circuitBreaker.test.ts`
Expected: All 6 tests pass.

**Step 4: Verify settlement changes**

Run: `bunx vitest run src/__tests__/accountStats.test.ts`
Expected: All pass, including forceResolve alarm-only and provisional tests.

---

## Appendix: File Modification Summary

| File | WI | Changes |
|------|-----|---------|
| `src/types.ts` | 2,1 | Remove vigTooHigh/feeEstimate*/blendSource/volImpliedUp from interfaces, remove pending fields from StateSnapshotPayload, remove OrderTracker interface, add `provisional?` to PaperTradeEntry |
| `src/engines/edge.ts` | 2 | Remove vigTooHigh from 3 return objects |
| `src/core/state.ts` | 2 | Remove 6 pending variables + 12 functions (lines 152-244), clean BotState interface |
| `src/api.ts` | 2 | Remove pending imports/fields, remove /paper/cancel and /live/cancel routes |
| `src/index.ts` | 2,3,5 | Remove pending imports/snapshot fields, remove orderTracker + liveTracker, move prune block inside loop, update force-resolve callers, simplify recovery |
| `src/trading/accountStats.ts` | 1 | Rewrite forceResolveStuckTrades to alarm-only, add provisional marking in resolveExpiredTrades |
| `src/trading/persistence.ts` | 2 | Remove blendSource/volImpliedUp from signal payload (keep in DB insert) |
| `src/pipeline/processMarket.ts` | 2 | Remove blendSource/volImpliedUp from interface and return |
| `src/pipeline/fetch.ts` | 4 | Replace singleton circuit breaker with ClobCircuitBreaker class instance |
| `src/pipeline/circuitBreaker.ts` | 4 | NEW — Per-market ClobCircuitBreaker class |
| `src/__tests__/circuitBreaker.test.ts` | 4 | NEW — 6 circuit breaker tests |
| `src/__tests__/accountStats.test.ts` | 1 | Add forceResolve alarm-only tests + provisional flag tests |
| `src/__tests__/orderManager.test.ts` | 3 | Add single-source-of-truth tests |
| `web/src/lib/api.ts` | 2 | Remove blendSource/volImpliedUp from MarketSnapshot, remove pending fields from DashboardState, remove cancel API methods |
| `web/src/lib/queries.ts` | 2 | Remove usePaperCancel/useLiveCancel mutations |
| `web/src/App.tsx` | 2 | Remove cancel logic, pending useEffects, and pending props |
| `web/src/components/Header.tsx` | 2 | Remove pending props and simplify getBotStatus |
| `web/src/components/Layout.tsx` | 2 | Remove pending props from interface |
| `web/src/components/MarketCard.tsx` | 2 | Remove blendSource "Blend" display section |

## Appendix: Execution Dependencies

```
Wave 1 (parallel):
  WI-5 (Task 5.1)           — DB pruning fix
  WI-4 (Tasks 4.1-4.2)      — Circuit breaker isolation
  WI-2 (Tasks 2.1-2.4)      — Dead code removal

Wave 2 (after Wave 1):
  WI-1 (Tasks 1.1-1.3)      — Settlement truth source

Wave 3 (after Wave 2):
  WI-3 (Tasks 3.1-3.4)      — Order state convergence

Final:
  Task F.1                   — Full CI validation
```
