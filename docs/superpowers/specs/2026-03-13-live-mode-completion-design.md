# Live Mode Completion Design Spec

> **Date:** 2026-03-13  
> **Scope:** Complete live trading mode for Polymarket BTC 5-min bot using CLI as source of truth  
> **Status:** Approved for implementation

---

## 1. Overview

### 1.1 Goals

1. **CLI-centric architecture**: All live trading state (balance, positions, order status) comes from Polymarket CLI, not inferred or calculated
2. **Mode mutual exclusion**: Paper and Live modes cannot run simultaneously; switching automatically stops the other
3. **Independent settlement**: Paper uses price-based settlement; Live uses balance-difference settlement after redemption
4. **Independent risk management**: Each mode has its own `config.risk.{paper|live}` with isolated daily loss/position tracking

### 1.2 Non-Goals

- Real-time order fill tracking (use fire-and-forget + cancel at window end)
- Position averaging or partial fills handling
- Multi-market support (BTC-5m only)

---

## 2. Architecture

### 2.1 Core Principle: CLI is Source of Truth

All live trading decisions are based on CLI query results, not internal state:

| Decision | Source |
|----------|--------|
| Can we trade? | `getBalance() >= maxTradeSizeUsdc` |
| Do we have position? | `getPositions()` contains window's tokenId |
| Did order fill? | `getOrderStatus(orderId)` after brief delay |
| What was PnL? | `balanceAfter - balanceBefore` from `getBalance()` |

### 2.2 Mode State Machine

```
                    start paper
    ┌─────────────┐──────────────►┌─────────┐
    │             │               │  PAPER  │
    │   STOPPED   │◄──────────────┤         │
    │             │  stop paper   └────┬────┘
    │             │                    │
    │             │◄───────────────────┘
    │             │    start live
    │             │──────────────►┌────────┐
    │             │               │  LIVE  │
    └─────────────┘◄──────────────┤        │
                    stop live     └────────┘
```

**Mutual exclusion enforced at API layer**: Starting one mode automatically stops the other.

### 2.3 Settlement Strategy Comparison

| Aspect | Paper Mode | Live Mode |
|--------|------------|-----------|
| **Trigger** | Window end detected in mainLoop | Window end + redemption completion |
| **Outcome source** | BTC price vs priceToBeat | Balance change after redemption |
| **PnL calculation** | `size * ((1-entryPrice)/entryPrice)` | `balanceAfter - balanceBefore` |
| **Data source** | In-memory price tick | `getBalance()` CLI call |
| **Timing** | Immediate at window end | After `redeemPositions()` completes |

---

## 3. Component Design

### 3.1 LiveTrader (`trading/liveTrader.ts`)

**New functions to add:**

```typescript
// Pre-flight checks before starting live mode
export async function checkLiveReady(
  minBalanceUsdc: number
): Promise<{ ok: boolean; error?: string }> {
  // 1. checkCliAvailable() (already done at bootstrap)
  // 2. getBalance() >= minBalanceUsdc
  // 3. getPositions() returns empty array
}

// Cancel all open orders (called at window end)
export async function cancelAllOrders(): Promise<{ ok: boolean }> {
  // Wraps CLI cancelAll()
}

// Get current USDC balance
export async function getLiveBalance(): Promise<number> {
  // Wraps CLI getBalance()
}

// Get current positions
export async function getLivePositions(): Promise<CliPositionEntry[]> {
  // Wraps CLI getPositions()
}

// Check if specific order was filled
export async function checkOrderFilled(orderId: string): Promise<boolean> {
  // Calls getOrderStatus(orderId), returns true if status === "FILLED"
}
```

### 3.2 LiveSettlement (`runtime/liveSettlement.ts`) [NEW FILE]

**Purpose**: Orchestrate live mode settlement flow

