# Live On-Chain P&L Settlement

## Problem

Live trading P&L currently uses the same simulated settlement as paper trading (`AccountStatsManager.resolveTrades()`), which determines win/loss by comparing spot prices at window end against `priceToBeat`. This is not authoritative — the real outcome is determined by Polymarket's on-chain oracle. Spot price at the exact moment of window transition may disagree with the oracle result.

## Decision

**Approach B: CLOB WS resolution + redeem confirmation.**

Live trades stay `pending` until the Polymarket CLOB WebSocket pushes a `market_resolved` event. Win/loss is determined by comparing the trade's `tokenId` against the `winningAssetId`. Winning trades are redeemed on-chain; the USDC delta confirms the P&L. Losing trades are marked immediately. Paper mode is unchanged.

### Key decisions made during design:
- **P&L source**: USDC delta from on-chain redemption (winning) / formula (losing)
- **Trigger**: Window end + CLOB WS `market_resolved` event (already implemented)
- **Pre-settle state**: Trades remain `pending` until redeem succeeds or loss is confirmed
- **Redeem timing**: Automatic after window ends, driven by resolution detection

## Data Flow

```
Window ends
    |
    v
CLOB WS pushes `market_resolved` (winningAssetId known)
    |
    v
LiveSettler detects pending live trade's tokenId is resolved
    |
    +-- trade tokenId === winningAssetId --> WON
    |   +-- redeemPositions(conditionId) on-chain
    |   +-- pnl = size * (1 - price)  [formula, cross-validated with tx event log]
    |   +-- write: won=true, pnl, settlePrice, resolved=true
    |
    +-- trade tokenId !== winningAssetId --> LOST
        +-- pnl = -(size * price)
        +-- write: won=false, pnl, resolved=true
```

## Existing Infrastructure (already built, not used for P&L)

| Module | What it does | Current usage |
|---|---|---|
| `polymarketClobWs.ts` | `market_resolved` events, `isResolved()`, `getWinningAssetId()` | Price streaming only |
| `polygonBalance.ts` | Polls on-chain USDC + CTF positions every 30s | Dashboard display |
| `accountState.ts` | Real-time USDC/CTF state (snapshot + event incremental) | Read-only display |
| `reconciler.ts` | Matches trades to on-chain events (confidence scoring) | Writes recon_status only |
| `redeemer.ts` | Calls CTF `redeemPositions()` | Auto-redeem timer (no P&L writeback) |
| `known_ctf_tokens` table | Maps `tokenId -> marketId + side` | Token tracking |
| `live_pending_orders` table | Tracks GTD orders with `token_id` column | Order lifecycle |

## Changes Required

### 1. New: `src/trading/liveSettler.ts`

Core settlement module for live trades. Periodic polling (15s interval).

```
class LiveSettler:
  constructor(clobWs, liveAccount, wallet)

  settle() -> number:
    for each pending live trade:
      tokenId = lookupTokenId(trade.marketId, trade.side)  // from known_ctf_tokens
      if !clobWs.isResolved(tokenId): continue

      winningAssetId = clobWs.getWinningAssetId(tokenId)
      won = (tokenId === winningAssetId)

      if won:
        conditionId = lookupConditionId(tokenId)
        redeemResult = redeemByConditionId(wallet, conditionId)
        if redeemResult.success:
          pnl = trade.size * (1 - trade.price)
          // Cross-validate: parse USDC Transfer from tx receipt
          liveAccount.resolveTradeOnchain(trade.id, true, pnl, redeemResult.txHash)
        // else: stay pending, retry next poll
      else:
        pnl = -(trade.size * trade.price)
        liveAccount.resolveTradeOnchain(trade.id, false, pnl, null)

  start() -> void   // setInterval(settle, 15_000)
  stop() -> void     // clearInterval
  init() -> void     // On startup, scan all pending trades (recovery)
```

### 2. Modify: `src/trading/accountStats.ts`

Add a new method for on-chain settlement (live only):

```typescript
resolveTradeOnchain(tradeId: string, won: boolean, pnl: number, txHash: string | null): void
```

This method:
- Finds the trade by id
- Sets `resolved=true`, `won`, `pnl`
- Updates `currentBalance`, `totalPnl`, `wins/losses`
- Calls `upsertTrade()` and `syncTradeLog()`
- Same balance accounting as `resolveTrades()` but operates on a single trade by id

The existing `resolveTrades()` remains unchanged for paper mode.

### 3. Modify: `src/index.ts`

- Remove `liveAccount.resolveTrades()` and `liveAccount.resolveExpiredTrades()` calls
- Keep `paperAccount.resolveTrades()` and `paperAccount.resolveExpiredTrades()` unchanged
- Initialize and start `LiveSettler` when live trading is active
- Pass CLOB WS handle to LiveSettler
- Stop LiveSettler on shutdown

### 4. Modify: `src/blockchain/redeemer.ts`

Add single-conditionId redeem function:

```typescript
export async function redeemByConditionId(
  wallet: Wallet,
  conditionId: string,
): Promise<{ success: boolean; txHash: string | null; usdcDelta: number | null; error?: string }>
```

Extracted from existing `redeemAll()` loop body. Parses USDC Transfer event from tx receipt for cross-validation.

### 5. Backfill: `condition_id` in `known_ctf_tokens`

Currently written as `null` in `trader.ts:657`. Options:
- Query from `fetchRedeemablePositions()` response (has `conditionId`)
- Query from Polymarket Gamma API market data
- LiveSettler resolves it lazily when needed for redeem

### 6. No changes to:

- Paper mode settlement (unchanged `resolveTrades()`)
- Frontend (reads same `totalPnl`, `trades`, `wins/losses` fields)
- `AccountStatsManager` interface for getStats/getBalance
- Existing auto-redeem timer (kept as fallback, liveSettler takes priority)

## tokenId Mapping

LiveSettler needs `trade -> tokenId`. Two sources:

1. **`known_ctf_tokens` table**: `(market_id, side) -> token_id`. Already populated by `trader.ts` on every live trade.
2. **`live_pending_orders` table**: Has `token_id` column per order.

Recommended: query `known_ctf_tokens` by `(trade.marketId, trade.side)`. No schema changes needed.

## USDC Delta Precision

Direct pre/post `getUsdcBalance()` comparison has concurrency risk (new trades deducting USDC simultaneously).

**Solution**: Use formula `size * (1 - price)` for winning pnl (mathematically equivalent for binary markets where winning share = $1), cross-validate by parsing USDC Transfer event from redeem tx receipt. Log warning if delta exceeds 1% threshold.

For losing trades: `pnl = -(size * price)` — no on-chain action needed, the cost was already spent.

## Fallback & Edge Cases

| Scenario | Handling |
|---|---|
| CLOB WS disconnected, missed `market_resolved` | Fallback timer: pending trades older than N minutes -> query Polymarket REST API for resolution |
| Redeem fails (gas / RPC) | Stay pending, retry next poll cycle. Max M retries then log error |
| `conditionId` unknown | Fetch from `fetchRedeemablePositions()` and backfill `known_ctf_tokens` |
| Bot restart with unsettled live trades | `liveSettler.init()` scans all pending trades, runs normal settlement flow |
| Auto-redeem and liveSettler both try to redeem | liveSettler marks conditionId as redeemed; auto-redeem skips already-redeemed (existing `redeemed` Set) |
| Market resolved but position already redeemed externally | Check CTF balance before redeem; if 0, mark as won with formula pnl |
