# Orakel Bot Core Logic

Automated trading bot for Polymarket Crypto multi-timeframe up/down markets.

## Overview

Every second, process the active Crypto markets (15m), estimate window-end direction probability with a per-market model that blends technical indicators and `priceToBeat` distance/volatility, compare against Polymarket odds, and bet when edge is found.

```
Startup → Establish data streams → 1s main loop { fetch → indicators → probability → edge → order } → 15min window end → settlement
```

---

## 1. Data Layer — Three Data Sources

| Source | Provides | Connection |
|--------|----------|------------|
| **Binance** | Spot price + 1min candles (240 bars) | WS real-time + REST (60s cache) |
| **Chainlink** | On-chain oracle price | WS real-time + REST (2s fallback) |
| **Polymarket** | Current market odds (UP/DOWN tokens) + order book | WS (CLOB best bid/ask) + REST (3s cache) |

Four BTC markets are fetched independently. Cache layer (`cache.ts`) prevents redundant requests.

### Cache TTLs

| Data | TTL |
|------|-----|
| Binance klines | 60s |
| Polymarket markets | 30s |
| CLOB prices | 3s |
| Chainlink REST | 2s |
| Balance snapshot | 30s |

### Market Definitions (`src/core/markets.ts`)

| Market | Binance Symbol | Polymarket Series | Resolution Source |
|--------|---------------|-------------------|-------------------|
| BTC-15m | BTCUSDT | btc-up-or-down-15m | Chainlink |
| ETH-15m | ETHUSDT | eth-up-or-down-15m | Chainlink |
---

## 2. Decision Engine — Four-Layer Pipeline

```
Candles + Prices ──→ Technical Indicators ──→ Probability Scoring ──→ Edge Computation ──→ Trade Decision
                     (indicators/)            (engines/probability)    (engines/edge)       (engines/edge)
```

### 2.1 Technical Indicators (`src/indicators/`)

| Indicator | Purpose |
|-----------|---------|
| **VWAP** | Volume-price anchor — above VWAP = bullish, below = bearish |
| **RSI(14)** | Momentum strength — >55 bullish, <45 bearish |
| **MACD** | Trend confirmation — histogram expansion direction |
| **Heiken Ashi** | Noise filter — consecutive same-color candles confirm trend |

### 2.2 Technical Analysis Scoring (`engines/probability.ts → scoreDirection`)

Point-based system combining all indicators. Each signal contributes +1~+3 to UP or DOWN score:

| Indicator | UP Condition | DOWN Condition | Score |
|-----------|-------------|----------------|-------|
| Price vs VWAP | price > vwap | price < vwap | +2 |
| VWAP Slope | slope > 0 | slope < 0 | +2 |
| RSI + Slope | RSI > 55 and slope > 0 | RSI < 45 and slope < 0 | +2 |
| MACD Histogram | hist > 0 and delta > 0 (expanding) | hist < 0 and delta < 0 | +2 |
| MACD Level | macd > 0 | macd < 0 | +1 |
| Heiken Ashi | Consecutive green >= 2 | Consecutive red >= 2 | +1 |
| VWAP Failed Reclaim | — | Price failed to reclaim VWAP | +3 |

**Raw Probability Formula:**

```
rawUp = upScore / (upScore + downScore)
```

### 2.3 Price-To-Beat Probability (`estimatePriceToBeatProbability`)

The model now explicitly uses the binary market settlement condition: whether final price will finish above `priceToBeat`.

Current implementation:

```
distanceRatio = (currentPrice - priceToBeat) / currentPrice
sigma = max(volatility15m, floor) * sqrt(timeLeftMin / 15)
z = distanceRatio / sigma
ptbProbUp = sigmoid(1.6 * z)
```

Interpretation:

- current price already above `priceToBeat` pushes probability above 0.5
- more remaining time increases uncertainty, pulling probability back toward 0.5
- higher realized volatility also widens the uncertainty band

### 2.4 Time Decay — S-Curve

As window remaining time decreases, technical signal predictive power declines. The decay function shrinks raw probability toward 0.5 across three regions:

**Linear Decay Baseline:**

```
linearDecay = timeLeftMin / 15
```

**S-Curve Regions:**