```typescript
interface SettlementContext {
  windowSlug: string;
  tradeId: number;
  orderId: string;
  entryPrice: number;
  size: number;
  side: "UP" | "DOWN";
  balanceBefore: number;
}

// Main settlement flow
export async function settleLiveWindow(
  ctx: SettlementContext,
  settlePrice: number,
  priceToBeat: number
): Promise<void> {
  // 1. Determine outcome from BTC price (for reference)
  const won = (ctx.side === "UP" && settlePrice >= priceToBeat) ||
              (ctx.side === "DOWN" && settlePrice < priceToBeat);
  
  // 2. Redeem positions
  await runRedemption();
  
  // 3. Query balance after redemption
  const balanceResult = await getLiveBalance();
  if (!balanceResult.ok) {
    // Log warning, use price-based PnL as fallback
  }
  const balanceAfter = balanceResult.data ?? ctx.balanceBefore;
  
  // 4. Calculate PnL from balance change
  const pnlUsdc = balanceAfter - ctx.balanceBefore;
  
  // 5. Update DB
  await settleDbTrade({
    tradeId: ctx.tradeId,
    outcome: pnlUsdc > 0 ? "WIN" : "LOSS",
    settleBtcPrice: settlePrice,
    pnlUsdc,
  });
}
```

### 3.3 MainLoop Integration (`runtime/mainLoop.ts`)

**Changes needed:**

1. **Fix risk config routing** (line 161):
   ```typescript
   // BEFORE (bug):
   risk: config.risk.paper, // Always uses paper risk!
   
   // AFTER:
   risk: paperRunning ? config.risk.paper : config.risk.live,
   ```

2. **Live trading flow** (around line 232):
   ```typescript
   if (liveRunning && !hasPosition) {
     // Check balance first
     const balanceResult = await getLiveBalance();
     if (!balanceResult.ok || balanceResult.data < config.risk.live.maxTradeSizeUsdc) {
       log.warn("Insufficient balance for live trade");
       return;
     }
     
     // Check no existing position
     const positions = await getLivePositions();
     const hasLivePosition = positions.some(p => 
       p.asset === tokenId || p.asset === marketInfo.upTokenId || p.asset === marketInfo.downTokenId
     );
     if (hasLivePosition) {
       log.info("Already have position in this window");
       return;
     }
     
     // Execute trade
     const result = await executeLiveTrade(...);
     if (result.success) {
       // Brief delay then check fill
       await sleep(1000);
       const filled = await checkOrderFilled(result.orderId);
       if (!filled) {
         log.warn("Order not filled, will cancel at window end");
       }
       
       // Persist with balance snapshot
       const balanceBefore = balanceResult.data;
       await persistTrade({...});
       // Store balanceBefore for later settlement
     }
   }
   ```

3. **Window-end cancel** (before settlement):
   ```typescript
   if (liveRunning && timeLeft < 30 && previousWindow) {
     await cancelAllOrders();
   }
   ```

4. **Settlement dispatch**:
   ```typescript
   if (previousWindow?.state === "SETTLED" && previousWindow.state !== "SETTLED") {
     if (paperRunning) {
       // Existing paper settlement...
     } else if (liveRunning) {
       // New live settlement
       await settleLiveWindow(liveSettlementCtx, settlePrice, prevPriceToBeat);
     }
   }
   ```

### 3.4 API Routes (`app/api/routes.ts`)

**Changes to `/control/start`:**

```typescript
app.post("/control/start", async (c) => {
  const body = (await c.req.json()) as ControlRequestDto;
  
  // Mutual exclusion: stop other mode first
  if (body.mode === "paper" && isLiveRunning()) {
    requestLiveStop();
    // Wait briefly for stop to complete
    await sleep(500);
  } else if (body.mode === "live" && isPaperRunning()) {
    requestPaperStop();
    await sleep(500);
  }
  
  // Pre-flight for live mode
  if (body.mode === "live") {
    const ready = await checkLiveReady(config.risk.live.maxTradeSizeUsdc * 2);
    if (!ready.ok) {
      return c.json({ ok: false, error: ready.error }, 400);
    }
  }
  
  // Start requested mode
  if (body.mode === "paper") requestPaperStart();
  else requestLiveStart();
  
  return c.json({ ok: true, ... });
});
```

### 3.5 State Management (`core/state.ts`)

**Add mode transition helper:**

```typescript
export function switchTradingMode(targetMode: "paper" | "live"): void {
  // Stop current mode if different
  if (targetMode === "live" && _paperRunning) {
    requestPaperStop();
  } else if (targetMode === "paper" && _liveRunning) {
    requestLiveStop();
  }
  // Clear mode-specific state
  clearWindowTrades();
}
```

---

## 4. Data Flow

### 4.1 Live Trade Execution Flow

