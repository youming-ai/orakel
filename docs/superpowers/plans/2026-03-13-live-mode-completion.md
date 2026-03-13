# Live Mode Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete live trading mode with CLI as source of truth, mode mutual exclusion, and independent settlement

**Architecture:** CLI-centric design where all live trading state (balance, positions, order status) comes from Polymarket CLI. Paper and Live modes are mutually exclusive with independent risk management and settlement strategies.

**Tech Stack:** TypeScript, Bun, Polymarket CLI, Hono, Drizzle ORM

**Design Spec:** `docs/superpowers/specs/2026-03-13-live-mode-completion-design.md`

---

## Prerequisites

Read before starting:
- `packages/bot/src/cli/commands.ts` - Existing CLI wrappers
- `packages/bot/src/cli/types.ts` - Type definitions
- `packages/bot/src/trading/liveTrader.ts` - Current live trade execution
- `packages/bot/src/runtime/mainLoop.ts` - Main tick processing loop
- `packages/bot/src/core/state.ts` - Trading mode state management
- `packages/bot/src/app/api/routes.ts` - API endpoints

---

## Chunk 1: Foundation - Fix Risk Config Routing

### Task 1: Fix Decision Input Risk Config

**Files:**
- Modify: `packages/bot/src/runtime/mainLoop.ts:155-167`

**Context:**
Line 161 currently hardcodes `config.risk.paper` for all decisions, which is a bug. Live mode should use `config.risk.live`.

- [ ] **Step 1: Read current mainLoop.ts around line 155-170**

```bash
cat -n packages/bot/src/runtime/mainLoop.ts | sed -n '150,175p'
```

- [ ] **Step 2: Modify decisionInput to use correct risk config**

Replace:
```typescript
const decisionInput: DecisionInput = {
  modelProbUp,
  marketProbUp,
  timeLeftSeconds: timeLeft,
  phase,
  strategy: config.strategy,
  risk: config.risk.paper,  // BUG: Always uses paper risk
  hasPositionInWindow: hasPosition,
  todayLossUsdc: paperAccount.getTodayLossUsdc(),
  openPositions: paperAccount.getPendingCount(),
  tradesInWindow,
};
```

With:
```typescript
const decisionInput: DecisionInput = {
  modelProbUp,
  marketProbUp,
  timeLeftSeconds: timeLeft,
  phase,
  strategy: config.strategy,
  risk: paperRunning ? config.risk.paper : config.risk.live,
  hasPositionInWindow: hasPosition,
  todayLossUsdc: paperRunning 
    ? paperAccount.getTodayLossUsdc() 
    : 0, // TODO: Live mode needs its own tracking
  openPositions: paperRunning 
    ? paperAccount.getPendingCount() 
    : 0, // TODO: Live mode uses getPositions()
  tradesInWindow,
};
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: Clean (may have TODO warnings which is OK)

- [ ] **Step 4: Commit**

```bash
git add packages/bot/src/runtime/mainLoop.ts
git commit -m "fix(bot): use correct risk config for paper vs live mode" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

## Chunk 2: LiveTrader Helper Functions

### Task 2: Add CLI Query Wrappers to LiveTrader

**Files:**
- Modify: `packages/bot/src/trading/liveTrader.ts`

**Context:**
Add helper functions to wrap CLI commands for balance/positions/order status queries.

- [ ] **Step 1: Add imports to liveTrader.ts**

Add at top of file:
```typescript
import { 
  getBalance, 
  getPositions, 
  getOrderStatus, 
  cancelAll 
} from "../cli/commands.ts";
```

- [ ] **Step 2: Add checkLiveReady function**

Add after imports, before `executeLiveTrade`:

```typescript
export async function checkLiveReady(
  minBalanceUsdc: number
): Promise<{ ok: boolean; error?: string }> {
  // Check balance
  const balanceResult = await getBalance();
  if (!balanceResult.ok) {
    return { ok: false, error: `Failed to get balance: ${balanceResult.error}` };
  }
  
  const balance = Number(balanceResult.data?.collateral ?? 0);
  if (balance < minBalanceUsdc) {
    return { 
      ok: false, 
      error: `Insufficient balance: ${balance.toFixed(2)} USDC (need ${minBalanceUsdc})` 
    };
  }
  
  // Check no existing positions
  const positionsResult = await getPositions();
  if (!positionsResult.ok) {
    return { ok: false, error: `Failed to get positions: ${positionsResult.error}` };
  }
  
  const positions = positionsResult.data ?? [];
  if (positions.length > 0) {
    return { 
      ok: false, 
      error: `Existing positions found: ${positions.length}. Close before starting live mode.` 
    };
  }
  
  return { ok: true };
}
```