| Region | Condition | Time Remaining | Time Decay Value |
|--------|-----------|-----------------|------------------|
| EARLY | linearDecay > 0.6 | > 10 min | 95%–100% (preserve signal) |
| MID | 0.3 < linearDecay <= 0.6 | 5–10 min | smoothstep interpolation 50%–95% |
| LATE | linearDecay <= 0.3 | < 5 min | Aggressive quadratic decay 0%–50% |

**Application Formula:**

```
adjustedUp = 0.5 + (rawUp - 0.5) * timeDecay
```

**Adaptive Volatility Adjustment:**

High volatility means faster price movement, equivalent to having more time remaining; low volatility is the opposite:

- `volPct > 0.8%`: `effectiveRemaining * 1.2` (high volatility = equivalent more time)
- `volPct < 0.3%`: `effectiveRemaining * 0.8` (low volatility = equivalent less time)

### 2.5 Probability Blending (`blendProbabilities`)

Technical-analysis probability is first time-decayed toward 0.5, then blended with the `priceToBeat` probability.

**Current Blend Formula:**

```
taAdjustedUp = applyTimeAwareness(rawUp, timeLeftMin, windowMinutes)
finalUp = 0.65 * ptbProbUp + 0.35 * taAdjustedUp
```

Fallback:

- if `priceToBeat` or volatility inputs are missing, fall back to `ta_only`
- otherwise mark blend source as `ptb_ta`

Per-market strategy config can also set:

- time-left entry bounds
- volatility bounds
- candle aggregation minutes for longer windows
- minimum directional move vs `priceToBeat` before entry is allowed

### 2.6 Regime Detection (`engines/regime.ts`)

| Regime | Condition | Implication |
|--------|-----------|-------------|
| **TREND_UP/DOWN** | Price on same side of VWAP + slope aligned | Trade with trend |
| **CHOP** | >= 3 VWAP crosses in 20 candles, or low volume flat | Avoid |
| **RANGE** | Default | Neutral |

**Regime Classification Decision Tree:**

```
IF data missing → CHOP
IF lowVolume AND |price - vwap| / vwap < 0.1% → CHOP
IF price > vwap AND vwapSlope > 0 → TREND_UP
IF price < vwap AND vwapSlope < 0 → TREND_DOWN
IF vwapCrossCount >= 3 (within 20 candle window) → CHOP
DEFAULT → RANGE
```

Volume check: `lowVolume = volumeRecent < 0.6 * volumeAvg`

### 2.7 Edge Computation (`engines/edge.ts → computeEdge`)

Core formula:

```
edgeUp  = modelUp  - marketUp      // model's UP probability vs market pricing
edgeDown = modelDown - marketDown
```

Where `marketUp = marketYes / (marketYes + marketNo)` (normalized).

**Orderbook Slippage Adjustment:**

- `|imbalance| > 0.2`: `penalty = |imbalance| * 0.02`
- `spread > 0.02`: `penalty = (spread - 0.02) * 0.5`

**Fee Deduction:**

```
fee = 0.25 * (p * (1 - p))^2 * (1 - makerRebate)
```

**Arbitrage/Vig Detection:**

- `rawSum < 0.98`: Arbitrage opportunity (UP + DOWN quotes sum below 1) — buy both sides
- `rawSum > 1.04`: Vig too high, skip this market

### 2.8 Overconfidence Protection

When model probability is too high, it may indicate overfitting or a data anomaly:

- **Soft cap 0.25**: Requires threshold increased by 40% (`threshold * 1.4`)
- **Hard cap 0.40**: Directly reject trade (model may be seriously inaccurate)

### 2.9 Confidence Scoring (`computeConfidence`)

Confidence score combines 5 factors, weighted into a composite value in [0, 1]:

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Indicator Alignment | 25% | Supporting indicators / Available indicators |
| Volatility Score | 15% | 0.3%–0.8% optimal → 1.0; 0.2%–0.3% or 0.8%–1.0% → 0.7; < 0.2% → 0.3; > 1.0% → 0.4 |
| Orderbook Score | 15% | Supports direction → 0.8–1.0; Opposes → 0.3; Neutral → 0.5 |
| Timing Score | 25% | modelProb >= 0.7 → 1.0; 0.6–0.7 → 0.8; 0.55–0.6 → 0.6; Other → 0.4 |
| Regime Score | 20% | Trend-aligned → 1.0; RANGE → 0.7; CHOP → 0.2; Trend-opposed → 0.3 |

