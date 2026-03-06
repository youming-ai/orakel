# Orakel Optimization Plan — 5 Work Items

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 verified issues across settlement, dead code, order state, circuit breaker, and DB pruning.

**Architecture:** Incremental refactors — no new abstractions. Remove dead code, fix broken semantics, consolidate state. Each WI is independently testable.

**Tech Stack:** Bun + TypeScript + Hono + SQLite (backend), React 19 + Vite (frontend), Vitest (tests), Biome (lint)

**Execution Order:** Wave 1 (parallel: WI-2, WI-4, WI-5) → Wave 2 (WI-1) → Wave 3 (WI-3)

---

## Wave 1 — Independent Quick Wins (Parallel)

### Task 1: WI-5 — Fix DB Pruning (trivial)

**Files:**
- Modify: `src/index.ts:743-762`

**Step 1: Write the failing test**

No unit test needed — this is a structural fix (move code inside loop). Verified by reading the code.

**Step 2: Move prune block inside while loop**

Current code has the prune block at lines 743-760 OUTSIDE the `while (true)` at line 762. Move it inside, after the `shouldRunLoop` guard:

```typescript
// BEFORE (lines 743-762):
const PRUNE_INTERVAL_MS = 3_600_000;
let lastPruneMs = 0;

// Periodic DB pruning (once per hour) ← OUTSIDE LOOP — BUG
if (Date.now() - lastPruneMs >= PRUNE_INTERVAL_MS) { ... }

while (true) {
  ...
```

```typescript
// AFTER:
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
  // ... rest of loop
```

**Step 3: Run typecheck**

```bash
bun run typecheck
```

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: move DB pruning inside main loop so it runs hourly, not just at startup"
```

---

### Task 2: WI-4 — CLOB Circuit Breaker Per-Market Isolation

**Files:**
- Modify: `src/pipeline/fetch.ts:28-49, 175, 210, 213`

**Step 1: Write the failing test**

Create `src/__tests__/clobCircuitBreaker.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

// We'll test the exported helper after refactor
// For now, define the expected behavior:

describe("per-market CLOB circuit breaker", () => {
  it("should isolate failures between markets", () => {
    // BTC fails 5 times → BTC breaker open, ETH breaker closed
    // Implementation test after refactor
  });

  it("should reset on success per market", () => {
    // BTC fails 3 times, then succeeds → BTC failures = 0, doesn't affect ETH
  });

  it("should open breaker after maxFailures for specific market only", () => {
    // BTC fails 5 times → isOpen("BTC") = true, isOpen("ETH") = false
  });
});
```

**Step 2: Refactor circuit breaker to per-market Map**

Replace the module-level singleton in `src/pipeline/fetch.ts`:

```typescript
// BEFORE (lines 28-49):
const clobCircuitBreaker = {
  failures: 0,
  openUntil: 0,
  maxFailures: 5,
  cooldownMs: 60_000,
  isOpen(): boolean { ... },
  recordFailure(): void { ... },
  recordSuccess(): void { ... },
};
```

```typescript
// AFTER:
interface MarketCircuitBreaker {
  failures: number;
  openUntil: number;
}

const clobBreakers = new Map<string, MarketCircuitBreaker>();
const CLOB_CB_MAX_FAILURES = 5;
const CLOB_CB_COOLDOWN_MS = 60_000;

function getClobBreaker(marketId: string): MarketCircuitBreaker {
  let cb = clobBreakers.get(marketId);
  if (!cb) {
    cb = { failures: 0, openUntil: 0 };
    clobBreakers.set(marketId, cb);
  }
  return cb;
}

function isClobBreakerOpen(marketId: string): boolean {
  const cb = getClobBreaker(marketId);
  if (cb.failures < CLOB_CB_MAX_FAILURES) return false;
  return Date.now() < cb.openUntil;
}

