# Orakel System Flowcharts

This document contains detailed flowcharts for the Orakel trading system.

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Main Trading Loop](#2-main-trading-loop)
3. [Trading Decision Flow](#3-trading-decision-flow)
4. [Probability Engine](#4-probability-engine)
5. [Market Regime Detection](#5-market-regime-detection)
6. [Order Execution Flow](#6-order-execution-flow)
7. [Data Pipeline](#7-data-pipeline)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ORAKEL TRADING SYSTEM                                  │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         EXTERNAL DATA SOURCES                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │   Binance    │  │  Polymarket  │  │  Chainlink   │  │  Polymarket │  │   │
│  │  │  REST + WS   │  │  Gamma API   │  │  RPC + WS    │  │  CLOB WS    │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │   │
│  └─────────┼──────────────────┼──────────────────┼───────────────────┼────────┘   │
│            │                  │                  │                  │             │
│            ▼                  ▼                  ▼                  ▼             │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          DATA LAYER (src/data/)                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │  binance.ts  │  │ polymarket   │  │ chainlink.ts │  │ polymarket  │  │   │
│  │  │ binanceWs.ts │  │ polymarket   │  │chainlinkWs.ts│  │  CLOB WS    │  │   │
│  │  └──────────────┘  │  LiveWs.ts   │  └──────────────┘  └─────────────┘  │   │
│  │                    └──────────────┘                                      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                         │
│                                      ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                       INDICATORS LAYER (src/indicators/)                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │   RSI(14)    │  │   MACD(12,   │  │   VWAP       │  │ Heiken Ashi │  │   │
│  │  │   + Slope    │  │   26, 9)     │  │   + Slope    │  │ + Consec.   │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                         │
│                                      ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      TRADING ENGINES (src/engines/)                      │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │   │
│  │  │  PROBABILITY ENGINE                                                │  │   │
│  │  │  • TA Direction Score (6 indicators)                              │  │   │
│  │  │  • Volatility-Implied Prob (Black-Scholes w/ fat-tail)             │  │   │
│  │  │  • Time Decay (S-curve, volatility-adjusted)                       │  │   │
│  │  │  • Blend: 50% vol + 50% TA                                         │  │   │
│  │  └───────────────────────────────────────────────────────────────────┘  │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │   │
│  │  │  REGIME ENGINE                                                     │  │   │
│  │  │  • TREND_UP: Price > VWAP, VWAP↑, volume > mean                   │  │   │
│  │  │  • TREND_DOWN: Price < VWAP, VWAP↓, volume > mean                 │  │   │
│  │  │  • CHOP: VWAP crosses >3x in 20 candles OR low volume             │  │   │
│  │  │  • RANGE: Default                                                 │  │   │
│  │  └───────────────────────────────────────────────────────────────────┘  │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │   │
│  │  │  EDGE ENGINE                                                       │  │   │
│  │  │  • Edge = ModelProb - MarketPrice                                 │  │   │
│  │  │  • Adjust for orderbook, spread, fees                             │  │   │
│  │  │  • Confidence Score (5 factors)                                   │  │   │
│  │  │  • Decision: Phase-based thresholds, regime multipliers           │  │   │
│  │  └───────────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                         │
│                                      ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         TRADING LAYER (src/)                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │   trader.ts  │  │orderManager  │  │ paperStats   │  │ reconciler  │  │   │
│  │  │              │  │   .ts        │  │   .ts        │  │    .ts      │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                         │
│                                      ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          CORE LAYER (src/core/)                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │  config.ts   │  │   state.ts   │  │    db.ts     │  │   logger    │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                         │
│                                      ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          API LAYER (Hono)                               │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │   │
│  │  │  REST API: /api/state, /api/trades, /api/signals, /api/config     │  │   │
│  │  │  WebSocket: /ws → state:snapshot, signal:new, trade:executed      │  │   │
│  │  └───────────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Main Trading Loop

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     MAIN TRADING LOOP (Every 1 second)                          │
│                                                                                 │
│  START                                                                           │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK RUNNING STATE                                                   │     │
│  │  • Is paper trading running?                                          │     │
│  │  • Is live trading running?                                           │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  DETECT 15-MIN WINDOW BOUNDARY                                          │     │
│  │  • prevWindowStartMs != currentWindowStartMs ?                        │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ├── YES ──► ┌──────────────────────────────────────────────────────┐        │
│    │           │  WINDOW BOUNDARY HANDLERS                             │        │
│    │           │  1. Process pending start/stop transitions           │        │
│    │           │  2. Settle paper trades from previous window         │        │
│    │           │  3. Redeem live positions                            │        │
│    │           │  4. Reset market trackers                            │        │
│    │           └──────────────────────────────────────────────────────┘        │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  PARALLEL PROCESS ALL MARKETS                                           │     │
│  │  FOR EACH market IN [BTC, ETH, SOL, XRP]:                               │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  PHASE 1: DATA COLLECTION (parallel)                                    │     │
│  │  • Binance REST: 240 × 1-minute candles (60s cache)                    │     │
│  │  • Binance WS: Real-time tick prices                                    │     │
│  │  • Polymarket REST: Market metadata (30s cache)                        │     │
│  │  • Polymarket REST: Price + orderbook (3s cache)                       │     │
│  │  • Polymarket WS: Chainlink price feeds                                │     │
│  │  • Chainlink RPC: On-chain price (fallback)                            │     │
│  │  • Chainlink WS: AnswerUpdated events                                  │     │
│  │  • CLOB WS: BBO, tick size, settlement status                          │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  PHASE 2: TECHNICAL INDICATORS                                          │     │
│  │  • Heiken Ashi: Color + consecutive count                              │     │
│  │  • RSI(14): Strength + slope                                           │     │
│  │  • MACD(12,26,9): Histogram + delta                                    │     │
│  │  • VWAP: Volume-weighted price + slope                                 │     │
│  │  • Realized Volatility: 60-candle annualized × √15                     │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  PHASE 3: PROBABILITY ENGINE                                            │     │
│  │  • TA Direction Score: 6 indicators → rawUp probability                │     │
│  │  • Volatility-Implied: Φ(z) with fat-tail dampening                    │     │
│  │  • Time Decay: S-curve adjustment (early/mid/late)                     │     │
│  │  • Blend: 50% vol + 50% TA                                            │     │
│  │  • Adjustments: Binance lead ±2%, orderbook ±2%                       │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  PHASE 4: MARKET REGIME DETECTION                                       │     │
│  │  • detectRegime() → TREND_UP / TREND_DOWN / CHOP / RANGE              │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  PHASE 5: EDGE COMPUTATION                                              │     │
│  │  • edge = modelProb - marketPrice                                     │     │
│  │  • Adjust for orderbook imbalance, spread, fees                       │     │
│  │  • Detect arbitrage (sum < 0.98), high vig (sum > 1.04)               │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  PHASE 6: TRADING DECISION                                              │     │
│  │  • decide() → ENTER or NO_TRADE                                        │     │
│  │  • Checks: Edge threshold, minProb, confidence, overconfidence         │     │
│  │  • Result: {action, side, strength, edge, confidence}                  │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ├── NO_TRADE ──► Skip to next market                                       │
│    │                                                                             │
│    ├── ENTER ──► ┌──────────────────────────────────────────────────────┐        │
│    │             │  ADD TO CANDIDATES                                    │        │
│    │             │  candidates.push({market, side, edge, confidence})   │        │
│    │             └──────────────────────────────────────────────────────┘        │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  FILTER & SORT CANDIDATES                                               │     │
│  │  • Filter: Valid price, timing OK                                      │     │
│  │  • Sort: Edge DESC, rawSum ASC                                        │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  EXECUTE TRADES                                                         │     │
│  │  FOR EACH candidate:                                                   │     │
│  │  • Paper: Record trade, settle at window end                          │     │
│  │  • Live: Submit FOK or GTD order via CLOB API                         │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  EMIT STATE SNAPSHOT                                                    │     │
│  │  • botEvents.emit('state:snapshot', state)                            │     │
│  │  • WebSocket broadcast to frontend                                     │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  SLEEP(pollIntervalMs)                                                 │     │
│  │  • Wait 1 second before next iteration                                 │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    └──────► Loop back to START                                               │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Trading Decision Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        TRADING DECISION FLOW (decide())                         │
│                                                                                 │
│  INPUT: {edgeUp, edgeDown, modelUp, modelDown, regime, phase, ...}              │
│                                                                                 │
│  START                                                                           │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  GUARD: NaN/Infinity Check                                               │     │
│  │  IF modelUp/modelDown/edgeUp/edgeDown IS NOT finite → NO_TRADE          │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Market Data Available                                           │     │
│  │  IF market prices ARE null → NO_TRADE                                  │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Skip Markets Config                                            │     │
│  │  IF market IN skipMarkets[] → NO_TRADE                                 │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  DETERMINE BEST SIDE                                                    │     │
│  │  bestSide = edgeUp > edgeDown ? UP : DOWN                              │     │
│  │  bestEdge = max(edgeUp, edgeDown)                                       │     │
│  │  bestModel = bestSide === UP ? modelUp : modelDown                     │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CALCULATE EFFECTIVE THRESHOLD                                          │     │
│  │  baseThreshold = phase-based (EARLY: 0.06, MID: 0.08, LATE: 0.10)     │     │
│  │  marketMultiplier = market-specific (default: 1.0)                     │     │
│  │  regimeMultiplier = regime-based (CHOP: 1.4, RANGE: 1.0,              │     │
│  │                              TREND_ALIGNED: 0.8, TREND_OPPOSED: 1.3)   │     │
│  │  threshold = baseThreshold × marketMultiplier × regimeMultiplier       │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Edge Threshold                                                  │     │
│  │  IF bestEdge < threshold → NO_TRADE                                    │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  EDGE-BASED PROBABILITY FLOOR (NEW)                                     │     │
│  │  probAdjustment = edge > 0.15 ? 0.1 : edge > 0.1 ? 0.05 : 0            │     │
│  │  adjustedMinProb = max(0.4, minProb - probAdjustment)                  │     │
│  │  IF bestModel < adjustedMinProb → NO_TRADE                              │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  OVERCONFIDENCE PROTECTION                                              │     │
│  │  IF bestEdge > HARD_CAP (0.40) → NO_TRADE                              │     │
│  │  IF bestEdge > SOFT_CAP (0.25):                                        │     │
│  │    penalizedThreshold = threshold × 1.4                                │     │
│  │    IF bestEdge < penalizedThreshold → NO_TRADE                         │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  COMPUTE CONFIDENCE SCORE                                               │     │
│  │  5 factors weighted:                                                   │     │
│  │  • Indicator Alignment (25%)                                           │     │
│  │  • Volatility Score (15%)                                              │     │
│  │  • Orderbook Score (15%)                                               │     │
│  │  • Timing Score (25%)                                                  │     │
│  │  • Regime Score (20%)                                                  │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Confidence Threshold                                            │     │
│  │  IF confidence < minConfidence (0.5) → NO_TRADE                        │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  DETERMINE STRENGTH                                                     │     │
│  │  IF confidence >= 0.75 AND edge >= 0.15 → STRONG                       │     │
│  │  ELSE IF confidence >= 0.5 AND edge >= 0.08 → GOOD                     │     │
│  │  ELSE → OPTIONAL                                                       │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  RETURN ENTER                                                           │     │
│  │  {                                                                    │     │
│  │    action: "ENTER",                                                   │     │
│  │    side: bestSide,                                                    │     │
│  │    phase, regime, strength, edge, confidence                          │     │
│  │  }                                                                    │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Probability Engine

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     PROBABILITY ENGINE (probability.ts)                        │
│                                                                                 │
│  INPUT: Technical indicators, price data, volatility, time remaining            │
│                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  STEP 1: TA DIRECTION SCORE (scoreDirection)                           │     │
│  │                                                                         │     │
│  │  UP Scoring:                                                            │     │
│  │  • price > vwap           → +2                                         │     │
│  │  • vwapSlope > 0           → +2                                         │     │
│  │  • RSI > 55 AND slope > 0  → +2                                         │     │
│  │  • MACD hist > 0 AND delta > 0 → +2                                    │     │
│  │  • MACD > 0                → +1                                         │     │
│  │  • HA green >= 2           → +1                                         │     │
│  │  • Failed VWAP reclaim     → +3 (DOWN only)                            │     │
│  │                                                                         │     │
│  │  DOWN Scoring: (mirror conditions)                                     │     │
│  │                                                                         │     │
│  │  rawUp = upScore / (upScore + downScore)                               │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  STEP 2: VOLATILITY-IMPLIED PROB (computeVolatilityImpliedProb)        │     │
│  │                                                                         │     │
│  │  d = ln(currentPrice / priceToBeat)                                    │     │
│  │  z = d / (volatility15m × √(timeLeftMin / 15))                         │     │
│  │  rawProb = Φ(z)  // Standard normal CDF                                │     │
│  │                                                                         │     │
│  │  FAT-TAIL DAMPENING (crypto adjustment):                                │     │
│  │  • IF |z| > 3: dampen to 0.7, cap at 85%                               │     │
│  │  • IF |z| > 2: dampen to 0.8, cap at 90%                               │     │
│  │  • ELSE: use rawProb                                                   │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  STEP 3: TIME DECAY (applyAdaptiveTimeDecay)                           │     │
│  │                                                                         │     │
│  │  linearDecay = timeLeftMin / 15                                        │     │
│  │                                                                         │     │
│  │  S-CURVE REGIONS:                                                       │     │
│  │  • EARLY (linearDecay > 0.6):  95%-100% preserve signal               │     │
│  │  • MID (0.3 < linearDecay ≤ 0.6): smoothstep 50%-95%                 │     │
│  │  • LATE (linearDecay ≤ 0.3): aggressive quadratic 0%-50%              │     │
│  │                                                                         │     │
│  │  VOLATILITY ADJUSTMENT:                                                 │     │
│  │  • volPct > 0.8%: effectiveRemaining × 1.2 (high vol = more time)     │     │
│  │  • volPct < 0.3%: effectiveRemaining × 0.8 (low vol = less time)      │     │
│  │                                                                         │     │
│  │  adjustedUp = 0.5 + (rawUp - 0.5) × timeDecay                          │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  STEP 4: BLEND (blendProbabilities)                                    │     │
│  │                                                                         │     │
│  │  blendedUp = 0.5 × volImpliedUp + 0.5 × taRawUp                        │     │
│  │                                                                         │     │
│  │  ADJUSTMENTS:                                                           │     │
│  │  • Binance lead ±0.02 (if price diverges > 0.1%)                      │     │
│  │  • Orderbook imbalance ±0.02 (if |imbalance| > 0.2)                   │     │
│  │                                                                         │     │
│  │  finalUp = clamp(blendedUp + adjustments, 0.01, 0.99)                  │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  OUTPUT: modelUp, modelDown                                                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Market Regime Detection

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                  MARKET REGIME DETECTION (regime.ts)                           │
│                                                                                 │
│  INPUT: price, vwap, vwapSlope, volumeRecent, volumeAvg, vwapCrossCount         │
│                                                                                 │
│  START                                                                           │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Data Missing?                                                    │     │
│  │  IF ANY INPUT IS null → RETURN CHOP                                     │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Low Volume?                                                      │     │
│  │  lowVolume = volumeRecent < 0.6 × volumeAvg                             │     │
│  │  IF lowVolume AND |price - vwap| / vwap < 0.1% → RETURN CHOP           │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Trend UP                                                         │     │
│  │  IF price > vwap AND vwapSlope > 0 → RETURN TREND_UP                   │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Trend DOWN                                                       │     │
│  │  IF price < vwap AND vwapSlope < 0 → RETURN TREND_DOWN                 │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: CHOP (frequent VWAP crosses)                                    │     │
│  │  IF vwapCrossCount >= 3 (in 20-candle window) → RETURN CHOP            │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  DEFAULT: RANGE                                                           │     │
│  │  RETURN RANGE                                                             │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
│  REGIME MULTIPLIERS:                                                            │
│  ┌──────────────────┬────────────────────────────────────────────────┐         │
│  │ REGIME           │ THRESHOLD MULTIPLIER                             │         │
│  ├──────────────────┼────────────────────────────────────────────────┤         │
│  │ CHOP             │ 1.4 (40% penalty - high risk)                  │         │
│  │ RANGE            │ 1.0 (standard)                                  │         │
│  │ TREND_ALIGNED    │ 0.8 (25% discount - trade with trend)           │         │
│  │ TREND_OPPOSED    │ 1.3 (30% penalty - fade the move)              │         │
│  └──────────────────┴────────────────────────────────────────────────┘         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Order Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      ORDER EXECUTION FLOW (trader.ts)                           │
│                                                                                 │
│  INPUT: {action, side, market, phase, strength, confidence, ...}                │
│                                                                                 │
│  START                                                                           │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK: Action = ENTER?                                                 │     │
│  │  IF action ≠ "ENTER" → ABORT                                            │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  CHECK MODE                                                              │     │
│  │  • Paper mode OR Live mode?                                             │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ├── PAPER ──► ┌──────────────────────────────────────────────────────┐        │
│    │             │  PAPER ORDER EXECUTION                                │        │
│    │             │  1. Apply limit discount                              │        │
│    │             │     price = max(0.01, marketPrice - limitDiscount)   │        │
│    │             │  2. Validate price range [0.02, 0.98]                │        │
│    │             │  3. Record to database (paper_trades table)           │        │
│    │             │  4. Emit trade:executed event                         │        │
│    │             │  5. Trade settles at window boundary                 │        │
│    │             │     IF finalPrice > PTB: UP wins                      │        │
│    │             │     ELSE: DOWN wins (Polymarket rules)               │        │
│    │             └──────────────────────────────────────────────────────┘        │
│    │                                                                             │
│    ├── LIVE ──► ┌───────────────────────────────────────────────────────┐        │
│    │             │  LIVE ORDER EXECUTION                                 │        │
│    │             │  1. Validate ClobClient & wallet                     │        │
│    │             │  2. CHECK daily loss limit                           │        │
│    │             │     IF todayPnl < -dailyMaxLossUsdc → ABORT          │        │
│    │             │  3. SELECT ORDER TYPE:                                │        │
│    │             │     • LATE + HIGH confidence → FOK                   │        │
│    │             │     • EARLY / MID → GTD post-only                   │        │
│    │             │  4. CALCULATE dynamic expiry:                         │        │
│    │             │     minExpiry = max(10s, timeLeft × 0.5)             │        │
│    │             │  5. SUBMIT order via CLOB API                         │        │
│    │             │  6. REGISTER heartbeat monitoring (poll every 5s)    │        │
│    │             │  7. ORDER MANAGER polls status:                       │        │
│    │             │     placed → live → matched/filled/cancelled/expired │        │
│    │             └───────────────────────────────────────────────────────┘        │
│    │                                                                             │
│    ▼                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │  HEARTBEAT MONITORING (Live GTD orders only)                            │     │
│  │  • Runs every 5 seconds                                               │     │
│  │  • Checks order status via CLOB API                                   │     │
│  │  • After 3 consecutive failures:                                      │     │
│  │    - Stop live trading                                                │     │
│  │    - Exponential backoff reconnect (max 5 attempts)                   │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│    │                                                                             │
│    ▼                                                                             │
│  OUTPUT: Order executed / Trade recorded                                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Data Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         DATA PIPELINE (index.ts → processMarket)                │
│                                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                    PHASE 1: DATA COLLECTION                             │     │
│  │                                                                         │     │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │     │
│  │  │  Binance    │    │ Polymarket  │    │ Chainlink   │                │     │
│  │  │             │    │             │    │             │                │     │
│  │  │ REST: 240   │    │ Gamma API   │    │ RPC Call    │                │     │
│  │  │ candles     │    │ Market data │    │ On-chain    │                │     │
│  │  │ (60s cache) │    │ (30s cache) │    │ (2s min)    │                │     │
│  │  │             │    │             │    │             │                │     │
│  │  │ WS: Tick    │    │ WS: Live    │    │ WS: Events  │                │     │
│  │  │ prices      │    │ Chainlink   │    │ AnswerUpd   │                │     │
│  │  │ (stream)    │    │ (stream)    │    │ (stream)    │                │     │
│  │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                │     │
│  └─────────┼──────────────────┼───────────────────┼───────────────────────┘     │
│            │                  │                   │                             │
│            ▼                  ▼                   ▼                             │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                    PRICE SOURCE FALLBACK CHAIN                         │     │
│  │                                                                         │     │
│  │  1. Binance WebSocket (real-time ticks) ──────────────┐                │     │
│  │                                                        │ Preferred      │     │
│  │  2. Polymarket WebSocket (Chainlink feeds) ────────────┼────► USE       │     │
│  │                                                        │ First         │     │
│  │  3. Chainlink WebSocket (AnswerUpdated events) ────────┤ Available      │     │
│  │                                                        │               │     │
│  │  4. Chainlink RPC (on-chain price fallback) ───────────┤               │     │
│  │                                                        │               │     │
│  │  5. Binance REST (klines fallback) ────────────────────┘               │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                      │                                         │
│                                      ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                    PHASE 2: DATA QUALITY CHECKS                        │     │
│  │                                                                         │     │
│  │  • Validate price ranges (no zeros, no infinity)                       │     │
│  │  • Check data freshness (timestamps within acceptable windows)        │     │
│  │  • Verify market metadata (market ID, token IDs, condition ID)        │     │
│  │  • Detect stale data (fallback if cache expired)                       │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                      │                                         │
│                                      ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                    PHASE 3: TECHNICAL INDICATORS                       │     │
│  │                                                                         │     │
│  │  Raw Data → Indicators → Calculated Values                             │     │
│  │                                                                         │     │
│  │  • OHLCV candles → Heiken Ashi → HA color + consecutive              │     │
│  │  • Price series → RSI(14) → RSI + slope                               │     │
│  │  • Price series → MACD(12,26,9) → MACD + histogram + delta           │     │
│  │  • Price + volume → VWAP → VWAP + slope                                │     │
│  │  • Price returns → Realized Vol → vol15m × √15                         │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                      │                                         │
│                                      ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                    PHASE 4: DATA AGGREGATION                           │     │
│  │                                                                         │     │
│  │  MarketSnapshot = {                                                    │     │
│  │    • id, label                                                          │     │
│  │    • spotPrice, currentPrice, priceToBeat                              │     │
│  │    • marketUp, marketDown, rawSum                                      │     │
│  │    • modelUp, modelDown (from probability engine)                      │     │
│  │    • edgeUp, edgeDown, effectiveEdge* (from edge engine)              │     │
│  │    • All indicators: haColor, rsi, macd, vwapSlope, volatility15m     │     │
│  │    • regime (from regime detection)                                    │     │
│  │    • action, side, strength, reason (from decision)                    │     │
│  │    • timeLeftMin, phase                                                │     │
│  │    • blendSource, binanceChainlinkDelta, orderbookImbalance            │     │
│  │  }                                                                     │     │
│  └────────────────────────────────────────────────────────────────────────┘     │
│                                      │                                         │
│                                      ▼                                         │
│  OUTPUT: Market snapshot → State manager → WebSocket → Dashboard              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Legend

- **◉** Decision point
- **→** Data flow
- **┈** Parallel execution
- **[ ]** Data storage
- **⚙** Processing/Computation
- **📡** External API/WebSocket
- **💾** Database

---

## Summary

The Orakel trading system processes 4 markets (BTC, ETH, SOL, XRP) every 1 second through:

1. **Data Collection**: 8 parallel data sources with fallback chains
2. **Technical Analysis**: 5 indicators (HA, RSI, MACD, VWAP, Volatility)
3. **Probability Engine**: Volatility-implied + TA blended with time decay
4. **Regime Detection**: TREND_UP/DOWN, CHOP, or RANGE
5. **Edge Computation**: Model probability vs market price with adjustments
6. **Trading Decision**: 17 sequential checks (edge, prob, confidence, etc.)
7. **Order Execution**: Paper (simulated) or Live (CLOB API)
8. **State Broadcasting**: WebSocket updates to dashboard

All trades respect 15-min window boundaries with cycle-aware state transitions.