**Confidence Levels:**

| Level | Condition |
|-------|-----------|
| HIGH | score >= 0.7 |
| MEDIUM | 0.5 <= score < 0.7 |
| LOW | score < 0.5 |

### 2.10 Trade Decision (`engines/edge.ts → decide`)

Three phases by remaining time, with increasing thresholds (more conservative as window closes):

| Phase | Time Left | Edge Threshold | Min Probability |
|-------|-----------|---------------|-----------------|
| **EARLY** | > 10 min | >= 0.06 | >= 0.52 |
| **MID** | 5-10 min | >= 0.08 | >= 0.55 |
| **LATE** | <= 5 min | >= 0.10 | >= 0.60 |

**Regime Multipliers:**

| Regime | Direction | Multiplier | Description |
|--------|----------|------------|-------------|
| TREND_UP + UP | Aligned | 0.75 | Requires less edge |
| TREND_UP + DOWN | Opposed | 1.3 | Requires more edge |
| TREND_DOWN + DOWN | Aligned | 0.75 | Requires less edge |
| TREND_DOWN + UP | Opposed | 1.3 | Requires more edge |
| RANGE | Any | 1.0 | Standard threshold |
| CHOP | Any | 1.4 | Raise threshold; markets with win rate < 45% use REGIME_DISABLED=999 |

Output: `ENTER(side=UP/DOWN, edge, strength)` or `NO_TRADE(reason)`

Strength: `STRONG` (confidence >= 0.75 and edge >= 0.15), `GOOD` (confidence >= 0.5 and edge >= 0.08), `OPTIONAL` (other cases)

Phase-2 calibration adds a direct `priceToBeat` move gate:

- for `UP`, require `(currentPrice - priceToBeat) / priceToBeat >= minPriceToBeatMovePct`
- for `DOWN`, require `(priceToBeat - currentPrice) / priceToBeat >= minPriceToBeatMovePct`
- otherwise decision returns `NO_TRADE(ptb_move_below_...)`

### 2.11 Complete 17-Step Decision Flow

Decision function executes the following sequential checks:

1. **NaN/Infinity model probability guard**: If modelUp or modelDown is NaN/Infinity → NO_TRADE
2. **NaN/Infinity edge guard**: If edgeUp or edgeDown is NaN/Infinity → NO_TRADE
3. **Market data availability check**: If market data is null → NO_TRADE
4. **skipMarkets config check**: If current market in skip list → NO_TRADE
5. **Determine best direction**: Compare edgeUp vs edgeDown, select direction with larger effective edge
6. **Apply market-specific multiplier**: `effectiveThreshold = baseThreshold * marketMultiplier`
7. **Apply regime multiplier**: `effectiveThreshold = effectiveThreshold * regimeMultiplier`
8. **Regime disabled check**: If regime multiplier >= 999 (REGIME_DISABLED) → NO_TRADE
9. **Edge threshold check**: If `bestEdge < effectiveThreshold` → NO_TRADE
10. **Min probability check**: If `modelProb < minProb` → NO_TRADE
11. **Price-to-beat move check**: If directional move vs `priceToBeat` is below `minPriceToBeatMovePct` → NO_TRADE
12. **Overconfidence hard cap check**: If `bestEdge > 0.40` → NO_TRADE
13. **Overconfidence soft cap check**: If `bestEdge > 0.25` → re-check with penalized threshold (`threshold * 1.4`)
14. **Calculate confidence score**: Call computeConfidence, weighted 5-factor score
15. **Confidence threshold check**: If `confidence < minConfidence` → NO_TRADE
16. **Determine trade strength**: STRONG / GOOD / OPTIONAL based on confidence and edge
17. **Return ENTER**: Carrying direction (side), strength, edge value, confidence score

---

## 3. Main Loop (`src/index.ts` — 1 second cycle)

```
while (true) {
  timing = getCandleWindowTiming(15)          // current 15min window position

  // 1. Settlement: resolve previous window trades on window change
  if (windowChanged) resolveTrades(prevWindow, latestPrices)

  // 2. Process all four markets in parallel
  results = Promise.all(markets.map(processMarket))
  //   processMarket = fetchMarketData() → computeMarketDecision()

  // 3. Filter candidates
  candidates = results
    .filter(action === "ENTER")
    .filter(timeLeft in [3min, 12min])        // too early or too late → skip
    .sort(by edge DESC)                       // best edge first

  // 4. Execute trades (paper → live)
  for (candidate of candidates) executeTrade()

  // 5. Push state snapshot → WebSocket → Dashboard
  emitStateSnapshot()

  await sleep(1000)
}
```