function recordClobFailure(marketId: string): void {
  const cb = getClobBreaker(marketId);
  cb.failures++;
  if (cb.failures >= CLOB_CB_MAX_FAILURES) {
    cb.openUntil = Date.now() + CLOB_CB_COOLDOWN_MS;
    log.warn(`CLOB circuit breaker OPEN for ${marketId} — ${cb.failures} consecutive failures, cooldown ${CLOB_CB_COOLDOWN_MS}ms`);
  }
}

function recordClobSuccess(marketId: string): void {
  const cb = getClobBreaker(marketId);
  if (cb.failures > 0) log.info(`CLOB circuit breaker reset for ${marketId} after ${cb.failures} failures`);
  cb.failures = 0;
  cb.openUntil = 0;
}
```

**Step 3: Update call sites in fetchPolymarketSnapshot**

Around line 175: `if (clobCircuitBreaker.isOpen())` → `if (isClobBreakerOpen(marketDef.id))`
Around line 210: `clobCircuitBreaker.recordSuccess()` → `recordClobSuccess(marketDef.id)`
Around line 213: `clobCircuitBreaker.recordFailure()` → `recordClobFailure(marketDef.id)`

The `marketDef` parameter is already available — it's the first param of `fetchPolymarketSnapshot`.

**Step 4: Complete the test with real assertions**

```typescript
import { describe, expect, it, beforeEach } from "vitest";