- [ ] **Step 3: Add getLiveBalance function**

```typescript
export async function getLiveBalance(): Promise<{ ok: boolean; balance?: number; error?: string }> {
  const result = await getBalance();
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const balance = Number(result.data?.collateral ?? 0);
  return { ok: true, balance };
}
```

- [ ] **Step 4: Add hasLivePosition function**

```typescript
export async function hasLivePosition(
  upTokenId: string, 
  downTokenId: string
): Promise<{ ok: boolean; hasPosition?: boolean; error?: string }> {
  const result = await getPositions();
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  
  const positions = result.data ?? [];
  const hasPosition = positions.some(p => 
    p.asset === upTokenId || p.asset === downTokenId
  );
  
  return { ok: true, hasPosition };
}
```

- [ ] **Step 5: Add checkOrderFilled function**

```typescript
export async function checkOrderFilled(orderId: string): Promise<boolean> {
  const result = await getOrderStatus(orderId);
  if (!result.ok || !result.data) {
    return false;
  }
  return result.data.status === "FILLED" || result.data.status === "filled";
}
```

- [ ] **Step 6: Add cancelAllOrders function**

```typescript
export async function cancelAllOrders(): Promise<{ ok: boolean; error?: string }> {
  const result = await cancelAll();
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}
```

- [ ] **Step 7: Run typecheck**

```bash
bun run typecheck
```

Expected: Clean

- [ ] **Step 8: Run tests**

```bash
bun run test
```

Expected: All 61 tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/bot/src/trading/liveTrader.ts
git commit -m "feat(bot): add CLI query wrappers for live trading" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

## Chunk 3: Create LiveSettlement Module

### Task 3: Create Live Settlement Orchestrator

**Files:**
- Create: `packages/bot/src/runtime/liveSettlement.ts`

**Context:**
New module to handle live mode settlement flow: redeem → check balance → calculate PnL → update DB.

- [ ] **Step 1: Create file with imports**

```typescript
import { createLogger } from "../core/logger.ts";
import { getLiveBalance } from "../trading/liveTrader.ts";
import { runRedemption } from "./redeemer.ts";
import { settleDbTrade } from "../trading/persistence.ts";

const log = createLogger("live-settlement");

interface LiveSettlementContext {
  tradeId: number;
  orderId: string;
  entryPrice: number;
  size: number;
  side: "UP" | "DOWN";
  balanceBefore: number;
}
```

- [ ] **Step 2: Add settleLiveWindow function**

