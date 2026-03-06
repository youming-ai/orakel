# Trading Flow Bugfix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 7 bugs in the trading settlement flow where DOWN trades are graded wrong, cross-timeframe trades settle prematurely, shared tracker state is corrupted by concurrent execution, and force-resolved trades lose data.

**Architecture:** All resolve methods in `AccountStatsManager` are modified to be side-aware and market-scoped. The trade tracker is extracted to a testable module with time-based pruning replacing the broken `setWindow`/`clear` pattern. `forceResolveStuckTrades` gains persistence and price-aware resolution.

**Tech Stack:** Bun + TypeScript + Vitest + Biome (tabs, double quotes, semicolons, trailing commas)

**Validation:** `bun run lint && bun run typecheck && bun run test` (284 existing tests must pass + new tests)

---

## Dependency Graph

```
Task 1 (BUG 1)─────┬──→ Task 2 (BUG 4)──┐
                    ├──→ Task 3 (BUG 2)──┤
                    └──→ Task 4 (BUG 5+6)┤
Task 5 (BUG 3)─────────────────────────→─┤
Task 6 (BUG 8)─────────────────────────→─┤
                                          └──→ Task 7 (Final Validation)
```

**Parallel Waves:**

| Wave | Tasks | Description |
|------|-------|-------------|
| 1 | Task 1, Task 5 | Independent foundations — different files |
| 2 | Task 2, Task 3, Task 4, Task 6 | Sequential — same files (accountStats.ts + index.ts) |
| 3 | Task 7 | Final validation — depends on all above |

---

## Task 1: Fix `resolveSingle` to Check `trade.side` (BUG 1 — CRITICAL)

**Files:**
- Modify: `src/trading/accountStats.ts:306-307`
- Modify: `src/__tests__/accountStats.test.ts` (enhance helper + add tests)

### Fix

```typescript
// BEFORE (line 307):
const won = settlePrice > trade.priceToBeat;

// AFTER:
const won = trade.side === "UP"
	? settlePrice > trade.priceToBeat
	: settlePrice <= trade.priceToBeat;
```

### Tests

- DOWN trade WINS when settlePrice <= priceToBeat
- DOWN trade LOSES when settlePrice > priceToBeat
- DOWN trade WINS when settlePrice equals priceToBeat (edge)
- UP trade still resolves correctly (regression)

---

## Task 2: Add `marketId` Filter to `resolveTrades` (BUG 4 — MODERATE)

**Files:**
- Modify: `src/trading/accountStats.ts:249` (add parameter)
- Modify: `src/index.ts:718,722` (pass market.id)
- Modify: `src/__tests__/accountStats.test.ts`

### Fix

```typescript
async resolveTrades(windowStartMs: number, latestPrices: Map<string, number>, marketId?: string): Promise<number> {
	for (const trade of this.state.trades) {
		if (trade.resolved || trade.windowStartMs !== windowStartMs) continue;
		if (marketId && trade.marketId !== marketId) continue;
		// ...
	}
}
```

### Tests

- Only resolves trades matching given marketId
- Backward compat: resolves all when marketId omitted

---

## Task 3: Fix `resolveExpiredTrades` Cross-Timeframe (BUG 2 — CRITICAL)

**Files:**
- Modify: `src/trading/accountStats.ts:264` (add marketId parameter)
- Modify: `src/index.ts:704,710` (pass market.id)
- Modify: `src/__tests__/accountStats.test.ts`

### Fix

```typescript
async resolveExpiredTrades(
	latestPrices: Map<string, number>,
	candleWindowMinutes: number,
	marketId?: string,
): Promise<number> {
	for (const trade of this.state.trades) {
		if (trade.resolved) continue;
		if (marketId && trade.marketId !== marketId) continue;
		// ...
	}
}
```

### Tests

- Does NOT resolve BTC-1h trade when called with 5min window + BTC-5m marketId
- DOES resolve expired BTC-5m trades when called with matching marketId
- Backward compat when marketId omitted

---

## Task 4: Fix `forceResolveStuckTrades` Persistence + Pricing (BUG 5+6)

**Files:**
- Modify: `src/trading/accountStats.ts:283-304`
- Modify: `src/index.ts:734,736`
- Modify: `src/__tests__/accountStats.test.ts`

### Fix

```typescript
async forceResolveStuckTrades(maxAgeMs: number, latestPrices?: Map<string, number>): Promise<number> {
	for (const trade of this.state.trades) {
		// ...
		const settlePrice = latestPrices?.get(trade.marketId);
		if (settlePrice !== undefined) {
			this.resolveSingle(trade, settlePrice); // Use real outcome
		} else {
			// Fallback: mark as lost
			// ... + this.persistTrade(trade);
		}
	}
	this.syncTradeLog();
	await this.save();
}
```

### Tests

- Calls persistTrade for each force-resolved trade
- Uses actual settle price when latestPrices available (UP wins)
- Uses actual settle price for DOWN trades correctly
- Falls back to loss when no prices available

---

## Task 5: Extract Trade Tracker + Fix Promise.all Corruption (BUG 3 — CRITICAL)

**Files:**
- Create: `src/core/tradeTracker.ts`
- Create: `src/__tests__/tradeTracker.test.ts`
- Modify: `src/index.ts` (import, remove inline, remove setWindow calls)

### New Module

```typescript
// src/core/tradeTracker.ts
export interface TradeTracker { has, record, prune, canTradeGlobally }
export function createTradeTracker(): TradeTracker { ... }
```

### Index.ts Changes

- Import `createTradeTracker` from new module
- Remove inline `createTradeTracker` function
- Remove `setWindow` from `SimpleOrderTracker`
- Replace `setWindow()` calls in Promise.all with `prune()` calls before Promise.all

### Tests

- Multi-market entries coexist without clearing
- Prune removes old entries by timestamp
- canTradeGlobally counts correctly after prune

---

## Task 6: Fix LiveSettler Guard (BUG 8 — LOW)

**Files:**
- Modify: `src/index.ts` (ensureLiveSettler function)

### Fix

```typescript
const hasWonTrades = liveAccount.getWonTrades().length > 0;
if (!isLiveRunning() && !hasWonTrades) return;
```

---

## Task 7: Final Validation + BUG 7 Comment

- Add explanatory comment for BUG 7 (stale price is by design)
- Run: `bun run lint && bun run typecheck && bun run test`
- Verify all 284+ tests pass
- Commit all remaining changes

---

## Summary

| Task | Bug(s) | Priority | New Tests |
|------|--------|----------|-----------|
| 1 | BUG 1 | CRITICAL | 4 |
| 2 | BUG 4 | MODERATE | 2 |
| 3 | BUG 2 | CRITICAL | 3 |
| 4 | BUG 5+6 | MODERATE | 4 |
| 5 | BUG 3 | CRITICAL | 6 |
| 6 | BUG 8 | LOW | 0 |
| 7 | BUG 7 | N/A | 0 |

**Total new tests: ~19 | Total commits: 7**