// Extract and export for testing, or test via the module behavior
describe("per-market CLOB circuit breaker", () => {
  // Test the isolation behavior through fetchPolymarketSnapshot
  // or export the functions for direct unit testing
});
```

**Step 5: Run checks**

```bash
bun run typecheck && bun run test
```

**Step 6: Commit**

```bash
git add src/pipeline/fetch.ts src/__tests__/clobCircuitBreaker.test.ts
git commit -m "fix: isolate CLOB circuit breaker per market to prevent cross-market degradation"
```

---

### Task 3: WI-2 — Delete Dead Code

This is the largest Wave 1 task. Split into 3 sub-tasks.

#### Task 3a: Remove Pending State Dead Code

**Files:**
- Modify: `src/core/state.ts` — Remove lines 152-238 (6 vars, 12 functions)
- Modify: `src/api.ts` — Remove pending fields from /state response (lines 285-290), remove /paper/cancel route (lines 500-505)
- Modify: `src/index.ts` — Remove pending imports (lines 14-18), remove pending fields from WebSocket snapshot (lines 1035-1038)
- Modify: `web/src/components/Header.tsx` — Remove pendingStart/pendingStop props and getBotStatus logic
- Modify: `web/src/lib/api.ts` — Remove pending fields from State type (if present in state response type)

**Step 1: Remove from state.ts**

Delete these exports:
- `_paperPendingStart`, `_paperPendingStop`, `_livePendingStart`, `_livePendingStop` (variables)
- `_paperPendingSince`, `_livePendingSince` (variables)
- `isPaperPendingStart`, `setPaperPendingStart` (functions)
- `isPaperPendingStop`, `setPaperPendingStop` (functions)
- `isLivePendingStart`, `setLivePendingStart` (functions)
- `isLivePendingStop`, `setLivePendingStop` (functions)
- `getPaperPendingSince`, `getLivePendingSince` (functions)
- `clearPaperPending`, `clearLivePending` (functions)

Keep: `_paperRunning`, `_liveRunning`, `isPaperRunning`, `setPaperRunning`, `isLiveRunning`, `setLiveRunning` — but simplify their setters to remove pending-clearing logic.

Simplified setters:
```typescript
export function setPaperRunning(running: boolean): void {
  _paperRunning = running;
}
export function setLiveRunning(running: boolean): void {
  _liveRunning = running;
}
```

**Step 2: Remove from api.ts**

In `/state` response (~line 285): Remove these 4 fields:
```
paperPendingStart: isPaperPendingStart(),
paperPendingStop: isPaperPendingStop(),
livePendingStart: isLivePendingStart(),
livePendingStop: isLivePendingStop(),
paperPendingSince: null,
livePendingSince: null,
```

Remove `/paper/cancel` route (lines 500-505) — it was for cancelling pending start/stop.

**Step 3: Remove from index.ts**

Remove imports (lines 14-18):
```typescript
isLivePendingStart,
isLivePendingStop,
isPaperPendingStart,
isPaperPendingStop,
```

Remove from WebSocket snapshot (lines 1035-1038):
```typescript
paperPendingStart: isPaperPendingStart(),
paperPendingStop: isPaperPendingStop(),
livePendingStart: isLivePendingStart(),
livePendingStop: isLivePendingStop(),
```

**Step 4: Simplify Header.tsx**

Remove from `HeaderProps`:
```
paperPendingStart, paperPendingStop, livePendingStart, livePendingStop
```

Remove `BotStatus` type members "starting" and "stopping".
Simplify `getBotStatus`: just `running ? "running" : "stopped"`.
Remove `statusConfig` entries for "starting" and "stopping".
Remove `StatusIcon` cases for "starting" and "stopping".
Remove the `pendingStart`/`pendingStop` destructuring (lines 83-84).

Also update the component's caller — find where `<Header>` is used and remove the pending props being passed.

**Step 5: Run typecheck to find any remaining references**

```bash
bun run typecheck
```

Fix any TypeScript errors from removed exports/props.

**Step 6: Commit**

```bash
git add src/core/state.ts src/api.ts src/index.ts web/src/
git commit -m "refactor: remove dead pending start/stop state infrastructure (never wired to API or main loop)"
```

#### Task 3b: Remove Decision Engine Dead Fields

**Files:**
- Modify: `src/types.ts` — Remove `vigTooHigh`, `feeEstimateUp`, `feeEstimateDown` from EdgeResult; remove `blendSource`, `volImpliedUp` from TradeSignal and MarketSnapshot
- Modify: `src/engines/edge.ts` — Remove `vigTooHigh` from computeEdge return; remove `regime` input param from decide() (keep in return type)
- Modify: `src/trading/persistence.ts` — Remove `$vol_implied_up: null` and `$blend_source: "ta_only"` writes
- Modify: `src/pipeline/compute.ts` — Remove dead field propagation
- Modify: `web/src/lib/api.ts` — Remove `blendSource`, `volImpliedUp` from Market interface
- Modify: `web/src/components/MarketCard.tsx` — Remove blend source display (lines 148-152)

**Step 1: Remove from types.ts**

EdgeResult — remove:
```typescript
vigTooHigh?: boolean;
feeEstimateUp?: number;
feeEstimateDown?: number;
```

TradeSignal — remove:
```typescript
blendSource: string;
volImpliedUp: number | null;
```

MarketSnapshot — remove:
```typescript
blendSource: string | null;
volImpliedUp: number | null;
```

**Step 2: Remove from edge.ts**

In `computeEdge` return objects: Remove `vigTooHigh` property (lines 21, 41, 56).

In `decide` function signature: Remove `regime?: Regime | null` input parameter. The return type `TradeDecision` still has `regime: Regime | null` — but `decide()` no longer accepts it. Instead, the caller will set regime on the result.

Actually — simpler approach: keep `regime` in decide() params since it's passed through to output. It's not "dead" in the sense that it reaches the output; it's just not used for threshold logic. **Leave regime as-is in decide() for now — it's pass-through, not dead.**

Focus removal on: `vigTooHigh`, `feeEstimateUp/Down`, `blendSource`, `volImpliedUp`.

**Step 3: Remove from persistence.ts**

Line 141: Remove `$vol_implied_up: null,`
Line 144: Remove `$blend_source: "ta_only",`

Also update the corresponding DB `insertSignal` prepared statement in `src/core/db.ts` — remove the `vol_implied_up` and `blend_source` columns from the INSERT statement, or leave them as nullable columns not written to.

**IMPORTANT**: The `signals` table already has these columns from migrations. Don't drop columns — just stop writing to them. Remove from the INSERT statement's column list and values.

**Step 4: Remove from persistence.ts signal payload**

Lines 182-183 in the `signalPayload` object:
```typescript
blendSource: "ta_only",   // REMOVE
volImpliedUp: null,        // REMOVE
```

**Step 5: Remove from compute.ts and index.ts snapshot**

In `src/pipeline/compute.ts`: Remove `blendSource` and `volImpliedUp` from any returned objects.

In `src/index.ts` snapshot construction: Remove `blendSource` and `volImpliedUp` from MarketSnapshot object.

**Step 6: Remove from frontend**

In `web/src/lib/api.ts` Market interface: Remove `blendSource`, `volImpliedUp`.

In `web/src/components/MarketCard.tsx`: Remove the "Blend" display block (lines 148-152).

**Step 7: Run full checks**

```bash
bun run lint && bun run typecheck && bun run test
```

**Step 8: Commit**

```bash
git add src/types.ts src/engines/edge.ts src/trading/persistence.ts src/pipeline/compute.ts src/index.ts src/core/db.ts web/src/
git commit -m "refactor: remove unused decision engine fields (vigTooHigh, feeEstimate, blendSource, volImpliedUp)"
```

#### Task 3c: Remove signals table dead columns from INSERT

**Files:**
- Modify: `src/core/db.ts` — Update `insertSignal` prepared statement

**Step 1: Find and update INSERT statement**

Remove `vol_implied_up` and `blend_source` from the INSERT column list and parameter list.

**Step 2: Run typecheck + test**

```bash
bun run typecheck && bun run test
```

**Step 3: Commit**

```bash
git add src/core/db.ts
git commit -m "chore: remove dead columns from signals INSERT (vol_implied_up, blend_source)"
```

---

## Wave 2 — Settlement Truth Source

### Task 4: WI-1 — Defuse forceResolveStuckTrades

**Files:**
- Modify: `src/trading/accountStats.ts:603-650` — Change from writing losses to alarm-only
- Modify: `src/types.ts` — Add `provisional` flag to TradeEntry (PaperTradeEntry/LiveTradeEntry)
- Modify: `src/index.ts:801-806` — Update caller to handle new behavior

**Step 1: Write the failing test**

In `src/__tests__/accountStats.test.ts` (or create if needed):

```typescript
describe("forceResolveStuckTrades (alarm-only)", () => {
  it("should NOT write pnl or mark as loss for trades older than maxAge", () => {
    // Create account with a pending trade older than 1 hour
    // Call forceResolveStuckTrades
    // Assert: trade.resolved === false (still pending)
    // Assert: trade.won === undefined
    // Assert: trade.pnl === undefined
    // Assert: account.losses unchanged
    // Assert: stop-loss NOT triggered
  });

  it("should return count of stuck trades found (for alerting)", () => {
    // Create 2 pending trades older than 1 hour
    // Call forceResolveStuckTrades
    // Assert: returns 2
  });
});
```

**Step 2: Refactor forceResolveStuckTrades to alarm-only**

Rename to `detectStuckTrades` or keep name but change behavior:

```typescript
/**
 * Detect trades stuck beyond maxAgeMs. Does NOT resolve them — only
 * logs warnings and returns the count for external alerting.
 * Previously force-resolved as losses, which could cascade into
 * incorrect stop-loss triggers.
 */