### Startup Sequence

```
main() →
  startApiServer()                        // Hono API on port 9999 + WebSocket
  startConfigWatcher()                    // Auto-reload config.json
  initAccountStats()                      // Load paper/live account from DB
  connectWallet()                         // Auto-connect if PRIVATE_KEY set
  startMultiBinanceTradeStream()          // Binance WebSocket
  startMultiPolymarketPriceStream()       // Polymarket + Chainlink WS
  startChainlinkPriceStream()            // Per-market Chainlink feeds
  startClobMarketWs()                    // Polymarket CLOB WebSocket
  OrderManager.init()                    // GTD order polling
  startOnChainEventStream()              // Polygon events for live account
```

### Per-Market Pipeline (`src/pipeline/`)

```
processMarket({ market, timing, streams, state })
  ├─ fetchMarketData()                    // src/pipeline/fetch.ts
  │   ├─ Binance: fetchKlines(1m, 240) + fetchLastPrice
  │   ├─ Chainlink: fetchChainlinkPrice (or from WS)
  │   └─ Polymarket: fetchPolymarketSnapshot
  │       ├─ fetchLiveEventsBySeriesId() → current 15-min market
  │       ├─ fetchClobPrice() for UP/DOWN tokens
  │       └─ fetchOrderBook() for UP/DOWN
  │
  └─ computeMarketDecision()              // src/pipeline/compute.ts
      ├─ computeVwapSeries(candles)
      ├─ computeRsi(closes, 14)
      ├─ computeMacd(closes)
      ├─ computeHeikenAshi(candles)
      ├─ countConsecutive(ha)
      ├─ detectRegime()
      ├─ scoreDirection()
      ├─ applyTimeAwareness()
      ├─ computeEdge()
      └─ decide() → TradeDecision { action, side, edge, phase, reason }
```

---

## 4. Trade Execution (`src/trading/trader.ts`)

| Mode | Order Type | Description |
|------|-----------|-------------|
| **Paper** | Simulated | `addTrade()` records trade, no on-chain action |
| **Live + EARLY/MID** | GTD + postOnly | Limit order for maker rebate, 5s heartbeat keep-alive |
| **Live + LATE + strong signal** | FOK | Fill-or-kill, immediate execution |

### Risk Guards (`canTrade`)

- Sufficient balance
- Daily loss limit not breached (`dailyMaxLossUsdc`)
- Max drawdown not breached (50% of initial balance)

### Order Lifecycle (`src/trading/orderManager.ts`)

- GTD orders: polled every 5s, tracked for heartbeat
- FOK orders: immediate fill/reject, no heartbeat
- Status transitions: `placed → live → matched/filled → cancelled/expired`

---

## 5. Settlement (`src/trading/accountStats.ts` + `liveSettler.ts`)

At each 15-minute window end:

```
finalPrice vs priceToBeat (first price in window)
  → finalPrice > priceToBeat → UP wins
  → finalPrice <= priceToBeat → DOWN wins

WIN  → +size * (1 - price)     // bought at price, won 1, profit = (1-price)
LOSS → -size * price            // total loss
```

### Live Settlement

- `liveSettler.ts`: watches for filled GTD orders, fetches settlement price on market end
- `redeemer.ts`: calls CTF contract `redeemPositions()` to claim on-chain winnings
- `reconciler.ts`: matches trade records to on-chain events every 60s

### On-Chain Contracts (Polygon)

| Contract | Address |
|----------|---------|
| CTF (Conditional Token Framework) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |

---

## 6. Risk Management

| Risk Control Rule | Description |
|-------------------|-------------|
| Daily loss limit | If `todayPnl < -dailyMaxLossUsdc`, stop all trading for the day |
| Max drawdown | If drawdown >= 50% of initial balance, stop trading |
| Max positions | Maximum simultaneous positions per mode (paper/live): `maxOpenPositions` |
| Max trades per window | Maximum trades per 15-minute window per market: `maxTradesPerWindow` |
| Global max trades per window | Maximum trades per window across all markets: `maxGlobalTradesPerWindow` |
| Rate limit window | Live orders use 16-minute trimmed window for rate limiting |

