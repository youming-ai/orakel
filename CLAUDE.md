# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orakel is a production-grade automated trading bot for Polymarket's Crypto Up/Down binary options markets across multiple timeframes (15m). It combines real-time data fusion from Binance, Polymarket, and Chainlink with technical analysis and regime-aware strategy.

**Tech Stack:** Bun Runtime, TypeScript, Hono API, PostgreSQL (Drizzle ORM), React 19, Vite, shadcn/ui, Tailwind v4, Zustand, TanStack Query

## Common Commands

```bash
# From repo root
bun run start              # Start the trading bot (port 9999)
bun run dev                # Run bot + web dashboard concurrently
bun run test               # Run tests once (vitest, bot package)
bun run typecheck          # TypeScript type checking (all packages)
bun run lint               # Biome check packages/
bun run lint:fix           # Auto-fix lint issues
bun run format             # Format code with Biome
bun run check:ci           # Full CI check: lint + typecheck + test

# Run single test file (from repo root or packages/bot/)
bunx vitest run packages/bot/src/__tests__/rsi.test.ts

# Run tests matching pattern
cd packages/bot && bunx vitest run -t "clamp"

# Per-package commands
cd packages/bot && bun run dev        # Bot with watch mode
cd packages/bot && bun run typecheck:ci  # Type check without test files
cd packages/web && bun run dev        # Web dev server (Vite, port 5173)
cd packages/web && bun run build      # Build web for production

# Docker
docker compose up --build  # Build and start all services
```

## Architecture Overview

Three packages in a Bun monorepo communicating via REST/WebSocket:

1. **`@orakel/bot`** (`packages/bot/`) — Trading engine and API server (port 9999)
2. **`@orakel/web`** (`packages/web/`) — React monitoring UI (Cloudflare Pages / local Vite dev)
3. **`@orakel/shared`** (`packages/shared/`) — Shared contracts/DTOs (Zod schemas, types)

### Directory Organization

```
packages/bot/src/
├── app/            # Application bootstrap, shutdown, API server (Hono), WS broadcaster
├── blockchain/     # Blockchain interaction (accountState, contracts, reconciler, redeemer)
├── core/           # Core utilities (config, env, logger, markets, state, utils, cache, tradeTracker)
├── data/           # External data sources (Binance, Polymarket, Chainlink APIs/WebSockets)
├── db/             # Database client, schema (Drizzle ORM + PostgreSQL), queries
├── engines/        # Trading engines (edge, probability, regime, arbitrage)
├── indicators/     # Technical indicators (Heiken Ashi, RSI, MACD, VWAP)
├── pipeline/       # Data pipeline (compute, fetch, processMarket)
├── repositories/   # DB query modules (trades, dailyStats, state, onchain, kv, pendingOrder, maintenance)
├── runtime/        # Runtime orchestration (marketState, settlementCycle, tradeDispatch,
│                   #   snapshotPublisher, orderRecovery, orderStatusSync, onchainRuntime)
├── trading/        # Trading logic (trader, accountStats, accountService, executionService,
│                   #   heartbeatService, walletService, liveGuards, liveSettler, orderManager,
│                   #   persistence, terminal, traderState, tradeTypes, signalPayload)
├── backtest/       # Backtesting engine (replay, strategy optimizer, multi-period)
├── contracts/      # Internal contract ABIs
└── __tests__/      # Test files (vitest, 33 files)

packages/shared/src/
└── contracts/      # Shared DTOs exported as @orakel/shared/contracts

packages/web/src/
├── app/            # AppShell, layout, router, WebSocket sync
├── components/     # Shared UI components (Header, MarketCard, StatCard, ui/)
├── entities/       # Domain entities (account, market, trade) with queries
├── features/       # Feature modules (botControl with mutations + dialogs)
├── hooks/          # Custom hooks (useCycleCountdown, useReducedMotion)
├── lib/            # Utilities (api, format, stats, store, ws, queries, types)
├── pages/          # Page components (Dashboard, Trades)
└── widgets/        # Composite UI widgets (overview, trades panels/tabs/tables)
```

### Main Trading Loop (`packages/bot/src/index.ts` → `processMarket()`)

Executed every 1 second per market:

```
1. Data Collection (parallel via packages/bot/src/pipeline/fetch.ts)
   ├─ Binance REST + WebSocket: Candles + real-time ticks (Bybit as fallback)
   ├─ Polymarket WebSocket + REST: Live pricing + orderbook (notional liquidity)
   ├─ Chainlink RPC: On-chain price feed (fallback)
   └─ isLive flag propagated through pipeline for live-only signal gating

2. Technical Indicators (packages/bot/src/indicators/)
   ├─ Heiken Ashi, RSI(14), MACD(12,26,9), VWAP, Realized Volatility

3. Probability Scoring (packages/bot/src/engines/probability.ts)
   ├─ TA Direction Score + Time Awareness (2h decay, floor 0.5)

4. Market Regime Detection (packages/bot/src/engines/regime.ts) — Informational only
   ├─ TREND_UP / TREND_DOWN / CHOP / RANGE

5. Edge Computation (packages/bot/src/engines/edge.ts)
   ├─ Edge = ModelProb - MarketPrice, arbitrage + vig detection
   ├─ Micro-bias adjustments: orderbook imbalance + spot-chainlink delta

6. Trade Decision (packages/bot/src/engines/edge.ts → packages/bot/src/trading/trader.ts)
   ├─ Phase detection: EARLY (0.05-0.45) / MID / LATE
   ├─ Execute if edge >= threshold AND prob >= minProb AND isLive passes
   ├─ Notional liquidity gating (bidNotional/askNotional, not raw share counts)
   ├─ priceToBeat must be parsed from Chainlink — no silent fallback (returns null)

7. Execution (packages/bot/src/trading/executionService.ts)
   ├─ Separate maker price (limit order) vs taker tolerance (worst fill)
   ├─ Expected PnL gate: reject trades where fee-adjusted EV < 0
   └─ Hold-to-settle strategy: positions held until window settlement

8. Risk (packages/bot/src/trading/accountService.ts)
   ├─ Projected worst-case = realized loss + max potential loss on open positions
   └─ Daily loss limit checked against projected worst-case exposure
```

### Unified Settlement System

- **Settlement** (won/lost): `resolveTrades()` in main loop using spot price comparison
- **Redemption** (claiming winnings): `packages/bot/src/trading/liveSettler.ts` — only claims on-chain winnings for already-settled won trades
- Paper and live trades settle using same logic; LiveSettler only handles on-chain redemption

## Database

**PostgreSQL** via Drizzle ORM. Schema in `packages/bot/src/db/schema.ts`, client in `packages/bot/src/db/client.ts`. Drizzle config and migrations are at the repo root (`drizzle.config.ts`, `drizzle/`).

Key tables: `trades`, `signals`, `daily_stats`, `paper_state`, `live_state`, `kv_store`, `live_pending_orders`, `onchain_events`, `balance_snapshots`, `known_ctf_tokens`

Query logic is organized into `packages/bot/src/repositories/` modules: tradeRepo, dailyStatsRepo, stateRepo, onchainRepo, kvRepo, pendingOrderRepo, maintenanceRepo.

## Configuration System

**Two-Layer Configuration:**

1. **Environment Variables** (`.env`, validated by Zod in `packages/bot/src/core/env.ts`):
   - `PAPER_MODE=true` — Paper vs live trading
   - `API_PORT=9999` — API server port
   - `ACTIVE_MARKETS=BTC-15m,ETH-15m` — Enabled markets
   - `PRIVATE_KEY` — 64-char hex for live trading (auto-connects wallet)
   - `AUTO_REDEEM_ENABLED=false` — Auto-redeem settled positions
   - See `packages/bot/src/core/env.ts` for full list

2. **Strategy Config** (`config.json` at repo root, validated in `packages/bot/src/core/config.ts`):
   - `paper.risk` / `live.risk` — Per-account risk settings
   - `strategy.edgeThresholdEarly/Mid/Late` — Phase-based edge thresholds
   - `strategy.minProbEarly/Mid/Late` — Phase-based probability thresholds
   - `strategy.skipMarkets` — Markets to skip (array of market IDs)
   - Auto-reloaded on next cycle — no restart needed

## Key Architectural Patterns

1. **Contracts Layer** — `packages/shared/src/contracts/` defines shared DTOs (Zod-validated) exported as `@orakel/shared/contracts`. Both bot and web import from this package.

2. **Multi-Sensor Fusion** — Price source fallback chain: Binance WS > Polymarket WS > Chainlink WS > Chainlink RPC > Binance REST

