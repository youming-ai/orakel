# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orakel is a production-grade automated trading bot for Polymarket's 15-minute binary options (Up/Down) markets on cryptocurrencies (BTC, ETH, SOL, XRP). It combines real-time data fusion from Binance, Polymarket, and Chainlink with technical analysis and regime-aware strategy.

**Tech Stack:** Bun Runtime, TypeScript, Hono API, SQLite, React 19, Vite, shadcn/ui

## Common Commands

```bash
# Bot
bun run start              # Start the trading bot (port 9999)
bun run dev                # Run bot + web dashboard concurrently
bun run test               # Run tests once
bun run test:watch         # Run tests in watch mode
bun run typecheck          # TypeScript type checking
bun run typecheck:ci       # Type check without test files (CI mode)
bun run lint               # Lint with Biome
bun run lint:fix           # Auto-fix lint issues
bun run format             # Format code with Biome

# Run single test file
bunx vitest run src/__tests__/rsi.test.ts

# Run tests matching pattern
bunx vitest run -t "clamp"

# Web Dashboard
cd web && bun run dev      # Start dev server (Vite default port)
cd web && bun run build    # Build for production

# Docker
docker compose up --build  # Build and start all services

# CI Pre-push Check
bun run lint && bun run typecheck && bun run test  # Run all checks
```

## Architecture Overview

The system consists of two main services communicating via REST/WebSocket:

1. **Bot Service** (port 9999) - Trading engine and API server
2. **Web Dashboard** (Cloudflare Pages / local Vite dev) - React monitoring UI

### Directory Organization

```
src/
├── core/           # Core utilities (config, db, env, logger, markets, state, utils, cache)
├── blockchain/     # Blockchain interaction (accountState, contracts, reconciler, redeemer)
├── trading/        # Trading logic (accountStats, liveGuards, liveSettler, orderManager, persistence, strategyRefinement, terminal, trader)
├── pipeline/       # Data pipeline (compute, fetch, processMarket)
├── data/           # External data sources (Binance, Polymarket, Chainlink APIs/WebSockets)
├── engines/        # Trading engines (edge, probability, regime)
├── indicators/     # Technical indicators (Heiken Ashi, RSI, MACD, VWAP)
├── __tests__/      # Test files (vitest)
├── api.ts          # Hono server + WebSocket
└── types.ts        # ALL TypeScript interfaces
```

### Main Trading Loop (`src/index.ts` → `processMarket()`)

Executed every 1 second per market:

```
1. Data Collection (parallel via src/pipeline/fetch.ts)
   ├─ Binance REST: 240 × 1-minute candles
   ├─ Binance WebSocket: Real-time tick prices
   ├─ Polymarket WebSocket: Live market pricing
   ├─ Polymarket REST: Market data + orderbook
   └─ Chainlink RPC: On-chain price feed (fallback)

2. Technical Indicators Calculation (via src/indicators/)
   ├─ Heiken Ashi: Candle color + consecutive count
   ├─ RSI(14): Strength + slope
   ├─ MACD(12,26,9): Histogram + delta
   ├─ VWAP: Volume-weighted price + slope
   └─ Realized Volatility: 60-candle annualized × √15

3. Probability Scoring (via src/engines/probability.ts)
   ├─ TA Direction Score: Weighted indicator alignment
   └─ Time Awareness: Linear decay based on time remaining

4. Market Regime Detection (via src/engines/regime.ts) - Informational only
   ├─ TREND_UP: Price > VWAP, VWAP↑, volume > mean
   ├─ TREND_DOWN: Price < VWAP, VWAP↓, volume > mean
   ├─ CHOP: VWAP crosses >3 times in 20 candles
   └─ RANGE: Default

5. Edge Computation (via src/engines/edge.ts)
   ├─ Edge = ModelProb - MarketPrice
   └─ Detect arbitrage (sum < 0.98) & high vig (sum > 1.04)

6. Trade Decision (via src/engines/edge.ts → src/trading/trader.ts)
   ├─ Phase detection: EARLY (>10min), MID (5-10min), LATE (<5min)
   ├─ Check market skip list
   ├─ Execute if edge ≥ threshold AND prob ≥ minProb
   └─ Strength: STRONG (≥20%), GOOD (≥10%), OPTIONAL (<10%)
```

### Unified Settlement System

**Critical Architecture Change (2024):** Paper and live settlement now use unified logic.

- **Settlement** (won/lost determination): Handled by `resolveTrades()` in main loop using spot price comparison
- **Redemption** (claiming winnings): `src/trading/liveSettler.ts` - Pure redeemer that only claims on-chain winnings for already-settled won trades
- **Spot price fallback**: Uses Binance spot price for stale trades where on-chain settlement is delayed

Both paper and live trades settle at 15-min window boundary (finalPrice > priceToBeat → UP wins).

### Core Trading Engines

**Probability Engine** ([`src/engines/probability.ts`](src/engines/probability.ts))
- `scoreDirection()` - Computes TA-based directional score from price vs VWAP, VWAP slope, RSI + slope, MACD histogram + delta, Heiken Ashi color + consecutive count, failed VWAP reclaim
- `applyTimeAwareness()` - Linear time decay (clamped to 0-1) based on remaining minutes
- `computeRealizedVolatility()` - 60-candle annualized volatility × √15 for 15-min windows