---

## 7. 15-Minute Window Lifecycle

### Window Alignment

Windows strictly aligned to quarter-hour marks: 0:00, 0:15, 0:30, 0:45. Tracks previous window start time via `prevWindowStartMs` to detect boundaries.

### Phase Division

| Phase | Time Remaining | Characteristics |
|-------|----------------|-----------------|
| EARLY | > 10 minutes | High uncertainty, use GTD post-only orders |
| MID | 5–10 minutes | Medium certainty, use GTD post-only orders |
| LATE | < 5 minutes | High certainty, use FOK orders when confidence is high |

### Boundary Handling Flow

When a new window is detected, execute in sequence:

1. Process pending start/stop transitions
2. Settle previous window's paper trades
3. Redeem live positions
4. Reset per-market trackers

### Cycle-Aware Transitions

Pending mode switches (paper to live) are deferred to window boundaries, preventing state changes mid-window that could cause some trades in the same window to be recorded in paper mode while others execute in live mode.

---

## 8. State Management Pattern

**Module-Level Singleton**: No dependency injection framework. Module top-level variables serve as shared state. Suitable for a single-process bot — simple, no overhead, follows YAGNI.

**EventEmitter (`botEvents`)**: Core mechanism for cross-module communication. Main events:

- `state:snapshot` — Emitted after each main loop, carries full state snapshot, broadcast to frontend via WebSocket
- `signal:new` — Emitted when a new signal is generated
- `trade:executed` — Emitted when trade execution completes

**State Version Number**: Increments each snapshot. The frontend uses it to detect out-of-order messages.

**Cycle-Aware Pending Transitions**: `pendingStart` / `pendingStop` flags are only consumed at window boundaries, ensuring atomic state transitions.

---

## 9. Error Handling Strategy

**Market-Level Isolation**: Each market is processed independently. A single market failure doesn't block others.

**Safe Mode**: After 3+ consecutive all-market failures, the bot enters safe mode, skipping trade execution until at least one market processes successfully.

**Heartbeat Resilience**: Live GTD orders are monitored via heartbeat every 5 seconds. After consecutive failures, the bot initiates exponential backoff reconnection (max 5 attempts).

**RPC Failover**: Chainlink is configured with multiple RPC endpoints. The bot auto-remembers the last successful primary endpoint and rotates on failure.

**WebSocket Auto-Reconnect**: All WebSocket connections (Binance, Polymarket, Chainlink, CLOB) auto-reconnect on disconnect, with backoff growing exponentially from 500ms to a max of 10 seconds.

**Graceful Degradation**: When a data fetch fails, the bot uses cached data, logs a warning, and continues the main loop without interruption.

---

## 10. Architecture Diagram

```
                        ┌─────────────────────────────────────┐
                        │          config.json                │
                        │   (strategy thresholds, risk)       │
                        └──────────────┬──────────────────────┘
                                       │
  Binance WS ──┐                       │
  Chainlink WS ─┤──→ fetchMarketData() │
  Polymarket WS ┘         │            │
                           ▼            ▼
                    ┌──────────────────────────┐
                    │   computeMarketDecision   │
                    │                          │
                    │  VWAP ─┐                 │
                    │  RSI  ─┤→ scoreDirection │──→ modelUp / modelDown
                    │  MACD ─┤    + timeDecay  │
                    │  HA   ─┘                 │
                    │                          │
                    │  detectRegime ──────────→│──→ regime
                    │                          │
                    │  computeEdge ───────────→│──→ edgeUp / edgeDown
                    │  decide ────────────────→│──→ ENTER or NO_TRADE
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │  executeTrade             │
                    │  Paper: record            │
                    │  Live: CLOB GTD/FOK       │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │  resolveTrades (15min)    │
                    │  Live: redeem on-chain    │
                    └──────────────────────────┘
```

---

## 11. Design Decisions

### Why Bun

Bun provides fast startup time and native TypeScript support without an extra compile step. That fits a single-process bot with a tight startup/runtime loop, even though persistence is now handled through PostgreSQL rather than Bun's old SQLite path.

### Why Hono

