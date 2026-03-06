# BTC Multi-Timeframe Refactor

**Date**: 2026-03-06
**Status**: Approved
**Approach**: Timeframe-as-Market (Approach A)

## Summary

Refactor from multi-coin single-window (BTC/ETH/SOL/XRP × 15m) to single-coin multi-window (BTC × 5m/15m/1h/4h). All 4 timeframes run in parallel as independent "markets" reusing the existing multi-market pipeline.

## Target Market Configuration

| Market ID | Window | Resolution Source | Slug Pattern | Series Slug |
|-----------|--------|-------------------|--------------|-------------|
| BTC-5m | 5 min | Chainlink BTC/USD | `btc-updown-5m-{ts}` | `btc-up-or-down-5m` |
| BTC-15m | 15 min | Chainlink BTC/USD | `btc-updown-15m-{ts}` | `btc-up-or-down-15m` |
| BTC-1h | 60 min | **Binance BTC/USDT** | `bitcoin-up-or-down-{date}-{time}-et` | `bitcoin-up-or-down` |
| BTC-4h | 240 min | Chainlink BTC/USD | `btc-updown-4h-{ts}` | `btc-up-or-down-4h` |

The 1h market is fundamentally different: it resolves on Binance 1H candle open vs close (not Chainlink spot comparison). Its slug pattern is also human-readable dates rather than unix timestamps.

## Data Model

### MarketConfig Changes

Add three fields to `MarketConfig`:

```typescript
interface MarketConfig {
  id: string;                    // "BTC-5m", "BTC-15m", "BTC-1h", "BTC-4h"
  coin: string;                  // "BTC" — groups shared WS resources
  label: string;                 // "Bitcoin 5m"
  candleWindowMinutes: number;   // 5, 15, 60, 240
  resolutionSource: "chainlink" | "binance";
  binanceSymbol: string;         // "BTCUSDT"
  polymarket: {
    seriesId: string;
    seriesSlug: string;
    slugPrefix: string;
  };
  chainlink: {
    aggregator: string;
    decimals: number;
    wsSymbol: string;
  };
  pricePrecision: number;
}
```

New fields: `coin`, `candleWindowMinutes`, `resolutionSource`.
Removed from global config: `candleWindowMinutes` (now per-market).

### ACTIVE_MARKETS

Env var changes from `BTC,ETH,SOL,XRP` to `BTC-5m,BTC-15m,BTC-1h,BTC-4h`.

## Per-Market Timing

Each market gets its own timing cycle. `getCandleWindowTiming()` already accepts `windowMinutes` — callers change from `CONFIG.candleWindowMinutes` to `market.candleWindowMinutes`.

Window transition detection uses `Map<string, number>` (keyed by market ID) instead of a single `prevWindowStartMs`.

Settlement calls (`resolveTrades`, `resolveExpiredTrades`) receive the market's own `candleWindowMinutes`.

## Strategy Scaling

### Phase Classification

Proportional to window duration instead of hardcoded minutes:

```typescript
const ratio = remainingMinutes / windowMinutes;
const phase = ratio > 0.66 ? "EARLY" : ratio > 0.33 ? "MID" : "LATE";
```

### Entry Timing

Skip first/last 20% of window (replaces hardcoded 3 minutes):

```typescript
const buffer = windowMinutes * 0.2;
if (elapsed < buffer) return false;
if (tl < buffer) return false;
```

### Strategy Thresholds

Per-timeframe config with fallback:

```json
{
  "strategy": {
    "BTC-5m":  { "edgeThresholdEarly": 0.03, ... },
    "BTC-15m": { "edgeThresholdEarly": 0.05, ... },
    "BTC-1h":  { "edgeThresholdEarly": 0.04, ... },
    "BTC-4h":  { "edgeThresholdEarly": 0.03, ... },
    "default": { "edgeThresholdEarly": 0.05, ... }
  }
}
```

### Volatility Lookback

Scales with window: `lookback = Math.max(30, candleWindowMinutes * 4)`.

## 1h Binance Resolution

The 1h market resolves on Binance candle open vs close. The `resolutionSource` field drives price selection:

```typescript
const settlementPrice = market.resolutionSource === "binance"
  ? spotPrice       // Binance BTCUSDT
  : currentPrice;   // Chainlink on-chain
```

The pipeline already fetches both prices — just needs conditional selection.

## Shared WS Resources

Deduplicate streams by `coin` field. All 4 BTC timeframes share one Binance WS and one Chainlink WS:

```typescript
const uniqueSymbols = [...new Set(markets.map(m => m.binanceSymbol))];
// ["BTCUSDT"] → one stream
```

## P&L and Risk

- Trades tagged with market ID (BTC-5m, BTC-15m, etc.)
- `maxOpenPositions` and `maxTradesPerWindow`: per-timeframe
- `dailyMaxLossUsdc`: global across all timeframes
- Per-timeframe P&L breakdown via existing `getMarketBreakdown()`

## Deletion Scope

Remove entirely:
- ETH, SOL, XRP entries from MARKETS array
- ETH/SOL/XRP Chainlink aggregator addresses
- Hardcoded `["BTC", "ETH", "SOL", "XRP"]` arrays in api.ts and frontend
- `CHAINLINK_BTC_USD_AGGREGATOR` env var
- Multi-coin display logic in frontend

## File Impact Map

| Area | Files | Effort |
|------|-------|--------|
| Data model | types.ts, markets.ts | Low |
| Config | config.ts, config.json, env.ts, .env.example | Low |
| Pipeline timing | index.ts, fetch.ts, compute.ts | Medium |
| Strategy/engines | edge.ts, probability.ts | Medium |
| Trading | trader.ts, accountStats.ts | Low |
| Polymarket data | polymarket.ts | Low |
| WS dedup | index.ts, binanceWs.ts | Low |
| API | api.ts | Low |
| Frontend | ~5 files (marketOrder, labels, display) | Medium |
| Tests | edge.test.ts, polymarket.test.ts + others | Medium |
| Cleanup | Delete ETH/SOL/XRP code | Low |

## Open Items

- Determine `seriesId` values for 5m, 1h, 4h Polymarket series (query Gamma API)
- Calibrate strategy thresholds per-timeframe (start with 15m values, tune later)
- 1h slug pattern matching may need special handling in `filterBtcUpDown15mMarkets`