forceResolveStuckTrades(maxAgeMs: number): number {
  const now = Date.now();
  let stuckCount = 0;

  for (const trade of this.state.trades) {
    if (trade.resolved) continue;
    const tradeAgeMs = now - trade.windowStartMs;
    if (tradeAgeMs <= maxAgeMs) continue;

    stuckCount++;
    this.log.warn(`Stuck trade detected: ${trade.id} (age: ${Math.round(tradeAgeMs / 60_000)}min) — NOT force-resolving`);
  }

  return stuckCount;
}
```

**Key change**: No more `trade.resolved = true`, `trade.won = false`, `trade.pnl = -(...)`, no more `checkAndTriggerStopLoss()`, no more `save()`, no DB writes.

**Step 3: Update caller in index.ts**

Lines 801-806 — change log level and message:

```typescript
const STUCK_TRADE_ALERT_AGE_MS = 60 * 60_000;
const paperStuck = paperAccount.forceResolveStuckTrades(STUCK_TRADE_ALERT_AGE_MS);
if (paperStuck > 0) log.error(`${paperStuck} stuck paper trade(s) detected (>1hr) — manual review needed`);
const liveStuck = liveAccount.forceResolveStuckTrades(STUCK_TRADE_ALERT_AGE_MS);
if (liveStuck > 0) log.error(`${liveStuck} stuck live trade(s) detected (>1hr) — manual review needed`);
```

**Step 4: Add `provisional` flag to TradeEntry types**

In `src/types.ts`, add to both `PaperTradeEntry` and `LiveTradeEntry` (if separate):

```typescript
/** True when settled via spot-price proxy during recovery, not official resolution */
provisional?: boolean;
```

**Step 5: Mark recovery settlements as provisional**

In `resolveExpiredTrades()` (accountStats.ts:574-596): Before calling `resolveTrades()`, set a flag so that trades resolved by recovery are marked provisional:

```typescript
// In resolveTrades, add parameter:
resolveTrades(windowStartMs: number, finalPrices: Map<string, number>, provisional = false): number {
  // ... existing logic ...
  // After trade.resolved = true:
  if (provisional) trade.provisional = true;
  // ...
}

