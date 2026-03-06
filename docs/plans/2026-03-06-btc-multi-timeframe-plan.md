# BTC Multi-Timeframe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor from multi-coin/single-window (BTC/ETH/SOL/XRP × 15m) to single-coin/multi-window (BTC × 5m/15m/1h/4h) with all timeframes running in parallel.

**Architecture:** Reuse the existing multi-market pipeline by redefining "market" from "one coin" to "one coin × one timeframe". Each timeframe is an independent market entry with its own `candleWindowMinutes`, Polymarket slug config, and resolution source. Shared WS streams are deduplicated by coin.

**Tech Stack:** Bun + TypeScript + Hono + SQLite backend, React 19 + Vite frontend. Biome for lint/format. Vitest for tests.

**Design doc:** `docs/plans/2026-03-06-btc-multi-timeframe-design.md`

**Validation commands:**
```bash
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
bun run test          # Vitest
```

---

## Phase 1: Data Model Foundation

### Task 1: Extend MarketConfig Type

**Files:**
- Modify: `src/types.ts:24-39`

**Step 1: Add new fields to MarketConfig interface**

Add `coin`, `candleWindowMinutes`, and `resolutionSource` fields:

```typescript
export interface MarketConfig {
	id: string;
	coin: string;
	label: string;
	candleWindowMinutes: number;
	resolutionSource: "chainlink" | "binance";
	binanceSymbol: string;
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

**Step 2: Run typecheck to see all breakages**

Run: `bun run typecheck 2>&1 | head -40`
Expected: Type errors in `src/core/markets.ts` (missing new fields on MARKETS entries). This is expected and we fix it in Task 2.

---

### Task 2: Rewrite MARKETS Array

**Files:**
- Modify: `src/core/markets.ts:7-72`

**Step 1: Replace the MARKETS array**

Remove all 4 coin entries. Replace with 4 BTC timeframe entries:

```typescript
export const MARKETS: MarketConfig[] = [
	{
		id: "BTC-5m",
		coin: "BTC",
		label: "Bitcoin 5m",
		candleWindowMinutes: 5,
		resolutionSource: "chainlink",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "10192", // TODO: verify 5m series ID via Gamma API
			seriesSlug: "btc-up-or-down-5m",
			slugPrefix: "btc-updown-5m-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
	{
		id: "BTC-15m",
		coin: "BTC",
		label: "Bitcoin 15m",
		candleWindowMinutes: 15,
		resolutionSource: "chainlink",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "10192",
			seriesSlug: "btc-up-or-down-15m",
			slugPrefix: "btc-updown-15m-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
	{
		id: "BTC-1h",
		coin: "BTC",
		label: "Bitcoin 1h",
		candleWindowMinutes: 60,
		resolutionSource: "binance",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "TBD", // TODO: determine from Gamma API
			seriesSlug: "bitcoin-up-or-down",
			slugPrefix: "bitcoin-up-or-down-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
	{
		id: "BTC-4h",
		coin: "BTC",
		label: "Bitcoin 4h",
		candleWindowMinutes: 240,
		resolutionSource: "chainlink",
		binanceSymbol: "BTCUSDT",
		polymarket: {
			seriesId: "TBD", // TODO: determine from Gamma API
			seriesSlug: "btc-up-or-down-4h",
			slugPrefix: "btc-updown-4h-",
		},
		chainlink: {
			aggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
			decimals: 8,
			wsSymbol: "btc",
		},
		pricePrecision: 0,
	},
];
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (markets now match new MarketConfig)

**Step 3: Commit**

```bash
git add src/types.ts src/core/markets.ts
git commit -m "refactor: extend MarketConfig with coin, candleWindowMinutes, resolutionSource; rewrite MARKETS for BTC multi-timeframe"
```

---

### Task 3: Remove Global candleWindowMinutes from Config

**Files:**
- Modify: `src/types.ts` — remove `candleWindowMinutes` from `AppConfig`
- Modify: `src/core/config.ts` — remove `candleWindowMinutes: 15` from CONFIG

**Step 1: Remove candleWindowMinutes from AppConfig interface**

In `src/types.ts`, find the `AppConfig` interface and remove the `candleWindowMinutes: number` field.

**Step 2: Remove from CONFIG object**

In `src/core/config.ts`, remove the `candleWindowMinutes: 15` line from the CONFIG object.

**Step 3: Fix all callers of CONFIG.candleWindowMinutes**

These files reference `CONFIG.candleWindowMinutes` and need to receive `market.candleWindowMinutes` instead. For now, add a temporary helper to avoid breaking everything at once:

In `src/core/config.ts`, add:
```typescript
/** @deprecated Use market.candleWindowMinutes instead. Temporary bridge during multi-timeframe migration. */
export const DEFAULT_CANDLE_WINDOW_MINUTES = 15;
```

Replace `CONFIG.candleWindowMinutes` with `DEFAULT_CANDLE_WINDOW_MINUTES` in these files (temporary — each will be fixed properly in later tasks):
- `src/index.ts` (lines 291, 337, 487, 772, 776, 782, 875)
- `src/trading/trader.ts` (lines 443, 550)
- `src/pipeline/compute.ts` (lines 39, 139)

**Step 4: Run typecheck + tests**

Run: `bun run typecheck && bun run test`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove global candleWindowMinutes from AppConfig, add deprecated bridge constant"
```

---

### Task 4: Per-Timeframe Strategy Config

**Files:**
- Modify: `src/core/config.ts` — strategy config resolution
- Modify: `src/types.ts` — StrategyConfig structure
- Modify: `config.json` — per-timeframe strategy sections

**Step 1: Update config.json structure**

```json
{
  "paper": { "risk": { ... }, "initialBalance": 1000 },
  "live": { "risk": { ... } },
  "strategy": {
    "default": {
      "edgeThresholdEarly": 0.05,
      "edgeThresholdMid": 0.1,
      "edgeThresholdLate": 0.2,
      "minProbEarly": 0.55,
      "minProbMid": 0.6,
      "minProbLate": 0.65,
      "maxGlobalTradesPerWindow": 4,
      "skipMarkets": []
    }
  }
}
```

The existing strategy values become the `"default"` key. Per-timeframe overrides (e.g. `"BTC-5m": { ... }`) can be added later.

**Step 2: Update config.ts to resolve strategy by market ID**

Add a function that looks up strategy by market ID with fallback to `"default"`:

```typescript
export function getStrategyForMarket(marketId: string): StrategyConfig {
	const perMarket = CONFIG._rawStrategy?.[marketId];
	const fallback = CONFIG.strategy;
	if (!perMarket) return fallback;
	return { ...fallback, ...perMarket };
}
```

Store the raw strategy map in CONFIG and keep `CONFIG.strategy` pointing to `"default"`.

**Step 3: Run typecheck + tests**

Run: `bun run typecheck && bun run test`
Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: support per-timeframe strategy config with default fallback"
```

---

## Phase 2: Engine Scaling

### Task 5: Proportional Phase Classification

**Files:**
- Modify: `src/engines/edge.ts:81`
- Modify: `src/__tests__/edge.test.ts`

**Step 1: Write test for proportional phase**

Add test cases in `src/__tests__/edge.test.ts` that verify phase classification works for different window sizes (5m, 60m, 240m). The function signature needs `windowMinutes` parameter.

**Step 2: Update phase classification in edge.ts**

Change from hardcoded minutes to proportional:

```typescript
// Before:
const phase: Phase = remainingMinutes > 10 ? "EARLY" : remainingMinutes > 5 ? "MID" : "LATE";

// After:
const ratio = remainingMinutes / windowMinutes;
const phase: Phase = ratio > 0.66 ? "EARLY" : ratio > 0.33 ? "MID" : "LATE";
```

The `decide()` function needs to receive `windowMinutes` as a parameter (from the market's config). Check the function signature and add the parameter.

**Step 3: Run tests**

Run: `bun run test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/engines/edge.ts src/__tests__/edge.test.ts
git commit -m "refactor: make phase classification proportional to window duration"
```

---

### Task 6: Scale Entry Timing Filter

**Files:**
- Modify: `src/index.ts:874-879`

**Step 1: Replace hardcoded 3-minute buffer**

```typescript
// Before:
const tl = r.timeLeftMin ?? 0;
const windowMin = CONFIG.candleWindowMinutes ?? 15;
const elapsed = windowMin - tl;
if (elapsed < 3) return false;
if (tl < 3) return false;

// After:
const tl = r.timeLeftMin ?? 0;
const windowMin = market.candleWindowMinutes;
const elapsed = windowMin - tl;
const buffer = Math.max(1, windowMin * 0.2);
if (elapsed < buffer) return false;
if (tl < buffer) return false;
```

Note: `market` must be available in this scope. Check how the filter closure accesses market data — it may need the market passed through `ProcessMarketResult`.

**Step 2: Run typecheck + tests**

Run: `bun run typecheck && bun run test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: scale entry timing buffer proportionally to window duration"
```

---

### Task 7: Parameterize Volatility Lookback

**Files:**
- Modify: `src/engines/probability.ts:68-84`
- Modify: `src/pipeline/compute.ts:108`

**Step 1: Change volatility lookback from hardcoded 60**

In `src/engines/probability.ts`, the `computeRealizedVolatility` function has `lookback = 60`. Update the caller in `src/pipeline/compute.ts` to pass a scaled value:

```typescript
// In compute.ts:
const volLookback = Math.max(30, market.candleWindowMinutes * 4);
const rv = computeRealizedVolatility(closes, volLookback);
```

The `computeRealizedVolatility` function already accepts `lookback` as a parameter — just change the call site.

**Step 2: Run tests**

Run: `bun run test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/pipeline/compute.ts
git commit -m "refactor: scale volatility lookback with window duration"
```

---

## Phase 3: Pipeline & Main Loop

### Task 8: Per-Market Timing in Main Loop

**Files:**
- Modify: `src/index.ts` — main loop timing

**Step 1: Replace single prevWindowStartMs with per-market map**

```typescript
// Before:
let prevWindowStartMs: number | null = null;

// After:
const prevWindowStartMs = new Map<string, number | null>();
```

**Step 2: Update window transition detection**

The main loop currently checks `if (prevWindowStartMs !== null && prevWindowStartMs !== timing.startMs)`. This needs to happen per-market inside the market processing loop:

```typescript
for (const market of markets) {
    const timing = getCandleWindowTiming(market.candleWindowMinutes);
    const prevStart = prevWindowStartMs.get(market.id) ?? null;

    if (prevStart !== null && prevStart !== timing.startMs) {
        // Window transition for THIS market
        const prices = collectLatestPrices([market], states);
        if (prices.size > 0) {
            paperAccount.resolveTrades(prevStart, prices);
            liveAccount.resolveTrades(prevStart, prices);
        }
    }

    prevWindowStartMs.set(market.id, timing.startMs);
}
```

**Step 3: Update resolveExpiredTrades calls**

Each call to `resolveExpiredTrades` needs the market's `candleWindowMinutes` instead of the global constant:

```typescript
// Pass per-market window minutes
paperAccount.resolveExpiredTrades(latestPrices, market.candleWindowMinutes);
liveAccount.resolveExpiredTrades(latestPrices, market.candleWindowMinutes);
```

**Step 4: Remove DEFAULT_CANDLE_WINDOW_MINUTES usages from index.ts**

Replace all remaining `DEFAULT_CANDLE_WINDOW_MINUTES` references with `market.candleWindowMinutes`.

**Step 5: Run typecheck + tests**

Run: `bun run typecheck && bun run test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/index.ts
git commit -m "refactor: per-market timing in main loop with independent window transitions"
```

---

### Task 9: Pass Market Context Through Pipeline

**Files:**
- Modify: `src/pipeline/fetch.ts` — pass market's candleWindowMinutes
- Modify: `src/pipeline/compute.ts` — receive market's candleWindowMinutes
- Modify: `src/trading/trader.ts` — use market's candleWindowMinutes

**Step 1: Update fetchMarketData to use market.candleWindowMinutes**

In `src/pipeline/fetch.ts`, the function already receives `MarketConfig`. Change timing calculation:

```typescript
// Before:
const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
// After:
const timing = getCandleWindowTiming(market.candleWindowMinutes);
```

**Step 2: Update compute pipeline**

In `src/pipeline/compute.ts`, replace `config.candleWindowMinutes` references with the market's value. The `computeSignal` function receives config — add `windowMinutes` to the parameters or read from market.

**Step 3: Update trader.ts**

In `src/trading/trader.ts`, replace `CONFIG.candleWindowMinutes` with market-specific timing.

**Step 4: Remove DEFAULT_CANDLE_WINDOW_MINUTES entirely**

Delete the deprecated constant from `src/core/config.ts`. Verify no remaining references.

**Step 5: Run typecheck + lint + tests**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: thread market.candleWindowMinutes through entire pipeline, remove deprecated bridge"
```

---

### Task 10: 1h Binance Resolution Source

**Files:**
- Modify: `src/pipeline/fetch.ts` — conditional price source
- Modify: `src/trading/accountStats.ts` — settlement price selection

**Step 1: Use resolutionSource for settlement price**

In the settlement logic, select the correct reference price based on `market.resolutionSource`:

```typescript
// For Chainlink markets: compare Chainlink price at window start vs end
// For Binance markets: compare Binance spot price (candle open vs close)
const settlementPrice = market.resolutionSource === "binance"
    ? spotPrice       // Binance BTCUSDT last price
    : currentPrice;   // Chainlink on-chain price
```

Verify this is applied in both `resolveTrades()` and `resolveExpiredTrades()`.

**Step 2: Run tests**

Run: `bun run test`
Expected: PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: support Binance resolution source for 1h market"
```

---

### Task 11: WS Stream Deduplication

**Files:**
- Modify: `src/index.ts` — WS stream setup

**Step 1: Deduplicate Binance WS connections**

Currently, the bot creates WS streams per market's `binanceSymbol`. With 4 markets all using `BTCUSDT`, deduplicate:

```typescript
const uniqueSymbols = [...new Set(markets.map((m) => m.binanceSymbol))];
// Pass uniqueSymbols to Binance WS setup instead of markets.map(m => m.binanceSymbol)
```

**Step 2: Deduplicate Chainlink WS connections**

Similarly deduplicate by `market.chainlink.wsSymbol`:

```typescript
const uniqueChainlinkSymbols = [...new Set(markets.map((m) => m.chainlink.wsSymbol))];
```

**Step 3: Run the bot briefly to verify streams work**

Run: `timeout 10 bun run start 2>&1 | tail -20` (or manual verification)
Expected: Only 1 Binance WS and 1 Chainlink WS connection logged.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "refactor: deduplicate WS streams by unique coin instead of per-market"
```

---

## Phase 4: Cleanup & Frontend

### Task 12: Delete ETH/SOL/XRP Code

**Files:**
- Modify: `src/api.ts:325,390` — remove hardcoded market arrays
- Modify: `src/core/env.ts` — update CHAINLINK_BTC_USD_AGGREGATOR
- Modify: `.env.example` — update ACTIVE_MARKETS default

**Step 1: Remove hardcoded ["BTC", "ETH", "SOL", "XRP"] from api.ts**

Replace with dynamic market ID list from `getActiveMarkets()`.

**Step 2: Update .env.example**

```
ACTIVE_MARKETS=BTC-5m,BTC-15m,BTC-1h,BTC-4h
```

**Step 3: Clean up CHAINLINK_BTC_USD_AGGREGATOR env var**

If only BTC, this can be removed (aggregator address lives in MARKETS config).

**Step 4: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove ETH/SOL/XRP references, update env defaults for multi-timeframe"
```

---

### Task 13: Rename 15m-Specific Functions

**Files:**
- Modify: `src/pipeline/fetch.ts:96` — `resolveCurrent15mMarket` → `resolveCurrentMarket`
- Modify: `src/data/polymarket.ts` — `filterBtcUpDown15mMarkets` → `filterMarketsBySlug`
- Modify: `src/__tests__/polymarket.test.ts` — update test names

**Step 1: Rename functions**

Use LSP rename or find-and-replace:
- `resolveCurrent15mMarket` → `resolveCurrentMarket`
- `filterBtcUpDown15mMarkets` → `filterMarketsBySlug`

**Step 2: Run tests**

Run: `bun run test`
Expected: PASS

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename 15m-specific functions to generic names"
```

---

### Task 14: Frontend Multi-Timeframe

**Files:**
- Modify: `web/src/pages/Trades.tsx:36`
- Modify: `web/src/components/analytics/OverviewTab.tsx:65`
- Modify: `web/src/lib/format.ts:33-35`

**Step 1: Update marketOrder arrays**

```typescript
// Before:
const marketOrder = ["BTC", "ETH", "SOL", "XRP"];

// After:
const marketOrder = ["BTC-5m", "BTC-15m", "BTC-1h", "BTC-4h"];
```

**Step 2: Update price formatting**

All markets are BTC — simplify `formatPrice` to use 0 decimal precision for all.

**Step 3: Build frontend**

Run: `cd web && bun run build`
Expected: PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): update dashboard for multi-timeframe BTC markets"
```

---

### Task 15: Update Tests

**Files:**
- Modify: `src/__tests__/edge.test.ts` — phase test for different windows
- Modify: `src/__tests__/polymarket.test.ts` — slug filter tests
- Modify: `src/__tests__/liveSettler.test.ts` — market ID format

**Step 1: Update test fixtures**

Update any test that references market IDs like `"BTC"`, `"ETH"` etc. to use `"BTC-15m"` format. Update mock MarketConfig objects to include the new fields.

**Step 2: Add tests for proportional phase**

Test that phase classification works correctly for 5m, 60m, 240m windows.

**Step 3: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "test: update test suite for multi-timeframe market IDs"
```

---

### Task 16: Final Validation

**Step 1: Run full CI pipeline locally**

```bash
bun run lint && bun run typecheck && bun run test
```

Expected: ALL PASS

**Step 2: Update README market table**

Replace the 4-coin table with the 4-timeframe table.

**Step 3: Update AGENTS.md if needed**

Reflect the new market structure.

**Step 4: Final commit**

```bash
git add -A
git commit -m "docs: update README and AGENTS.md for multi-timeframe architecture"
```

---

## Open Items (Post-Implementation)

- [ ] Determine `seriesId` for 5m, 1h, 4h Polymarket series via Gamma API
- [ ] Calibrate strategy thresholds per-timeframe (start with 15m defaults)
- [ ] Verify 1h slug pattern matching works with Gamma API queries
- [ ] Load-test with all 4 timeframes running simultaneously
- [ ] Monitor settlement correctness for 1h Binance resolution vs 5m/15m/4h Chainlink
