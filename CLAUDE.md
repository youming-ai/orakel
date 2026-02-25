# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orakel is a production-grade automated trading bot for Polymarket's 15-minute binary options (Up/Down) markets on cryptocurrencies (BTC, ETH, SOL, XRP). It combines real-time data fusion from Binance, Polymarket, and Chainlink with technical analysis, probabilistic modeling, and regime-aware strategy.

**Tech Stack:** Bun Runtime, TypeScript, Hono API, SQLite, React 19, Vite, shadcn/ui, wagmi/viem

## Common Commands

```bash
# Bot
bun run start              # Start the trading bot (port 9999)
bun run test               # Run tests once
bun run test:watch         # Run tests in watch mode
bun run typecheck          # TypeScript type checking
bun run lint               # Lint with Biome
bun run lint:fix           # Auto-fix lint issues
bun run format             # Format code with Biome

# Web Dashboard
cd web && bun run dev      # Start dev server (port 9998)
cd web && bun run build    # Build for production

# Docker
docker compose up --build  # Build and start all services

# CI Pre-push Check
bun run lint && bun run typecheck && bun run test  # Run all checks
```

## Architecture Overview

The system consists of two main services communicating via REST/WebSocket:

1. **Bot Service** (port 9999) - Trading engine and API server
2. **Web Dashboard** (port 9998) - React monitoring UI

### Main Trading Loop (`src/index.ts` → `processMarket()`)

Executed every 1 second per market:

```
1. Data Collection (parallel)
   ├─ Binance REST: 240 × 1-minute candles
   ├─ Binance WebSocket: Real-time tick prices
   ├─ Polymarket WebSocket: Live market pricing
   ├─ Polymarket REST: Market data + orderbook
   └─ Chainlink RPC: On-chain price feed (fallback)

2. Technical Indicators Calculation
   ├─ Heiken Ashi: Candle color + consecutive count
   ├─ RSI(14): Strength + slope
   ├─ MACD(12,26,9): Histogram + delta
   ├─ VWAP: Volume-weighted price + slope
   └─ Realized Volatility: 60-candle annualized × √15

3. Probability Fusion
   ├─ Volatility-Implied: Φ(log(P/PTB) / (vol × √(t/15)))
   ├─ TA Direction Score: Weighted indicator alignment
   └─ Blend: 50% vol + 50% TA (configurable)

4. Market Regime Detection
   ├─ TREND_UP: Price > VWAP, VWAP↑, volume > mean
   ├─ TREND_DOWN: Price < VWAP, VWAP↓, volume > mean
   ├─ CHOP: VWAP crosses >3 times in 20 candles
   └─ RANGE: Default

5. Edge Computation
   ├─ Edge = ModelProb - MarketPrice
   ├─ Adjust for orderbook imbalance & spread
   └─ Detect arbitrage (sum < 0.98) & high vig (sum > 1.04)

6. Trade Decision
   ├─ Phase detection: EARLY (>10min), MID (5-10min), LATE (<5min)
   ├─ Apply regime multipliers to thresholds
   ├─ Apply market-specific edge multipliers
   ├─ Check confidence score (5 factors)
   └─ Execute if edge ≥ threshold AND prob ≥ minProb
```

### Core Trading Engines

**Probability Engine** ([`src/engines/probability.ts`](src/engines/probability.ts))
- `scoreDirection()` - Computes TA-based directional score from price vs VWAP, VWAP slope, RSI + slope, MACD histogram + delta, Heiken Ashi color + consecutive count, failed VWAP reclaim
- `computeVolatilityImpliedProb()` - Black-Scholes style probability using normal CDF with fat-tail dampening for |z| > 2 (crypto adjustments)
- `blendProbabilities()` - Fuses vol and TA signals with optional Binance lead signal and orderbook imbalance adjustments
- `applyAdaptiveTimeDecay()` - S-curve time awareness (preserves >60% remaining, smoothstep 30-60%, fast decay <30%) with volatility adjustment (high vol → slower decay)
- `computeRealizedVolatility()` - 60-candle annualized volatility × √15 for 15-min windows

**Edge Engine** ([`src/engines/edge.ts`](src/engines/edge.ts))
- `computeEdge()` - Calculates edge = modelProb - marketPrice with confidence scoring, orderbook adjustments (imbalance, spread), arbitrage detection (sum < 0.98), and high vig detection (sum > 1.04)
- `computeConfidence()` - 5-factor weighted score: Indicator Alignment (25%), Volatility Score (15%), Orderbook Score (15%), Timing Score (25%), Regime Score (20%)
- `decide()` - Main decision logic with phase-based thresholds, regime multipliers, market-specific adjustments, and overconfidence protection (SOFT_CAP_EDGE: 0.22, HARD_CAP_EDGE: 0.3)
- `regimeMultiplier()` - Returns REGIME_DISABLED (999) to skip CHOP entirely for underperforming markets (winRate < 45%)