```
Tick Processing
  ├─ getBalance() ──────────────────────┐
  ├─ getPositions() ────────────────────┤ Check prerequisites
  │                                     │
  ▼                                     ▼
[Balance OK?] ──No──► Skip window
  │
 Yes
  │
  ▼
createOrder({ tokenId, price, size })
  │
  ▼
[Order placed]
  │
  ▼
getOrderStatus(orderId) ───► [Filled?]
  │                           │
  │                      Yes │ No
  │                           │
  │                           ▼
  │                     Will cancel at window end
  ▼
persistTrade({ mode: "live", orderId, balanceBefore })
```

### 4.2 Live Settlement Flow

```
Window End Detected
  │
  ▼
cancelAll() ───► Clean up unfilled orders
  │
  ▼
redeemPositions() ───► Redeem winning tokens
  │
  ▼
getBalance() ───► balanceAfter
  │
  ▼
PnL = balanceAfter - balanceBefore
  │
  ▼
settleDbTrade({ outcome: PnL>0?"WIN":"LOSS", pnlUsdc: PnL })
```

---
## 5. Configuration

### 5.1 Risk Config (already exists in config.json)

```json
{
  "risk": {
    "paper": {
      "maxTradeSizeUsdc": 5,
      "dailyMaxLossUsdc": 100,
      "maxOpenPositions": 2
    },
    "live": {
      "maxTradeSizeUsdc": 5,
      "dailyMaxLossUsdc": 50,
      "maxOpenPositions": 1
    }
  }
}
```

### 5.2 Execution Config (already exists)

```json
{
  "execution": {
    "orderType": "limit",
    "limitDiscount": 0.02,
    "minOrderPrice": 0.05,
    "maxOrderPrice": 0.95
  }
}
```

---

## 6. Error Handling

### 6.1 CLI Error Classification

Already exists in `executor.ts`:
- `fatal`: Auth failure, invalid token → Don't retry, stop trading
- `permanent`: Insufficient balance, invalid order → Don't retry, skip
- `transient`: Network timeout → Retry with backoff

### 6.2 Live Mode Specific Errors

| Error | Response |
|-------|----------|
| `getBalance()` fails | Skip this tick, retry next tick |
| `getPositions()` fails | Assume no positions (conservative) |
| `createOrder()` fails | Log, don't persist, retry next tick if conditions still met |
| `getOrderStatus()` fails | Assume order pending (will cancel at window end) |
| `redeemPositions()` fails | Retry in next settlement cycle, don't mark settled |
| `cancelAll()` fails | Log warning, continue (order may fill or expire) |

---

## 7. Testing Strategy

### 7.1 Unit Tests

1. **LiveTrader**: Mock CLI responses, test checkLiveReady, cancelAllOrders
2. **LiveSettlement**: Mock balance changes, test PnL calculation
3. **MainLoop**: Test mode switching, risk config routing

### 7.2 Integration Tests

1. **Mode switching**: Start paper → start live (should auto-stop paper) → verify only live trades
2. **Settlement**: Mock CLI balance before/after, verify correct PnL written to DB
3. **Error recovery**: Simulate CLI failures at each step, verify graceful degradation

---

## 8. Implementation Phases

### Phase 1: Foundation
- Fix `config.risk` routing bug in mainLoop
- Add liveTrader helper functions (checkLiveReady, getLiveBalance, etc.)

### Phase 2: Trading Flow
- Integrate balance/position checks into live trading decision
- Add order status confirmation after trade

### Phase 3: Settlement
- Create LiveSettlement module
- Add cancelAll at window end
- Implement balance-based PnL settlement

### Phase 4: Integration
- Mode mutual exclusion in API routes
- Pre-flight checks on live start
- End-to-end testing

---

## 9. File Checklist

| File | Action | Lines |
|------|--------|-------|
| `trading/liveTrader.ts` | Add helper functions | +40 lines |
| `runtime/liveSettlement.ts` | Create new file | ~80 lines |
| `runtime/mainLoop.ts` | Fix risk routing, add live flow | ~60 lines changed |
| `core/state.ts` | Add mode switching helper | +15 lines |
| `app/api/routes.ts` | Mutual exclusion, pre-flight | ~20 lines changed |
| `trading/persistence.ts` | No changes needed | - |
| `cli/commands.ts` | No changes needed | - |

---

## 10. Open Questions

1. **Order confirmation delay**: 1s delay after createOrder before checking status — sufficient?
2. **Redemption timing**: How long after window end should we wait before calling redeemPositions?
3. **Partial fills**: Current design assumes full fill or no fill. Handle partials in v2?

---

**Next Step:** Write implementation plan with bite-sized tasks

Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)  
Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