**Edge Engine** ([`src/engines/edge.ts`](src/engines/edge.ts))
- `computeEdge()` - Calculates edge = modelProb - marketPrice with arbitrage detection (sum < 0.98) and high vig detection (sum > 1.04)
- `decide()` - Simple threshold-based decision logic: check edge threshold, check probability threshold, return trade decision
- No confidence scoring, no regime multipliers, no overconfidence caps (simplified architecture)

**Regime Detection** ([`src/engines/regime.ts`](src/engines/regime.ts))
- `detectRegime()` - Classifies market as TREND_UP/TREND_DOWN/CHOP/RANGE based on VWAP relationship, slope, and crossover frequency
- **Note:** Regime is informational only and does not affect trade thresholds in the simplified architecture

### Market-Specific Adjustments

All markets use identical trading strategy (no per-market edge multipliers or performance adjustments). Markets can be skipped via `strategy.skipMarkets` in `config.json`.

## Configuration System

**Two-Layer Configuration:**

1. **Environment Variables** (`.env`, validated by Zod in [`src/core/env.ts`](src/core/env.ts)):
   - `PAPER_MODE=true` - Paper vs live trading
   - `API_PORT=9999` - API server port
   - `ACTIVE_MARKETS=BTC,ETH,SOL,XRP` - Enabled markets (comma-separated)
   - `CORS_ORIGIN=*` - CORS origins for API access (use `http://localhost:9998` for Docker Compose)
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
   - `PRIVATE_KEY` - 64-char hex for live trading (auto-connects wallet on startup)
   - `AUTO_REDEEM_ENABLED=false` - Auto-redeem settled positions (requires PRIVATE_KEY)
   - `AUTO_REDEEM_INTERVAL_MS=1800000` - Auto-redeem check interval (default: 30 minutes)

2. **Strategy Config** ([`config.json`](config.json), validated in [`src/core/config.ts`](src/core/config.ts)):
   - `paper.risk` / `live.risk` - Per-account risk settings (maxTradeSizeUsdc, dailyMaxLossUsdc, limitDiscount, maxOpenPositions, minLiquidity, maxTradesPerWindow)
   - `paper.initialBalance` - Initial paper balance
   - `strategy.edgeThresholdEarly/Mid/Late` - Phase-based edge thresholds (default: 0.05/0.1/0.2)
   - `strategy.minProbEarly/Mid/Late` - Phase-based probability thresholds (default: 0.55/0.6/0.65)
   - `strategy.maxGlobalTradesPerWindow` - Max trades across all markets per window
   - `strategy.skipMarkets` - Markets to skip entirely (array of market IDs)

Config changes are auto-reloaded on next cycle - no restart needed.

## Paper vs Live Trading

**Paper Mode** (default):
- Simulated orders tracked in memory + SQLite
- Settlement at 15-min window boundary (finalPrice > priceToBeat → UP wins)
- Conservative spending model: full trade cost debited immediately
- Daily state persisted to SQLite

**Live Mode**:
- Auto-connects wallet on startup if `PRIVATE_KEY` is set in `.env` (64-char hex, `0x` prefix optional)
- Creates ClobClient for Polymarket CLOB API
- Orders created via limit orders, polled by [`src/trading/orderManager.ts`](src/trading/orderManager.ts)
- Manual redemption via [`src/blockchain/redeemer.ts`](src/blockchain/redeemer.ts) or automatic via `AUTO_REDEEM_ENABLED`
- Legacy: `/api/live/connect` endpoint still exists for manual connection

**Critical:** Paper and live state are completely separate - separate configs, separate daily state tracking, different spending models.

## State Management

Global state in [`src/core/state.ts`](src/core/state.ts):
- `_markets: MarketSnapshot[]` - Market snapshots for dashboard
- `_paperRunning / _liveRunning` - Bot running states (independent)
- `_*PendingStart / _*PendingStop` - Cycle-aware graceful start/stop (waits for window boundary)
- `botEvents: EventEmitter` - WebSocket broadcasts: `state:snapshot`, `signal:new`, `trade:executed`

Dashboard uses WebSocket (single source of truth) - don't poll REST endpoints in frontend.

## Database Schema

**SQLite Tables** ([`src/core/db.ts`](src/core/db.ts)):
- `trades` - All executed trades (paper + live)
- `signals` - Generated signals for backtest analysis
- `paper_trades` - Paper trade tracking with settlement
- `daily_stats` - Daily P&L per mode
- `paper_state` - Singleton paper state

**Storage Backends:**
- `PERSIST_BACKEND=sqlite` - SQLite only (default, recommended)
- `PERSIST_BACKEND=csv` - CSV files only (legacy)
- `PERSIST_BACKEND=dual` - Both SQLite and CSV (migration path)

New code should use SQLite prepared statements from [`src/core/db.ts`](src/core/db.ts).