// In resolveExpiredTrades:
const resolved = this.resolveTrades(windowStartMs, currentPrices, true); // ← provisional
```

**Step 6: Run tests**

```bash
bun run typecheck && bun run test
```

**Step 7: Commit**

```bash
git add src/trading/accountStats.ts src/types.ts src/index.ts
git commit -m "fix: defuse force-resolve stuck trades — alarm only, no PnL writes; mark recovery settlements as provisional"
```

---

## Wave 3 — Order State Convergence

### Task 5: WI-3 — Consolidate Order State to OrderManager + SQLite

This is the most complex task. Split into sub-tasks.

#### Task 5a: Add derived query methods to OrderManager

**Files:**
- Modify: `src/trading/orderManager.ts`

**Step 1: Add methods that replicate tracker functionality**

```typescript
/** Count of placed + filled orders in current window (replaces liveTracker.globalCount) */
countActiveInWindow(windowStartMs: number): number {
  let count = 0;
  for (const order of this.orders.values()) {
    if (Number(order.windowSlug) === windowStartMs &&
        (order.status === "placed" || order.status === "filled")) {
      count++;
    }
  }
  return count;
}

/** Check if trading is allowed globally (replaces liveTracker.canTradeGlobally) */
canTradeGlobally(maxGlobal: number, windowStartMs: number): boolean {
  return this.countActiveInWindow(windowStartMs) < maxGlobal;
}

/** Check if market already has order in window (replaces orderTracker.hasOrder) */
// Already exists: hasOrderForWindow(marketId, windowSlug)
// Already exists: totalActive()
```

**Step 2: Run typecheck**

```bash
bun run typecheck
```

**Step 3: Commit**

```bash
git add src/trading/orderManager.ts
git commit -m "feat: add derived query methods to OrderManager for tracker replacement"
```

#### Task 5b: Replace orderTracker with OrderManager queries

**Files:**
- Modify: `src/index.ts` — Remove `orderTracker` object (lines 442-483), replace all call sites

**Step 1: Find all orderTracker usages**

```bash
grep -n "orderTracker" src/index.ts
```

Replace each:
- `orderTracker.hasOrder(marketId, slug)` → `orderManager.hasOrderForWindow(marketId, slug)`
- `orderTracker.totalActive()` → `orderManager.totalActive()`
- `orderTracker.record(...)` → Already handled by `orderManager.addOrderWithTracking()`
- `orderTracker.setWindow(...)` → Remove (OrderManager handles window via windowSlug)
- `orderTracker.onCooldown()` → Keep cooldown logic as a simple local variable or remove if not needed

**Step 2: Remove orderTracker inline object**

Delete the entire `orderTracker` object definition (lines 442-483).

**Step 3: Remove orderTracker restoration from startup**

Lines 491-497: Remove the loop that restores orderTracker from pending trades (OrderManager.loadFromDb already handles this).

**Step 4: Run typecheck + test**

```bash
bun run typecheck && bun run test
```

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "refactor: replace orderTracker with OrderManager.hasOrderForWindow queries"
```