Hono is lightweight with no runtime dependencies. It supports chained route definitions and exports `AppType`, giving the frontend full end-to-end type inference via `hc<AppType>()`. This eliminates API contract drift.

### Why Module-Level Singleton Over Dependency Injection

Orakel is a single-process application that doesn't need multiple instances or test isolation. Module-level singleton code is simpler, has no framework overhead, and follows YAGNI.

### Why Cycle-Aware Transitions

State switches within an active market window (like switching from paper to live) could cause some trades in the same cycle to be recorded in paper mode while others execute in live mode, creating statistical inconsistencies. Deferring transitions to window boundaries ensures mode uniformity within each market window.

### Why Both REST and WebSocket

REST handles initial page load (historical data, config, trade records) and mutations (changing config, starting/stopping the bot). WebSocket pushes real-time state snapshots once per second, avoiding frontend polling and reducing latency. Clear separation of concerns, no interference.

---

## 12. Example Trading Decision

A complete walkthrough of the decision flow for a specific scenario.

**Scenario:** BTC market, MID phase (7 min remaining), TREND_UP regime

**Step 1: Technical Analysis Scoring**

```
upScore = 10, downScore = 1
rawUp = 10 / (10 + 1) = 0.909
```

**Step 2: Volatility-Implied Probability**

```
d = ln(currentPrice / priceToBeat) ≈ -0.055
z = -0.055 / (volatility15m * sqrt(7/15)) ≈ -0.055
volImpliedUp = Phi(-0.055) ≈ 0.48
```

**Step 3: Time Decay**

```
linearDecay = 7/15 = 0.467 (MID region)
timeDecay = smoothstep ≈ 0.72
adjustedUp = 0.5 + (0.909 - 0.5) * 0.72 = 0.795
```

**Step 4: Probability Blending**

```
blendedUp = 0.5 * 0.48 + 0.5 * 0.795 = 0.6375
```

**Step 5: Edge Calculation**

```
marketUp = 0.55 (Polymarket quote)
edgeUp = 0.6375 - 0.55 = 0.0875
```

**Step 6: Threshold Calculation**

```
baseThreshold = 0.08 (MID phase)
marketMultiplier = 1.0 (BTC)
regimeMultiplier = 0.75 (TREND_UP + UP aligned)
effectiveThreshold = 0.08 * 1.0 * 0.75 = 0.06
```

**Step 7: Decision**

```
edgeUp (0.0875) > effectiveThreshold (0.06)
→ Check probability: modelUp (0.6375) > minProb (0.55) ✓
→ Check confidence score: passes ✓
→ ENTER with side: UP
```

Strong technical indicators combined with a trend-aligned regime result in a successful entry. If confidence were low or edge were smaller, the trade would be rejected.

---

## Summary

A classic **model vs market** framework: estimate true probability with TA indicators, compare against Polymarket pricing, enter when edge exists. Time management (phase thresholds + time decay) and risk controls (stop-loss + daily limit) ensure capital is not wasted on low-quality opportunities.

### Key Files

| File | Role |
|------|------|
| `src/index.ts` | Entry point, main 1s loop, startup |
| `src/pipeline/fetch.ts` | Data fetching from all sources |
| `src/pipeline/compute.ts` | Indicator computation + decision orchestration |
| `src/engines/probability.ts` | TA-based probability scoring + volatility-implied probability |
| `src/engines/regime.ts` | Market regime detection |
| `src/engines/edge.ts` | Edge computation + confidence scoring + trade decision |
| `src/trading/trader.ts` | Paper/live trade execution |
| `src/trading/orderManager.ts` | GTD/FOK order lifecycle |
| `src/trading/accountStats.ts` | Balance, P&L, risk management |
| `src/trading/liveSettler.ts` | On-chain settlement |
| `src/core/state.ts` | Shared runtime state + EventEmitter |
| `src/core/config.ts` | Zod-validated config with hot-reload |
| `src/api.ts` | Hono HTTP server + WebSocket |

---

## Related Documentation

- [Backend Documentation](./backend.md) — Detailed module-by-module backend reference, API endpoints, database schema
- [Frontend Documentation](./frontend.md) — React component hierarchy, state management, WebSocket integration, styling
- [Deployment Guide](./deployment.md) — Docker, CI/CD, environment setup, VPS auto-deployment
- [Testing Documentation](./testing.md) — Test coverage, test file organization, running tests
