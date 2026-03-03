# Trading Strategy

This document details the complete trading strategy of the Orakel automated trading bot, covering probability estimation, edge calculation, market regime detection, confidence scoring, and all formulas and thresholds for decision logic.

---

## 1. Strategy Overview

The system uses a three-engine architecture, executing a complete decision cycle every second for each market, trading on Polymarket 15-minute cryptocurrency Up/Down markets.

**Three-Engine Architecture:**

- **Probability Engine** (`src/engines/probability.ts`): Fuses technical analysis scoring with volatility-implied probability, outputs model's probability estimates for UP/DOWN
- **Market Regime Engine** (`src/engines/regime.ts`): Detects current market state (trend/ranging/choppy), adjusts decision thresholds
- **Edge Engine** (`src/engines/edge.ts`): Calculates the difference (edge) between model probability and market price, combines with confidence score to output final trading decision

**Execution Cycle:** Every 1 second / per market, based on 15-minute window data

---

## 2. Probability Engine (src/engines/probability.ts)

### 2.1 Technical Analysis Scoring (scoreDirection)

Accumulates scores from 6 indicators for UP and DOWN directions separately, finally calculating raw directional probability.

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

### 2.2 Volatility-Implied Probability (computeVolatilityImpliedProb)

Adopts a Black-Scholes-style framework, calculating the probability that price will exceed target at window end based on relationship between current price and target price (priceToBeat), combined with remaining time and volatility.

**Core Formula:**

```
d = ln(currentPrice / priceToBeat)
z = d / (volatility15m * sqrt(timeLeftMin / 15))
rawProb = Phi(z)   // Standard normal cumulative distribution function
```

**Fat-Tail Dampening (crypto adjustment):**

Cryptocurrency markets have fatter tails than normal distribution, need to suppress extreme z values:

- `|z| > 3`: Dampening factor 0.7, probability capped at 85%
- `|z| > 2`: Dampening factor 0.8, probability capped at 90%
- `|z| <= 2`: Use raw probability, no adjustment

### 2.3 Time Decay (S-Curve Decay)

As window remaining time decreases, technical signal predictive power declines, need to shrink raw probability toward 0.5. Decay function has three intervals:

**Linear Decay Baseline:**

```
linearDecay = timeLeftMin / 15
```

**S-Curve Regions:**

| Region | Condition | Time Remaining | Time Decay Value |
|--------|-----------|-----------------|------------------|
| EARLY | linearDecay > 0.6 | >10 min | 95%-100% (preserve signal) |
| MID | 0.3 < linearDecay <= 0.6 | 5-10 min | smoothstep smooth interpolation 50%-95% |
| LATE | linearDecay <= 0.3 | <5 min | Aggressive quadratic decay 0%-50% |

**Application Formula:**

```
adjustedUp = 0.5 + (rawUp - 0.5) * timeDecay
```

**Adaptive Volatility Adjustment:**

High volatility environments have faster price movement, equivalent to having more time; low volatility is opposite:

- `volPct > 0.8%`: `effectiveRemaining * 1.2` (high volatility = equivalent more time)
- `volPct < 0.3%`: `effectiveRemaining * 0.8` (low volatility = equivalent less time)

### 2.4 Probability Blending (blendProbabilities)

Blends volatility-implied probability with technical analysis scoring at equal weights:

**Default Blending Formula (50% each):**

```
blendedUp = 0.5 * volImpliedUp + 0.5 * taRawUp
```

**Adjustments:**

- **Binance Lead Signal**: If Binance price leads Polymarket by more than 0.1%, corresponding direction ±2%
- **Orderbook Imbalance**: If `|imbalance| > 0.2`, corresponding direction ±2%

**Final Clamp:**

```
finalUp = clamp(blendedUp + adjustments, 0.01, 0.99)
```

---

## 3. Market Regime Engine (src/engines/regime.ts)

### 3.1 Regime Classification Decision Tree

```
IF data missing → CHOP
IF lowVolume AND |price - vwap| / vwap < 0.1% → CHOP
IF price > vwap AND vwapSlope > 0 → TREND_UP
IF price < vwap AND vwapSlope < 0 → TREND_DOWN
IF vwapCrossCount >= 3 (within 20 candle window) → CHOP
DEFAULT → RANGE
```