3. **Strategy Engine** — TA-based scoring with time decay (2h window, floor 0.5). Micro-bias from orderbook imbalance and spot-chainlink delta. Separate maker/taker pricing. Expected PnL gate pre-execution. No regime multipliers or confidence scoring.

4. **Cycle-Aware State** — Pending start/stop states for graceful window boundary transitions. Never start/stop mid-window.

5. **Paper vs Live are separate** — Separate configs, separate daily state tracking, different spending models.

6. **WebSocket is single source of truth** — Dashboard connects to `/ws` and receives `state:snapshot` events. Don't poll REST endpoints in frontend.

## API Endpoints

REST API (port 9999):
- `GET /api/health` — Health check
- `GET /api/state` — Full dashboard state
- `GET /api/trades?mode=paper&limit=100` — Recent trades
- `GET /api/signals?market=BTC&limit=200` — Recent signals
- `GET /api/paper-stats` — Paper trading stats
- `POST /api/paper/start|stop` — Start/stop paper trading (cycle-aware)
- `POST /api/live/connect|disconnect` — Wallet management
- `POST /api/live/start|stop` — Live trading controls

WebSocket: `/ws` — Events: `state:snapshot`, `signal:new`, `trade:executed`

## Code Style Conventions

Enforced by Biome v2 (see `biome.json`):
- **Indent**: tabs (width 2)
- **Line width**: 120 characters
- **Quotes**: double quotes
- **Semicolons**: always
- **Trailing commas**: all
- **Arrow parentheses**: always (`(x) => ...`)

### Import Rules

```typescript
// 1. Node builtins — always use node: protocol
import fs from "node:fs";

// 2. External packages
import { Hono } from "hono";
import { z } from "zod";

// 3. Internal — relative paths WITH .ts extension (required by verbatimModuleSyntax)
import { clamp } from "./core/utils.ts";

// 4. Type-only imports — MUST use `import type`
import type { AppConfig, RiskConfig } from "./types.ts";
```

### Naming Conventions

| Element       | Convention       | Example                           |
|---------------|------------------|-----------------------------------|
| Files         | camelCase        | `liveSettler.ts`, `binanceWs.ts`  |
| Functions     | camelCase        | `computeRsi()`, `detectRegime()`  |
| Interfaces    | PascalCase       | `MarketConfig`, `EdgeResult`      |
| Constants     | UPPER_SNAKE_CASE | `MARKETS`, `CONFIG`               |
| React comps   | PascalCase       | `MarketCard.tsx`, `Dashboard.tsx`  |
| Test files    | `{name}.test.ts` | in `packages/bot/src/__tests__/`  |

### Testing

- Tests in `packages/bot/src/__tests__/` directory (not co-located)
- Pure functions tested without mocks — pass data directly
- Use `toBeCloseTo(value, precision)` for floating-point comparisons

## Critical Reminders

1. **Imports must use `.ts` extensions** — Required by `verbatimModuleSyntax`. Use `import type` for type-only imports.
2. **Types are distributed across domain modules** — `core/configTypes.ts` (config interfaces), `core/marketDataTypes.ts` (market data types incl. OrderBookSummary with notional fields), `trading/tradeTypes.ts` (trade signals, decisions, edge results), `trading/accountTypes.ts` (account types). No single `types.ts`.
3. **Config validated by Zod** — Invalid values cause fail-fast at startup (`packages/bot/src/core/env.ts`, `packages/bot/src/core/config.ts`).
4. **Price source priority matters** — Binance WS > Polymarket WS > Chainlink WS > Chainlink RPC > Binance REST (`packages/bot/src/pipeline/fetch.ts`).
5. **Run `bun run lint:fix` before committing** — Biome enforces all style rules across `packages/`.
6. **CI runs**: `bun run check:ci` = lint → typecheck → test. Docker build runs after checks pass.
7. **Settlement vs Redemption** — Settlement (won/lost) happens in main loop via `resolveTrades()`. Redemption (on-chain claiming) is `packages/bot/src/trading/liveSettler.ts`.
8. **Window boundaries are sacred** — Trades keyed by `windowStartMs`. Never start/stop mid-window (use pending states).
9. **Notional liquidity, not shares** — Liquidity gating uses `bidNotional`/`askNotional` (price × size), not raw share counts. Low-priced markets appear artificially liquid with share counts.
10. **priceToBeat has no fallback** — If Chainlink price is unavailable, `priceToBeat` returns null with `priceToBeatSource: "missing"`. Never silently falls back to Polymarket price.