**Regime Detection** ([`src/engines/regime.ts`](src/engines/regime.ts))
- `detectRegime()` - Classifies market as TREND_UP/TREND_DOWN/CHOP/RANGE based on VWAP relationship, slope, and crossover frequency

### Market-Specific Adjustments (from backtest)

Hardcoded in [`src/engines/edge.ts`](src/engines/edge.ts#L24-L29):

| Market | Win Rate | Edge Multiplier |
|--------|----------|-----------------|
| BTC | 42.1% | 1.5× (require 50% more edge) |
| ETH | 46.9% | 1.2× (require 20% more edge) |
| SOL | 51.0% | 1.0× (standard) |
| XRP | 54.2% | 1.0× (best performer) |

## Configuration System

**Two-Layer Configuration:**

1. **Environment Variables** (`.env`, validated by Zod in [`src/env.ts`](src/env.ts)):
   - `PAPER_MODE=true` - Paper vs live trading
   - `API_PORT=9999` - API server port
   - `ACTIVE_MARKETS=BTC,ETH,SOL,XRP` - Enabled markets (comma-separated)
   - `PERSIST_BACKEND=sqlite` - Storage backend (csv/dual/sqlite)
   - `READ_BACKEND=sqlite` - Read backend (csv/sqlite, excludes "dual")
   - `POLYGON_RPC_URL` / `POLYGON_RPC_URLS` - Polygon RPC endpoint(s)
   - `POLYGON_WSS_URL` / `POLYGON_WSS_URLS` - Polygon WebSocket URL(s)
   - `POLYMARKET_SLUG` - Polymarket market slug
   - `POLYMARKET_LIVE_WS_URL` - Polymarket live WebSocket URL
   - `POLYMARKET_UP_LABEL` / `POLYMARKET_DOWN_LABEL` - Market outcome labels
   - `CHAINLINK_BTC_USD_AGGREGATOR` - Chainlink aggregator address
   - `API_TOKEN` - Optional auth for mutation endpoints
   - `LOG_LEVEL` - Logging verbosity (debug/info/warn/error/silent)

2. **Strategy Config** ([`config.json`](config.json), validated in [`src/config.ts`](src/config.ts)):
   - `paper.risk` / `live.risk` - Per-account risk settings (maxTradeSizeUsdc, dailyMaxLossUsdc, limitDiscount, maxOpenPositions, minLiquidity, maxTradesPerWindow)
   - `paper.initialBalance` - Initial paper balance
   - `strategy.edgeThresholdEarly/Mid/Late` - Phase-based edge thresholds (default: 0.06/0.08/0.10)
   - `strategy.minProbEarly/Mid/Late` - Phase-based probability thresholds (default: 0.52/0.55/0.60)
   - `strategy.blendWeights` - Vol vs TA probability weights (default: vol 0.50, ta 0.50)
   - `strategy.regimeMultipliers` - CHOP (1.3), RANGE (1.0), TREND_ALIGNED (0.8), TREND_OPPOSED (1.2)
   - `strategy.maxGlobalTradesPerWindow` - Max trades across all markets per window
   - `strategy.minConfidence` - Minimum confidence score (default: 0.50)
   - `strategy.skipMarkets` - Markets to skip entirely (array of market IDs)

Config changes are auto-reloaded on next cycle - no restart needed.

## Paper vs Live Trading

**Paper Mode** (default):
- Simulated orders tracked in memory + SQLite
- Settlement at 15-min window boundary (finalPrice > priceToBeat → UP wins)
- Conservative spending model: full trade cost debited immediately
- Daily state persisted to SQLite

**Live Mode**:
- Requires wallet connection via Web UI (wagmi + viem)
- Private key sent to `/api/live/connect` (POST)
- Creates ClobClient for Polymarket CLOB API
- Orders created via limit orders, polled by OrderManager
- Manual redemption via [`src/redeemer.ts`](src/redeemer.ts)

**Critical:** Paper and live state are completely separate - separate configs, separate daily state tracking, different spending models.

## State Management

Global state in [`src/state.ts`](src/state.ts):
- `_markets: MarketSnapshot[]` - Market snapshots for dashboard
- `_paperRunning / _liveRunning` - Bot running states (independent)
- `_*PendingStart / _*PendingStop` - Cycle-aware graceful start/stop (waits for window boundary)
- `botEvents: EventEmitter` - WebSocket broadcasts: `state:snapshot`, `signal:new`, `trade:executed`

Dashboard uses WebSocket (single source of truth) - don't poll REST endpoints in frontend.

## Database Schema

**SQLite Tables** ([`src/db.ts`](src/db.ts)):
- `trades` - All executed trades (paper + live)
- `signals` - Generated signals for backtest analysis
- `paper_trades` - Paper trade tracking with settlement
- `daily_stats` - Daily P&L per mode
- `paper_state` - Singleton paper state

**Storage Backends:**
- `PERSIST_BACKEND=sqlite` - SQLite only (default, recommended)
- `PERSIST_BACKEND=csv` - CSV files only (legacy)
- `PERSIST_BACKEND=dual` - Both SQLite and CSV (migration path)

New code should use SQLite prepared statements from [`src/db.ts`](src/db.ts).

## Key Architectural Patterns

1. **Multi-Sensor Fusion** - 4 independent price sources with fallback chain (Binance WS > Polymarket WS > Chainlink WS > Chainlink RPC > Binance REST)

2. **Regime-Aware Strategy** - Market state detection adapts thresholds dynamically (TREND_ALIGNED gets 20% discount, CHOP disabled for poor markets)

3. **Confidence Scoring** - 5-factor weighted score gates trades even if edge looks good (indicator alignment, volatility, orderbook, timing, regime)

4. **Market-Specific Performance** - Backtest-derived edge multipliers per market (BTC needs 50% more edge, ETH needs 20% more)

5. **Cycle-Aware State** - Pending start/stop states for graceful 15-min window boundary transitions

6. **Conservative Live Spending** - Daily loss limit acts as spending cap, full trade cost debited immediately

7. **Time-Aware Probability Decay** - S-curve decay preserves early confidence, volatility-adjusted time remaining (high vol → slower decay)

8. **Overconfidence Protection** - Soft cap (0.22) and hard cap (0.3) on edge to prevent trades when model appears too confident

## Critical Insights for Development

1. **ALWAYS validate config changes** - Both [`src/env.ts`](src/env.ts) and [`src/config.ts`](src/config.ts) use Zod schemas. Invalid values cause fail-fast at startup.

2. **Paper vs Live state is separate** - `paperRisk` and `liveRisk` configs, separate daily state tracking, different spending models.

3. **Market-specific performance matters** - BTC requires 1.5× edge, XRP gets 1.0×. Hardcoded in [`src/engines/edge.ts`](src/engines/edge.ts#L21-L26) as `DEFAULT_MARKET_PERFORMANCE`.

4. **CHOP regime is dangerous** - Skip entirely for BTC/ETH (<45% win rate). Encoded in [`src/engines/edge.ts`](src/engines/edge.ts) via `regimeMultiplier()` returning `REGIME_DISABLED` (999) when regime is CHOP and market winRate < 0.45.

5. **Edge overconfidence is the #1 killer** - High edge (≥20%) had 43.6% win rate vs low edge (<10%) at 57.9%. The model is overconfident when edge looks too good. Protected by SOFT_CAP_EDGE (0.22) and HARD_CAP_EDGE (0.3).

6. **WebSocket is single-source of truth** - Dashboard connects to `/api` WS and receives `state:snapshot` events. Don't poll REST endpoints in the frontend.

7. **15-min windows are sacred** - All paper trades keyed by `windowStartMs`. Settlement happens exactly at window boundary. Never start/stop mid-window (use pending states).

8. **SQLite is primary, CSV is legacy** - New code should use `statements` from [`src/db.ts`](src/db.ts). CSV backend exists for migration compatibility.

9. **Price source priority matters** - Binance WS > Polymarket WS > Chainlink RPC > Binance REST. The [`processMarket()`](src/index.ts) function tries each in order.

10. **Confidence score is gatekeeper** - Even if edge and probability pass thresholds, low confidence (<0.5) rejects the trade.

11. **Code style is enforced by Biome** - Tabs (width 2), 120 char line width, double quotes, semicolons always, trailing commas all, arrow parentheses always. Run `bun run lint:fix` before committing.

12. **Imports must use `.ts` extensions** - Required by `verbatimModuleSyntax` in tsconfig. Use `import type` for type-only imports.

## Important File Locations

```
src/
├── index.ts                  # Main loop, processMarket()
├── trader.ts                 # executeTrade(), wallet connection
├── config.ts                 # Config loading with Zod validation
├── types.ts                  # ALL TypeScript interfaces
├── state.ts                  # Global state + EventEmitter
├── api.ts                    # Hono server + WebSocket
├── db.ts                     # SQLite setup + prepared statements
├── env.ts                    # Environment validation (Zod)
├── markets.ts                # Market definitions (BTC, ETH, SOL, XRP)
├── paperStats.ts             # Paper trade tracking + settlement
├── orderManager.ts           # Live order polling
├── strategyRefinement.ts     # Backtest insights + MARKET_ADJUSTMENTS, BACKTEST_INSIGHTS
├── backtest.ts               # Backtest analysis tool
├── redeemer.ts               # Manual live trade redemption
├── engines/
│   ├── edge.ts               # Edge computation, confidence scoring, decision logic
│   ├── probability.ts        # TA scoring, vol implied, blending, time decay
│   └── regime.ts             # Market regime detection (TREND_UP/DOWN, CHOP, RANGE)
├── indicators/
│   ├── heikenAshi.ts         # Heiken Ashi candles + consecutive counting
│   ├── rsi.ts                # RSI + slope + SMA
│   ├── macd.ts               # MACD + histogram + delta
│   └── vwap.ts               # VWAP series + session VWAP
└── data/
    ├── binance.ts            # Binance REST API (klines, price)
    ├── binanceWs.ts          # Binance WebSocket (real-time ticks)
    ├── polymarket.ts         # Polymarket Gamma + CLOB APIs
    ├── polymarketLiveWs.ts   # Polymarket live pricing WebSocket
    ├── chainlink.ts          # Chainlink RPC price feed calls
    └── chainlinkWs.ts        # Chainlink WebSocket fallback

web/src/
├── components/
│   ├── Dashboard.tsx         # Main dashboard
│   ├── MarketCard.tsx        # Per-market display
│   ├── ConnectWallet.tsx     # Wallet connection UI
│   └── LiveConnect.tsx       # Live trading controls
└── lib/
    ├── api.ts                # API client (fetch + WebSocket)
    ├── stores/               # Zustand state management
    └── types.ts              # Frontend TypeScript types
```

## API Endpoints

REST API (port 9999):
- `GET /api/state` - Full dashboard state
- `GET /api/trades?mode=paper&limit=100` - Recent trades
- `GET /api/signals?market=BTC&limit=200` - Recent signals for backtest
- `GET /api/paper-stats` - Paper trading stats
- `POST /api/paper/start|stop` - Start/stop paper trading (cycle-aware)
- `POST /api/live/connect|disconnect` - Wallet management
- `POST /api/live/start|stop` - Live trading controls

WebSocket: `/api` - Real-time events: `state:snapshot`, `signal:new`, `trade:executed`

## Code Style Conventions

Enforced by Biome (see [`biome.json`](biome.json)):
- **Indent**: tabs (width 2)
- **Line width**: 120 characters
- **Quotes**: double quotes (`"`)
- **Semicolons**: always
- **Trailing commas**: all (including function params)
- **Arrow parentheses**: always (`(x) => ...`, never `x => ...`)

### Import Order (enforced by Biome)

```typescript
// 1. Node builtins — always use node: protocol
import fs from "node:fs";
import path from "node:path";

// 2. External packages — named imports
import { Hono } from "hono";
import { z } from "zod";

// 3. Internal — relative paths WITH .ts extension (required by verbatimModuleSyntax)
import { clamp } from "./utils.ts";
import { createLogger } from "./logger.ts";

// 4. Type-only imports — MUST use `import type` (enforced by verbatimModuleSyntax)
import type { AppConfig, RiskConfig } from "./types.ts";
```

### Naming Conventions

| Element       | Convention      | Example                          |
|---------------|-----------------|----------------------------------|
| Files         | camelCase       | `paperStats.ts`, `binanceWs.ts`  |
| Functions     | camelCase       | `computeRsi()`, `getCandleWindowTiming()` |
| Interfaces    | PascalCase      | `MarketConfig`, `EdgeResult`     |
| Type aliases  | PascalCase      | `Phase`, `Regime`, `Side`        |
| Constants     | UPPER_SNAKE_CASE| `MARKETS`, `CONFIG`, `REGIME_DISABLED` |
| React comps   | PascalCase      | `MarketCard.tsx`, `Dashboard.tsx` |
| Test files    | `{name}.test.ts`| `rsi.test.ts` next to `rsi.ts`  |

### Testing

- Tests co-located with source files: `rsi.test.ts` beside `rsi.ts`
- Run single test: `bunx vitest run src/utils.test.ts`
- Run tests matching pattern: `bunx vitest run -t "clamp"`
- Pure functions tested without mocks — pass data directly
- Use `toBeCloseTo(value, precision)` for floating-point comparisons