**Volume Check:**

```
lowVolume = volumeRecent < 0.6 * volumeAvg
```

### 3.2 Four Market Regimes

| Regime | Characteristics | Trading Implications |
|--------|----------------|----------------------|
| TREND_UP | Price above VWAP, VWAP slope rising | Favor UP trades, lower threshold with trend |
| TREND_DOWN | Price below VWAP, VWAP slope falling | Favor DOWN trades, lower threshold with trend |
| RANGE | Price oscillates around VWAP, no clear trend | Neutral, use standard thresholds |
| CHOP | Frequent VWAP crosses, or low volume | High risk, raise thresholds or prohibit trading |

---

## 4. Edge Engine (src/engines/edge.ts)

### 4.1 Edge Calculation (computeEdge)

Edge measures the difference between model probability and market quote, is the core indicator of whether a trade has positive expected value.

**Base Edge:**

```
edgeUp   = modelUp   - marketUp
edgeDown = modelDown - marketDown
```

**Orderbook Slippage Adjustment:**

- `|imbalance| > 0.2`: `penalty = |imbalance| * 0.02`
- `spread > 0.02`: `penalty = (spread - 0.02) * 0.5`

**Fee Deduction:**

Deduct estimated Polymarket taker fee from edge:

```
fee = 0.25 * (p * (1 - p))^2 * (1 - makerRebate)
```

**Arbitrage/Vig Detection:**

- `rawSum < 0.98`: Arbitrage opportunity exists (UP + DOWN quotes sum below 1)
- `rawSum > 1.04`: Vig too high, skip this market

### 4.2 Overconfidence Protection

When model probability is too high, may indicate model overfitting or data anomaly, needs additional protection:

- **Soft cap 0.25**: Requires threshold increased by 40% (`threshold * 1.4`)
- **Hard cap 0.40**: Directly reject trade (model may be seriously inaccurate)

---

## 5. Confidence Scoring (computeConfidence)

Confidence score combines 5 factors, weighted calculation of comprehensive confidence value in [0, 1] range.

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Indicator Alignment | 25% | Supporting indicators / Available indicators |
| Volatility Score | 15% | 0.3%-0.8% optimal → 1.0; 0.2%-0.3% or 0.8%-1.0% → 0.7; < 0.2% → 0.3; > 1.0% → 0.4 |
| Orderbook Score | 15% | Supports direction → 0.8-1.0; Opposes → 0.3; Neutral → 0.5 |
| Timing Score | 25% | modelProb >= 0.7 → 1.0; 0.6-0.7 → 0.8; 0.55-0.6 → 0.6; Other → 0.4 |
| Regime Score | 20% | Trend-aligned → 1.0; RANGE → 0.7; CHOP → 0.2; Trend-opposed → 0.3 |

**Confidence Levels:**

| Level | Condition |
|-------|-----------|
| HIGH | score >= 0.7 |
| MEDIUM | 0.5 <= score < 0.7 |
| LOW | score < 0.5 |

---

## 6. Trading Decision (decide)

### 6.1 Phase Thresholds

Three phases based on window remaining time, closer to settlement time requires higher edge and probability:

| Phase | Time Remaining | Edge Threshold | Min Probability |
|-------|----------------|----------------|-----------------|
| EARLY | > 10 min | 0.06 | 0.52 |
| MID | 5–10 min | 0.08 | 0.55 |
| LATE | < 5 min | 0.10 | 0.60 |

### 6.2 Market-Specific Multipliers

Currently all markets use uniform edge multiplier:

| Market | Edge Multiplier | Description |
|--------|----------------|-------------|
| BTC | 1.0x | Standard |
| ETH | 1.0x | Standard |
| SOL | 1.0x | Standard |
| XRP | 1.0x | Standard |

### 6.3 Regime Multipliers

Market regime affects effective edge threshold, trend-aligned trading lowers requirements, trend-opposed trading raises requirements:

| Regime | Direction | Multiplier | Description |
|--------|----------|------------|-------------|
| TREND_UP + UP | Aligned | 0.75 | Requires less edge |
| TREND_UP + DOWN | Opposed | 1.3 | Requires more edge |
| TREND_DOWN + DOWN | Aligned | 0.75 | Requires less edge |
| TREND_DOWN + UP | Opposed | 1.3 | Requires more edge |
| RANGE | Any | 1.0 | Standard threshold |
| CHOP | Any | 1.4 | Raise threshold; markets with win rate < 45% use REGIME_DISABLED=999 |

### 6.4 Complete Decision Flow

Decision function executes the following 17 sequential checks:

1. **NaN/Infinity model probability guard**: If modelUp or modelDown is NaN/Infinity → NO_TRADE
2. **NaN/Infinity edge guard**: If edgeUp or edgeDown is NaN/Infinity → NO_TRADE
3. **Market data availability check**: If market data is null → NO_TRADE
4. **skipMarkets config check**: If current market in skip list → NO_TRADE
5. **Determine best direction**: Compare edgeUp vs edgeDown, select direction with larger effective edge (UP or DOWN)
6. **Apply market-specific multiplier**: `effectiveThreshold = baseThreshold * marketMultiplier`
7. **Apply regime multiplier**: `effectiveThreshold = effectiveThreshold * regimeMultiplier`
8. **Regime disabled check**: If regime multiplier >= 999 (REGIME_DISABLED) → NO_TRADE
9. **Edge threshold check**: If `bestEdge < effectiveThreshold` → NO_TRADE
10. **Min probability check**: If `modelProb < minProb` → NO_TRADE
11. **Overconfidence hard cap check**: If `bestEdge > 0.40` → NO_TRADE (model may be seriously inaccurate)
12. **Overconfidence soft cap check**: If `bestEdge > 0.25` → Use penalized threshold (`threshold * 1.4`) to re-check
13. **Calculate confidence score**: Call computeConfidence, weighted 5-factor score
14. **Confidence threshold check**: If `confidence < minConfidence` → NO_TRADE
15. **Determine trade strength**:
    - STRONG: `confidence >= 0.75` and `edge >= 0.15`
    - GOOD: `confidence >= 0.5` and `edge >= 0.08`
    - OPTIONAL: Other cases
16. **Return ENTER**: Carrying direction (side), strength, edge value, confidence score

---

## 7. Order Execution

### Paper Mode

1. Apply limit discount: `price = max(0.01, marketPrice - limitDiscount)`
2. Validate price range: `[0.02, 0.98]`
3. Record to database, emit event

### Live Mode

**Order Type Selection:**

- **LATE phase + HIGH confidence**: Use FOK (Fill-or-Kill, immediate full fill or cancel)
- **EARLY / MID phase**: Use GTD (Good-Till-Date) Post-Only limit order
  - Dynamic expiry: Min 10 seconds, max 50% of remaining window time
  - Post-only guarantees maker execution, enjoys 20% fee rebate

### Settlement (Paper Mode)

| Settlement Condition | Result | P&L Calculation |
|---------------------|--------|-----------------|
| finalPrice > PTB | UP wins | Profit: `+size * (1 - buyPrice)` |
| finalPrice < PTB | DOWN wins | Profit: `+size * (1 - buyPrice)` |
| finalPrice = PTB | DOWN wins (Polymarket rules) | Loss: `-size * buyPrice` |
| Holding side fails | Loss | `-size * buyPrice` |

---

## 8. Risk Management

| Risk Control Rule | Description |
|-------------------|-------------|
| Daily loss limit | If `todayPnl < -dailyMaxLossUsdc`, stop all trading for the day |
| Max drawdown | If drawdown >= 50% of initial balance, stop trading |
| Max positions | Maximum simultaneous positions per mode (paper/live): `maxOpenPositions` |
| Max trades per window | Maximum trades per 15-minute window per market: `maxTradesPerWindow` |
| Global max trades per window | Maximum trades per window across all markets: `maxGlobalTradesPerWindow` |
| Rate limit window | Live orders use 16-minute trimmed window for rate limiting |

---

## 9. Example Trading Decision

Following is a complete decision flow demonstration through a specific case.

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

**Conclusion:** Strong technical indicators combined with trend-aligned regime result in successful entry. If confidence were low or edge were smaller, trade would be rejected.