**DB Pruning:** Automated pruning of old records to maintain database performance.

## Key Architectural Patterns

1. **Multi-Sensor Fusion** - 4 independent price sources with fallback chain (Binance WS > Polymarket WS > Chainlink WS > Chainlink RPC > Binance REST)

2. **Simplified Strategy Engine** - Recent refactoring removed: regime multipliers, confidence scoring, volatility-implied probability blending, overconfidence caps. Now uses simple TA-based scoring with linear time decay.

3. **Unified Market Strategy** - All markets use identical trading logic (no per-market performance adjustments or edge multipliers).

4. **Cycle-Aware State** - Pending start/stop states for graceful 15-min window boundary transitions.

5. **Conservative Live Spending** - Daily loss limit acts as spending cap, full trade cost debited immediately.

6. **Unified Settlement** - Paper and live trades settle using same logic in main loop (`resolveTrades()`), LiveSettler only redeems on-chain winnings.

## Critical Insights for Development

1. **ALWAYS validate config changes** - Both [`src/core/env.ts`](src/core/env.ts) and [`src/core/config.ts`](src/core/config.ts) use Zod schemas. Invalid values cause fail-fast at startup.

2. **Paper vs Live state is separate** - `paperRisk` and `liveRisk` configs, separate daily state tracking, different spending models.

3. **Strategy simplification (current branch)** - The trading engine has been simplified: no regime multipliers, no confidence scoring, no volatility-implied probability. Only TA-based directional scoring with linear time decay.

4. **All markets use uniform strategy** - No per-market edge multipliers or performance adjustments. Markets can only be skipped via `strategy.skipMarkets`.

5. **WebSocket is single-source of truth** - Dashboard connects to `/ws` WS endpoint and receives `state:snapshot` events. Don't poll REST endpoints in the frontend.

6. **15-min windows are sacred** - All paper trades keyed by `windowStartMs`. Settlement happens exactly at window boundary. Never start/stop mid-window (use pending states).

7. **SQLite is primary, CSV is legacy** - New code should use `statements` from [`src/core/db.ts`](src/core/db.ts). CSV backend exists for migration compatibility.

8. **Price source priority matters** - Binance WS > Polymarket WS > Chainlink RPC > Binance REST. The [`src/pipeline/fetch.ts`](src/pipeline/fetch.ts) function tries each in order.

9. **Code style is enforced by Biome** - Tabs (width 2), 120 char line width, double quotes, semicolons always, trailing commas all, arrow parentheses always. Run `bun run lint:fix` before committing.

10. **Imports must use `.ts` extensions** - Required by `verbatimModuleSyntax` in tsconfig. Use `import type` for type-only imports.

11. **Settlement vs Redemption** - Settlement (determining won/lost) happens in main loop via `resolveTrades()`. Redemption (claiming on-chain) is handled by `src/trading/liveSettler.ts` (pure redeemer).

12. **New file locations** - Many files moved to `src/core/`, `src/blockchain/`, `src/trading/`, `src/pipeline/` directories for better organization.

## API Endpoints

REST API (port 9999):
- `GET /api/health` - Health check for Docker containers
- `GET /api/state` - Full dashboard state
- `GET /api/trades?mode=paper&limit=100` - Recent trades
- `GET /api/signals?market=BTC&limit=200` - Recent signals for backtest
- `GET /api/paper-stats` - Paper trading stats
- `POST /api/paper/start|stop` - Start/stop paper trading (cycle-aware)
- `POST /api/live/connect|disconnect` - Wallet management (legacy; primary method is PRIVATE_KEY auto-connect)
- `POST /api/live/start|stop` - Live trading controls

WebSocket: `/ws` - Real-time events: `state:snapshot`, `signal:new`, `trade:executed`

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
import { clamp } from "./core/utils.ts";
import { createLogger } from "./core/logger.ts";

// 4. Type-only imports — MUST use `import type` (enforced by verbatimModuleSyntax)
import type { AppConfig, RiskConfig } from "./types.ts";
```

### Naming Conventions

| Element       | Convention      | Example                          |
|---------------|-----------------|----------------------------------|
| Files         | camelCase       | `liveSettler.ts`, `binanceWs.ts`  |
| Functions     | camelCase       | `computeRsi()`, `getCandleWindowTiming()` |
| Interfaces    | PascalCase      | `MarketConfig`, `EdgeResult`     |
| Type aliases  | PascalCase      | `Phase`, `Regime`, `Side`        |
| Constants     | UPPER_SNAKE_CASE| `MARKETS`, `CONFIG`, `REGIME_DISABLED` |
| React comps   | PascalCase      | `MarketCard.tsx`, `Dashboard.tsx` |
| Test files    | `{name}.test.ts`| `rsi.test.ts` in `src/__tests__/` |

### Testing

- Tests located in `src/__tests__/` directory (not co-located with source files)
- Run single test: `bunx vitest run src/__tests__/rsi.test.ts`
- Run tests matching pattern: `bunx vitest run -t "clamp"`
- Pure functions tested without mocks — pass data directly
- Use `toBeCloseTo(value, precision)` for floating-point comparisons
