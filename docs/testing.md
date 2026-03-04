# Testing Documentation

This document outlines the test coverage and test file organization for the Orakel project.

---

## Table of Contents

1. [Test Overview](#1-test-overview)
2. [Core Trading Engines](#2-core-trading-engines)
3. [Technical Indicators](#3-technical-indicators)
4. [Data Processing](#4-data-processing)
5. [Blockchain Integration](#5-blockchain-integration)
6. [Running Tests](#6-running-tests)

---

## 1. Test Overview

### Test File Statistics

| Category | Test Files | Test Count |
|----------|------------|------------|
| Core Trading Engines | 3 | 105 |
| Trading Layer | 3 | 14 |
| Technical Indicators | 4 | 91 |
| Data Processing | 3 | 71 |
| Blockchain Integration | 4 | 32 |
| **Total** | **17** | **313** |

_Note: Test count may vary slightly as tests are added/updated._

### Test Organization Structure

```
src/
└── __tests__/              # All test files (centralized, flat structure)
    ├── probability.test.ts
    ├── edge.test.ts
    ├── arbitrage.test.ts
    ├── accountStats.test.ts
    ├── orderManager.test.ts
    ├── liveGuards.test.ts
    ├── liveSettler.test.ts
    ├── rsi.test.ts
    ├── macd.test.ts
    ├── vwap.test.ts
    ├── heikenAshi.test.ts
    ├── polymarket.test.ts
    ├── chainlinkWs.test.ts
    ├── cache.test.ts
    ├── accountState.test.ts
    ├── reconciler.test.ts
    ├── contracts.test.ts
    └── redeemer.test.ts
```
---

## 2. Core Trading Engines

### 2.1 Probability Engine ([probability.test.ts](../src/__tests__/probability.test.ts))

**Test Functions:**
- `scoreDirection()` - Technical direction scoring
- `computeVolatilityImpliedProb()` - Volatility-implied probability
- `blendProbabilities()` - Probability blending
- `applyAdaptiveTimeDecay()` - Time decay

**Covered Scenarios:**
- VWAP relationship (above/below/neutral)
- VWAP slope (rising/falling/flat)
- RSI extremes (overbought/oversold/neutral)
- MACD histogram (positive/negative/zero)
- Heiken Ashi colors and consecutive counts
- Failed VWAP reclaim detection

**Test Count:** 36

### 2.2 Edge Engine ([edge.test.ts](../src/__tests__/edge.test.ts))

**Test Functions:**
- `computeConfidence()` - Confidence calculation (5 factors)
- `computeEdge()` - Edge calculation
- `decide()` - Trading decision logic

**Covered Scenarios:**
- Confidence factor weight verification
- Orderbook imbalance adjustments
- Arbitrage detection (sum < 0.98)
- High vig detection (sum > 1.04)
- Market regime multiplier application

**Test Count:** 48

### 2.3 Arbitrage Detection ([arbitrage.test.ts](../src/__tests__/arbitrage.test.ts))

**Test Functions:**
- `detectArbitrage()` - UP/DOWN price arbitrage detection

**Covered Scenarios:**
- Valid arbitrage opportunity (sum < 0.98)
- No arbitrage (sum >= 0.98)
- Zero price protection
- Confidence calculation
- Timestamp generation

**Test Count:** 21

---

## 3. Technical Indicators

### 3.1 RSI Indicator ([rsi.test.ts](../src/__tests__/rsi.test.ts))

**Test Functions:**
- `sma()` - Simple Moving Average
- `slopeLast()` - Slope calculation
- `computeRsi()` - RSI(14)

**Covered Scenarios:**
- SMA basic calculation
- Slope direction
- RSI extremes (overbought/oversold)
- RSI neutral range

**Test Count:** 36

### 3.2 MACD Indicator ([macd.test.ts](../src/__tests__/macd.test.ts))

**Test Functions:**
- `computeMacd()` - MACD(12,26,9)

**Covered Scenarios:**
- Full MACD calculation
- Zero histogram protection

**Test Count:** 13

### 3.3 Heiken Ashi ([heikenAshi.test.ts](../src/__tests__/heikenAshi.test.ts))

**Test Functions:**
- `computeHeikenAshi()` - HA candle calculation
- `countConsecutive()` - Consecutive counting

**Covered Scenarios:**
- HA candle colors (red/green)
- Consecutive count logic

**Test Count:** 25

### 3.4 VWAP Indicator ([vwap.test.ts](../src/__tests__/vwap.test.ts))

**Test Functions:**
- `computeSessionVwap()` - Session VWAP
- `computeVwapSeries()` - VWAP series

**Covered Scenarios:**
- Session VWAP calculation
- VWAP series slope
- Slope direction classification

**Test Count:** 17

---

## 4. Data Processing

### 4.1 Polymarket Data ([polymarket.test.ts](../src/__tests__/polymarket.test.ts))

**Test Functions:**
- `pickLatestLiveMarket()` - Select latest market
- `flattenEventMarkets()` - Flatten event markets
- `getPriceToBeat()` - Get price benchmark

**Covered Scenarios:**
- Multi-market selection
- Event market flattening
- Price benchmark retrieval

**Test Count:** 51

### 4.2 Chainlink Data ([chainlinkWs.test.ts](../src/__tests__/chainlinkWs.test.ts))

**Test Functions:**
- `hexToSignedBigInt()` - Hex to signed integer conversion

**Covered Scenarios:**
- Positive number conversion
- Negative number conversion (MSB is 1)
- Zero value

**Test Count:** 15

### 4.3 Cache ([cache.test.ts](../src/__tests__/cache.test.ts))

**Test Functions:**
- `createTtlCache()` - TTL cache

**Covered Scenarios:**
- Basic get/set/delete
- TTL expiration
- Hit rate tracking

**Test Count:** 5

---

## 5. Blockchain Integration

### 5.1 Account State ([accountState.test.ts](../src/__tests__/accountState.test.ts))

**Test Functions:**
- `initAccountState()` - Initialize account state
- `updateFromSnapshot()` - Update from snapshot
- `applyEvent()` - Apply on-chain event
- `enrichPosition()` - Position enrichment
- `resetAccountState()` - Reset state

**Covered Scenarios:**
- USDC balance updates
- CTF token position tracking
- On-chain event application (transfer, batch transfer)
- Position enrichment
- Account summary retrieval

**Test Count:** 9

### 5.2 Reconciliation Logic ([reconciler.test.ts](../src/__tests__/reconciler.test.ts))

**Test Functions:**
- `statusFromConfidence()` - Confidence to reconciliation status
- `rawToUsdc()` - Token raw value to USDC
- `isEventRow()` - Event row type check
- `isKnownTokenRow()` - Known token row type check
- `isTradeRow()` - Trade row type check

**Covered Scenarios:**
- Reconciliation status classification (confirmed/pending/unreconciled/contested)
- Token amount conversion (different decimals)
- Database row type verification

**Test Count:** 17

### 5.3 Contract Constants ([contracts.test.ts](../src/__tests__/contracts.test.ts))

**Test Functions:**
- Contract address verification
- Token precision constants

**Covered Scenarios:**
- CTF contract address format
- USDC-E contract address format
- USDC precision (6 decimals)

**Test Count:** 5

---

## 6. Running Tests

### 6.1 Run All Tests

```bash
bun run test
```

**Current Results:**
```
✓ 17 passed (313 tests)
Duration: ~500ms

### 6.2 Watch Mode

```bash
bun run test:watch
```

### 6.3 Run Single Test File

```bash
bunx vitest run src/__tests__/edge.test.ts
```

### 6.4 Run Matching Tests

```bash
bunx vitest run -t "computeEdge"
```

### 6.5 Test Coverage

```bash
bunx vitest run --coverage
```

---

## 7. Test File List

| File | Category | Test Count | Description |
|------|----------|------------|-------------|
| `probability.test.ts` | Core Engine | 36 | Probability model, direction scoring, time decay |
| `edge.test.ts` | Core Engine | 48 | Edge calculation, confidence, trading decisions |
| `arbitrage.test.ts` | Core Engine | 21 | Arbitrage detection |
| `accountStats.test.ts` | Trading Layer | 6 | Account statistics tracking |
| `orderManager.test.ts` | Trading Layer | 2 | Live order lifecycle management |
| `liveGuards.test.ts` | Trading Layer | 4 | Live trading safety checks |
| `liveSettler.test.ts` | Trading Layer | 8 | Live trade settlement |
| `rsi.test.ts` | Indicators | 36 | RSI, SMA, slope |
| `macd.test.ts` | Indicators | 13 | MACD calculation |
| `heikenAshi.test.ts` | Indicators | 25 | HA candles, consecutive counts |
| `vwap.test.ts` | Indicators | 17 | VWAP series, slope |
| `polymarket.test.ts` | Data Processing | 51 | Polymarket data parsing |
| `chainlinkWs.test.ts` | Data Processing | 15 | Chainlink price conversion |
| `cache.test.ts` | Data Processing | 5 | TTL cache |
| `accountState.test.ts` | Blockchain | 9 | Account state management |
| `reconciler.test.ts` | Blockchain | 17 | Reconciliation logic, type checks |
| `contracts.test.ts` | Blockchain | 5 | Contract addresses, constants |
| `redeemer.test.ts` | Blockchain | 3 | Position redemption |

**Total: 17 files, 313 tests**
---

## 8. Testing Best Practices

### 8.1 Test Organization

All test files are centralized in `src/__tests__/` (flat structure, no subdirectories). Tests are organized by module category but kept in a single flat directory for simplicity.

### 8.2 Test Naming

- Use `describe` to group related tests
- Test naming: `should [expected] when [condition]`
- Use `describe` nesting for complex scenarios

### 8.3 Assertion Style

```typescript
// Recommended: specific assertions
expect(result).toBe(0.06);
expect(result).toBeCloseTo(0.5, 1);

// Avoid: generic assertions
expect(result).toBeTruthy();
```

### 8.4 Test Data

- Use fixed timestamps (like `BASE_NOW_MS`) to ensure reproducibility
- Test boundary values (0, null, extreme values)
- Test both normal and error paths

### 8.5 Blockchain Testing Considerations

- **Avoid database dependencies**: Extract pure utility functions to separate modules (like `reconciler-utils.ts`)
- **Use snake_case**: Database row types use snake_case property names
- **Type guards**: Type guards only check minimal required fields, don't do full validation
- **Test isolation**: Use `beforeEach`/`afterEach` to ensure state independence between tests

---

## 9. Related Documentation

- [Development & Deployment Guide](./deployment.md) — Test commands
- [System Architecture](./architecture.md) — Module relationships
- [Trading Strategy](./trading-strategy.md) — Strategy logic