#### Task 5c: Replace liveTracker with OrderManager queries

**Files:**
- Modify: `src/index.ts` — Remove `liveTracker` (line 103), replace call sites

**Step 1: Find all liveTracker usages**

- `liveTracker.canTradeGlobally(maxGlobal)` → `orderManager.canTradeGlobally(maxGlobal, timing.startMs)`
- `liveTracker.record(marketId, windowStartMs)` → Already handled by addOrderWithTracking
- `liveTracker.setWindow(startMs)` → Remove

**Step 2: Remove liveTracker**

Delete `const liveTracker = createTradeTracker();` (line 103) and all its usages.

Also remove the `createTradeTracker` function (lines 73-100) if `paperTracker` is the only remaining user. If `paperTracker` still uses it, keep the function.

**NOTE**: `paperTracker` is used for paper trade tracking — it does NOT need OrderManager since paper trades don't go through CLOB. Keep `paperTracker` as-is.

**Step 3: Remove liveTracker restoration from startup**

Lines 498-501: Remove the loop that restores liveTracker from pending trades.

**Step 4: Run typecheck + test**

```bash
bun run typecheck && bun run test
```

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "refactor: replace liveTracker with OrderManager.canTradeGlobally queries"
```

#### Task 5d: Fix filled-order tracker cleanup bug

**Files:**
- Modify: `src/index.ts` — In onOrderStatusChange callback

**Step 1: Verify the bug**

In the `onOrderStatusChange` callback (~line 266-368): FILLED orders should trigger the same cleanup as CANCELLED/EXPIRED for the OrderManager's `hasOrderForWindow` to work correctly (filled orders should still block the window).

Actually — review the semantics: a FILLED order SHOULD block the window (you already traded in this window). So `hasOrderForWindow` checking `status === "placed" || status === "filled"` is CORRECT. The "bug" in the original orderTracker (not deleting on fill) was actually correct behavior — you don't want to re-trade in the same window.

**No code change needed here.** The OrderManager's `hasOrderForWindow` already returns true for both "placed" and "filled" status, which is the desired behavior.

**Step 2: Document this in a comment**

Add a comment in OrderManager.hasOrderForWindow explaining why filled orders still block:

```typescript
/**
 * Check if an order exists for this market+window.
 * Returns true for both "placed" and "filled" — a filled order
 * still blocks the window to prevent duplicate trades.
 */
```

**Step 3: Commit**

```bash
git add src/trading/orderManager.ts
git commit -m "docs: clarify hasOrderForWindow blocks on filled orders (intentional, prevents duplicates)"
```

---

## Final Verification

### Task 6: Full CI Check

**Step 1: Run lint**

```bash
bun run lint
```

Fix any issues.

**Step 2: Run typecheck**

```bash
bun run typecheck
```

Fix any issues.

**Step 3: Run tests**

```bash
bun run test
```

Fix any failures caused by our changes. Do NOT fix pre-existing failures.

**Step 4: Grep for dangling references**

```bash
grep -rn "pendingStart\|pendingStop\|pendingSince\|vigTooHigh\|feeEstimate\|volImpliedUp\|blendSource\|orderTracker\|liveTracker" src/ web/src/ --include="*.ts" --include="*.tsx"
```

Should return zero matches (except comments explaining removal).

**Step 5: Final commit if needed**

```bash
git add -A
git commit -m "chore: fix lint/typecheck/test issues from optimization pass"
```