```typescript
export async function settleLiveWindow(
  ctx: LiveSettlementContext,
  settlePrice: number,
  priceToBeat: number
): Promise<{ ok: boolean; error?: string }> {
  log.info("Starting live settlement", { 
    tradeId: ctx.tradeId, 
    orderId: ctx.orderId,
    balanceBefore: ctx.balanceBefore 
  });
  
  // 1. Determine outcome from BTC price (for reference/logging)
  const won = (ctx.side === "UP" && settlePrice >= priceToBeat) ||
              (ctx.side === "DOWN" && settlePrice < priceToBeat);
  
  // 2. Redeem positions
  log.info("Redeeming positions");
  const redeemResult = await runRedemption();
  if (!redeemResult.ok) {
    log.error("Redemption failed, aborting settlement", { error: redeemResult.error });
    return { ok: false, error: `Redemption failed: ${redeemResult.error}` };
  }
  
  // 3. Query balance after redemption
  log.info("Querying post-redemption balance");
  const balanceResult = await getLiveBalance();
  if (!balanceResult.ok) {
    log.error("Failed to get balance after redemption", { error: balanceResult.error });
    // Fall back to price-based PnL
    const pnlUsdc = won 
      ? ctx.size * ((1 - ctx.entryPrice) / ctx.entryPrice)
      : -ctx.size;
    
    await settleDbTrade({
      tradeId: ctx.tradeId,
      outcome: won ? "WIN" : "LOSS",
      settleBtcPrice: settlePrice,
      pnlUsdc,
    });
    
    log.warn("Used fallback price-based PnL due to balance query failure", { pnlUsdc });
    return { ok: true };
  }
  
  const balanceAfter = balanceResult.balance!;
  
  // 4. Calculate PnL from balance change
  const pnlUsdc = balanceAfter - ctx.balanceBefore;
  
  // 5. Update DB
  await settleDbTrade({
    tradeId: ctx.tradeId,
    outcome: pnlUsdc > 0 ? "WIN" : "LOSS",
    settleBtcPrice: settlePrice,
    pnlUsdc,
  });
  
  log.info("Live settlement completed", { 
    tradeId: ctx.tradeId, 
    balanceBefore: ctx.balanceBefore,
    balanceAfter,
    pnlUsdc,
    outcome: pnlUsdc > 0 ? "WIN" : "LOSS"
  });
  
  return { ok: true };
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/bot/src/runtime/liveSettlement.ts
git commit -m "feat(bot): add live settlement orchestrator" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

## Chunk 4: Mode State Management

### Task 4: Add Mode Switching Helper

**Files:**
- Modify: `packages/bot/src/core/state.ts`

**Context:**
Add function to handle mutual exclusion when switching between paper and live modes.

- [ ] **Step 1: Read current state.ts to understand structure**

```bash
cat -n packages/bot/src/core/state.ts | head -100
```

- [ ] **Step 2: Add mode switching function**

Add after the existing request functions:

```typescript
export function clearModeState(): void {
  // Clear window-specific state when switching modes
  // This is a hook for future state cleanup
  log.info("Mode state cleared");
}

export function switchTradingMode(targetMode: "paper" | "live"): void {
  const currentPaper = isPaperRunning();
  const currentLive = isLiveRunning();
  
  if (targetMode === "live") {
    if (currentPaper) {
      log.info("Stopping paper mode to switch to live");
      requestPaperStop();
    }
    if (!currentLive) {
      requestLiveStart();
    }
  } else {
    if (currentLive) {
      log.info("Stopping live mode to switch to paper");
      requestLiveStop();
    }
    if (!currentPaper) {
      requestPaperStart();
    }
  }
  
  clearModeState();
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/bot/src/core/state.ts
git commit -m "feat(bot): add mode switching helper with mutual exclusion" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

## Chunk 5: API Routes - Pre-flight Checks

### Task 5: Update Control Start Endpoint

**Files:**
- Modify: `packages/bot/src/app/api/routes.ts:96-116`

**Context:**
Add pre-flight checks for live mode and enforce mutual exclusion.

- [ ] **Step 1: Add import for checkLiveReady**

At top of file, add to existing imports:
```typescript
import { checkLiveReady } from "../../trading/liveTrader.ts";
import { getConfig } from "../../core/config.ts";
```

- [ ] **Step 2: Modify /control/start endpoint**

Replace the existing `/control/start` handler with:

```typescript
app.post("/control/start", async (c) => {
  const body = (await c.req.json()) as ControlRequestDto;
  const config = getConfig();
  
  // Mutual exclusion: stop other mode first
  if (body.mode === "paper" && isLiveRunning()) {
    log.info("Stopping live mode to start paper mode");
    requestLiveStop();
    // Brief wait for graceful stop
    await new Promise(resolve => setTimeout(resolve, 500));
  } else if (body.mode === "live" && isPaperRunning()) {
    log.info("Stopping paper mode to start live mode");
    requestPaperStop();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Pre-flight for live mode
  if (body.mode === "live") {
    const minBalance = config.risk.live.maxTradeSizeUsdc * 2;
    const ready = await checkLiveReady(minBalance);
    if (!ready.ok) {
      log.warn("Live mode start rejected", { error: ready.error });
      return c.json({ 
        ok: false, 
        error: `Live mode not ready: ${ready.error}` 
      }, 400);
    }
    log.info("Live mode pre-flight passed");
  }
  
  // Start requested mode
  if (body.mode === "paper") {
    requestPaperStart();
  } else {
    requestLiveStart();
  }
  
  return c.json({
    ok: true,
    message: `${body.mode} trading start requested`,
    state: { paperRunning: isPaperRunning(), liveRunning: isLiveRunning() },
  });
});
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/bot/src/app/api/routes.ts
git commit -m "feat(bot): add live mode pre-flight checks and mode mutual exclusion" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

## Chunk 6: MainLoop Live Trading Integration

### Task 6: Integrate Live Trading Flow into MainLoop

**Files:**
- Modify: `packages/bot/src/runtime/mainLoop.ts`

**Context:**
Update the live trading section to use CLI queries for balance/position checks and add window-end cancel.

- [ ] **Step 1: Add imports**

Add to existing imports:
```typescript
import { 
  checkOrderFilled, 
  getLiveBalance, 
  hasLivePosition,
  cancelAllOrders 
} from "../trading/liveTrader.ts";
import { settleLiveWindow } from "./liveSettlement.ts";
```

- [ ] **Step 2: Add balance tracking for live trades**

Add near the top of `createMainLoop` function (after existing state variables):
```typescript
// Track balance before trade for settlement PnL calculation
let liveBalanceBeforeTrade: number | null = null;
```

- [ ] **Step 3: Update live trading section (around line 232)**

Find the section:
```typescript
if (liveRunning && !hasPosition) {
  const result = await executeLiveTrade(...)
```

Replace with:
```typescript
if (liveRunning && !hasPosition) {
  // Check balance via CLI
  const balanceResult = await getLiveBalance();
  if (!balanceResult.ok) {
    log.warn("Failed to get live balance, skipping trade", { error: balanceResult.error });
  } else if (balanceResult.balance! < config.risk.live.maxTradeSizeUsdc) {
    log.warn("Insufficient balance for live trade", { 
      balance: balanceResult.balance,
      required: config.risk.live.maxTradeSizeUsdc 
    });
  } else {
    // Check no existing position via CLI
    const positionResult = await hasLivePosition(marketInfo.upTokenId, marketInfo.downTokenId);
    if (!positionResult.ok) {
      log.warn("Failed to check positions, skipping trade", { error: positionResult.error });
    } else if (positionResult.hasPosition) {
      log.info("Already have position in this window (from CLI)");
    } else {
      // Execute trade
      const result = await executeLiveTrade(
        {
          tokenId,
          side,
          price: entryPrice,
          size: config.risk.live.maxTradeSizeUsdc,
          windowSlug: currentWindow.slug,
          edge: decision.edge,
        },
        config,
      );
      
      if (result.success) {
        // Store balance before for settlement
        liveBalanceBeforeTrade = balanceResult.balance!;
        
        // Brief delay then check fill status
        await new Promise(resolve => setTimeout(resolve, 1000));
        const filled = await checkOrderFilled(result.orderId!);
        
        if (!filled) {
          log.warn("Live order not filled within 1s, will cancel at window end", { 
            orderId: result.orderId 
          });
        } else {
          log.info("Live order filled", { orderId: result.orderId });
        }
        
        // Persist trade with balance snapshot
        const tradeId = await persistTrade({
          mode: "live",
          windowSlug: currentWindow.slug,
          windowStartMs: currentWindow.startMs,
          windowEndMs: currentWindow.endMs,
          side,
          price: entryPrice,
          size: config.risk.live.maxTradeSizeUsdc,
          priceToBeat,
          entryBtcPrice: priceTick.price,
          edge: decision.edge,
          modelProb: modelProbUp,
          marketProb: marketProbUp,
          phase,
          orderId: result.orderId,
        });
        
        getWindowTrades(currentWindow.slug).push({
          index: 0,
          side,
          price: entryPrice,
          size: config.risk.live.maxTradeSizeUsdc,
          tradeId,
        });
      }
    }
  }
}
```

- [ ] **Step 4: Add window-end cancel logic**

After the `advanceWindowState` call (around line 272), add:
```typescript
// Cancel unfilled orders when window is about to end
if (liveRunning && timeLeft <= 30 && currentWindow.state === "ACTIVE") {
  log.info("Window ending soon, canceling unfilled orders");
  const cancelResult = await cancelAllOrders();
  if (!cancelResult.ok) {
    log.warn("Failed to cancel orders", { error: cancelResult.error });
  }
}
```

- [ ] **Step 5: Update settlement to dispatch to liveSettlement**

Find the settlement section (around line 274-298) and modify:

```typescript
if (previousWindow && previousWindow.state !== "REDEEMED") {
  const stateBeforeAdvance = previousWindow.state;
  // Advance through all intermediate states (ACTIVE → CLOSING → SETTLED) in one tick
  let advanced = advanceWindowState(previousWindow, nowMs, true);
  while (advanced.state !== previousWindow.state) {
    previousWindow.state = advanced.state;
    advanced = advanceWindowState(previousWindow, nowMs, true);
  }
  
  if (previousWindow.state === "SETTLED" && stateBeforeAdvance !== "SETTLED") {
    const settlePrice = priceTick.price;
    const prevPriceToBeat = previousWindow.marketInfo?.priceToBeat || 0;
    const windowTrades = getWindowTrades(previousWindow.slug);
    
    for (const entry of windowTrades) {
      if (paperRunning) {
        // Paper settlement (existing)
        const won =
          (entry.side === "UP" && settlePrice >= prevPriceToBeat) ||
          (entry.side === "DOWN" && settlePrice < prevPriceToBeat);
        paperAccount.settleTrade(entry.index, won);
        if (entry.tradeId) {
          const pnl = won ? entry.size * ((1 - entry.price) / entry.price) : -entry.size;
          await settleDbTrade({
            tradeId: entry.tradeId,
            outcome: won ? "WIN" : "LOSS",
            settleBtcPrice: settlePrice,
            pnlUsdc: pnl,
          });
        }
      } else if (liveRunning && entry.tradeId && liveBalanceBeforeTrade !== null) {
        // Live settlement via CLI
        await settleLiveWindow(
          {
            tradeId: entry.tradeId,
            orderId: entry.orderId?.toString() ?? "",
            entryPrice: entry.price,
            size: entry.size,
            side: entry.side,
            balanceBefore: liveBalanceBeforeTrade,
          },
          settlePrice,
          prevPriceToBeat
        );
        // Reset for next window
        liveBalanceBeforeTrade = null;
      }
      
      if (liveRunning) await runRedemption();
    }
  }
}
```

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: Clean

- [ ] **Step 7: Run tests**

```bash
bun run test
```

Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/bot/src/runtime/mainLoop.ts
git commit -m "feat(bot): integrate CLI-centric live trading flow" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

## Chunk 7: Integration Testing

### Task 7: Add Live Mode Integration Tests

**Files:**
- Create: `packages/bot/src/__tests__/liveTrader.test.ts`

**Context:**
Add tests for the new live trading functions.

- [ ] **Step 1: Create test file with mock CLI**

```typescript
import { describe, expect, it, jest } from "bun:test";
import {
  checkLiveReady,
  getLiveBalance,
  hasLivePosition,
  checkOrderFilled,
  cancelAllOrders,
} from "../trading/liveTrader.ts";

// Mock CLI commands
jest.mock("../cli/commands.ts", () => ({
  getBalance: jest.fn(),
  getPositions: jest.fn(),
  getOrderStatus: jest.fn(),
  cancelAll: jest.fn(),
}));

import { getBalance, getPositions, getOrderStatus, cancelAll } from "../cli/commands.ts";

describe("checkLiveReady", () => {
  it("returns ok when balance sufficient and no positions", async () => {
    (getBalance as jest.Mock).mockResolvedValue({
      ok: true,
      data: { collateral: "100" },
    });
    (getPositions as jest.Mock).mockResolvedValue({
      ok: true,
      data: [],
    });
    
    const result = await checkLiveReady(50);
    expect(result.ok).toBe(true);
  });
  
  it("returns error when balance insufficient", async () => {
    (getBalance as jest.Mock).mockResolvedValue({
      ok: true,
      data: { collateral: "10" },
    });
    
    const result = await checkLiveReady(50);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Insufficient balance");
  });
  
  it("returns error when positions exist", async () => {
    (getBalance as jest.Mock).mockResolvedValue({
      ok: true,
      data: { collateral: "100" },
    });
    (getPositions as jest.Mock).mockResolvedValue({
      ok: true,
      data: [{ asset: "token123", size: "5", avgPrice: "0.5", curPrice: "0.6" }],
    });
    
    const result = await checkLiveReady(50);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Existing positions");
  });
});

describe("getLiveBalance", () => {
  it("returns balance when CLI succeeds", async () => {
    (getBalance as jest.Mock).mockResolvedValue({
      ok: true,
      data: { collateral: "75.5" },
    });
    
    const result = await getLiveBalance();
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(75.5);
  });
  
  it("returns error when CLI fails", async () => {
    (getBalance as jest.Mock).mockResolvedValue({
      ok: false,
      error: "Network timeout",
    });
    
    const result = await getLiveBalance();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Network timeout");
  });
});

describe("hasLivePosition", () => {
  it("returns true when position exists for token", async () => {
    (getPositions as jest.Mock).mockResolvedValue({
      ok: true,
      data: [
        { asset: "upToken123", size: "5", avgPrice: "0.5", curPrice: "0.6" },
      ],
    });
    
    const result = await hasLivePosition("upToken123", "downToken456");
    expect(result.ok).toBe(true);
    expect(result.hasPosition).toBe(true);
  });
  
  it("returns false when no matching position", async () => {
    (getPositions as jest.Mock).mockResolvedValue({
      ok: true,
      data: [
        { asset: "otherToken", size: "5", avgPrice: "0.5", curPrice: "0.6" },
      ],
    });
    
    const result = await hasLivePosition("upToken123", "downToken456");
    expect(result.ok).toBe(true);
    expect(result.hasPosition).toBe(false);
  });
});

describe("checkOrderFilled", () => {
  it("returns true when order status is FILLED", async () => {
    (getOrderStatus as jest.Mock).mockResolvedValue({
      ok: true,
      data: { orderID: "order123", status: "FILLED" },
    });
    
    const result = await checkOrderFilled("order123");
    expect(result).toBe(true);
  });
  
  it("returns false when order status is OPEN", async () => {
    (getOrderStatus as jest.Mock).mockResolvedValue({
      ok: true,
      data: { orderID: "order123", status: "OPEN" },
    });
    
    const result = await checkOrderFilled("order123");
    expect(result).toBe(false);
  });
  
  it("returns false when CLI fails", async () => {
    (getOrderStatus as jest.Mock).mockResolvedValue({
      ok: false,
      error: "Order not found",
    });
    
    const result = await checkOrderFilled("order123");
    expect(result).toBe(false);
  });
});

describe("cancelAllOrders", () => {
  it("returns ok when cancel succeeds", async () => {
    (cancelAll as jest.Mock).mockResolvedValue({ ok: true });
    
    const result = await cancelAllOrders();
    expect(result.ok).toBe(true);
  });
  
  it("returns error when cancel fails", async () => {
    (cancelAll as jest.Mock).mockResolvedValue({
      ok: false,
      error: "CLI timeout",
    });
    
    const result = await cancelAllOrders();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CLI timeout");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun run test
```

Expected: New tests pass (may need to adjust mocking syntax for Bun test runner)

- [ ] **Step 3: Commit**

```bash
git add packages/bot/src/__tests__/liveTrader.test.ts
git commit -m "test(bot): add live trading unit tests" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

## Final Verification

### Task 8: Full Test Suite and Lint

- [ ] **Step 1: Run all tests**

```bash
bun run test
```

Expected: All 61+ tests pass

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

Expected: Clean

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: Clean

- [ ] **Step 4: Final commit summary**

```bash
git log --oneline -10
```

Expected: See all implementation commits

---

## Summary

This plan implements:

1. ✅ **CLI-centric architecture**: All live trading state from CLI queries
2. ✅ **Mode mutual exclusion**: Paper/Live cannot run simultaneously
3. ✅ **Independent settlement**: Paper uses price, Live uses balance difference
4. ✅ **Independent risk**: Separate `config.risk.paper` and `config.risk.live`
5. ✅ **Pre-flight checks**: Balance and position validation before live start
6. ✅ **Window-end cleanup**: Cancel unfilled orders before window closes
7. ✅ **Balance-based PnL**: Real PnL from redemption balance change

**Files Modified:**
- `packages/bot/src/runtime/mainLoop.ts` - Core trading logic
- `packages/bot/src/trading/liveTrader.ts` - CLI wrappers
- `packages/bot/src/runtime/liveSettlement.ts` - NEW: Settlement orchestrator
- `packages/bot/src/core/state.ts` - Mode switching helper
- `packages/bot/src/app/api/routes.ts` - API pre-flight checks

**Files Created:**
- `packages/bot/src/runtime/liveSettlement.ts`
- `packages/bot/src/__tests__/liveTrader.test.ts`

Plan complete. Ready to execute.

Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)  
Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
