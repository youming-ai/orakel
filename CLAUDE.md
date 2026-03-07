# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orakel is a production-grade automated trading bot for Polymarket's BTC Up/Down binary options markets across multiple timeframes (5m, 15m). It combines real-time data fusion from Binance, Polymarket, and Chainlink with technical analysis and regime-aware strategy.

**Tech Stack:** Bun Runtime, TypeScript, Hono API, PostgreSQL (Drizzle ORM), React 19, Vite, shadcn/ui, Tailwind v4, Zustand, TanStack Query

## Common Commands

```bash
# Bot
bun run start              # Start the trading bot (port 9999)
bun run dev                # Run bot + web dashboard concurrently
bun run test               # Run tests once (vitest)
bun run test:watch         # Run tests in watch mode
bun run typecheck          # TypeScript type checking
bun run typecheck:ci       # Type check without test files (tsconfig.check.json)
bun run lint               # Biome check src/
bun run lint:fix           # Auto-fix lint issues
bun run format             # Format code with Biome

# Run single test file
bunx vitest run src/__tests__/rsi.test.ts

# Run tests matching pattern
bunx vitest run -t "clamp"

# Web Dashboard
cd web && bun run dev      # Start dev server (Vite, port 5173)
cd web && bun run build    # Build for production

# Docker
docker compose up --build  # Build and start all services

# CI Pre-push Check
bun run lint && bun run typecheck && bun run test
```

## Architecture Overview

Two main services communicating via REST/WebSocket:

1. **Bot Service** (port 9999) — Trading engine and API server
2. **Web Dashboard** (Cloudflare Pages / local Vite dev) — React monitoring UI

### Directory Organization

```
src/
├── app/            # Application bootstrap, shutdown, API server (Hono), WS broadcaster
├── blockchain/     # Blockchain interaction (accountState, contracts, reconciler, redeemer)
├── contracts/      # Shared DTOs between frontend and backend (config, http, ws)
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
│                   #   persistence, terminal, traderState)
├── __tests__/      # Test files (vitest)
└── types.ts        # ALL TypeScript interfaces

web/src/
├── app/            # AppShell, layout, router, WebSocket sync
├── components/     # Shared UI components (Header, MarketCard, StatCard, ui/)
├── contracts/      # Mirrors backend contracts (http.ts, ws.ts)
├── entities/       # Domain entities (account, market, trade) with queries
├── features/       # Feature modules (botControl with mutations + dialogs)
├── hooks/          # Custom hooks (useCycleCountdown, useReducedMotion)
├── lib/            # Utilities (api, format, stats, store, ws, queries, types)
├── pages/          # Page components (Dashboard, Trades)
├── shared/         # Shared utilities (queryKeys)
└── widgets/        # Composite UI widgets (overview, trades panels/tabs/tables)
```

### Main Trading Loop (`src/index.ts` → `processMarket()`)

Executed every 1 second per market:

```
1. Data Collection (parallel via src/pipeline/fetch.ts)
   ├─ Binance REST + WebSocket: Candles + real-time ticks
   ├─ Polymarket WebSocket + REST: Live pricing + orderbook
   └─ Chainlink RPC: On-chain price feed (fallback)

2. Technical Indicators (src/indicators/)
   ├─ Heiken Ashi, RSI(14), MACD(12,26,9), VWAP, Realized Volatility

3. Probability Scoring (src/engines/probability.ts)
   ├─ TA Direction Score + Time Awareness (linear decay)

4. Market Regime Detection (src/engines/regime.ts) — Informational only
   ├─ TREND_UP / TREND_DOWN / CHOP / RANGE

5. Edge Computation (src/engines/edge.ts)
   ├─ Edge = ModelProb - MarketPrice, arbitrage + vig detection

6. Trade Decision (src/engines/edge.ts → src/trading/trader.ts)
   ├─ Phase detection: EARLY / MID / LATE
   ├─ Execute if edge >= threshold AND prob >= minProb
```

### Unified Settlement System

- **Settlement** (won/lost): `resolveTrades()` in main loop using spot price comparison
- **Redemption** (claiming winnings): `src/trading/liveSettler.ts` — only claims on-chain winnings for already-settled won trades
- Paper and live trades settle using same logic; LiveSettler only handles on-chain redemption

## Database

**PostgreSQL** via Drizzle ORM. Schema in `src/db/schema.ts`, client in `src/db/client.ts`.

Key tables: `trades`, `signals`, `daily_stats`, `paper_state`, `live_state`, `kv_store`, `live_pending_orders`, `onchain_events`, `balance_snapshots`, `known_ctf_tokens`

Query logic is organized into `src/repositories/` modules: tradeRepo, dailyStatsRepo, stateRepo, onchainRepo, kvRepo, pendingOrderRepo, maintenanceRepo.

## Configuration System

**Two-Layer Configuration:**

1. **Environment Variables** (`.env`, validated by Zod in `src/core/env.ts`):
   - `PAPER_MODE=true` — Paper vs live trading
   - `API_PORT=9999` — API server port
	- `ACTIVE_MARKETS=BTC-5m,BTC-15m` — Enabled markets
   - `PRIVATE_KEY` — 64-char hex for live trading (auto-connects wallet)
   - `AUTO_REDEEM_ENABLED=false` — Auto-redeem settled positions
   - See `src/core/env.ts` for full list

2. **Strategy Config** (`config.json`, validated in `src/core/config.ts`):
   - `paper.risk` / `live.risk` — Per-account risk settings
   - `strategy.edgeThresholdEarly/Mid/Late` — Phase-based edge thresholds
   - `strategy.minProbEarly/Mid/Late` — Phase-based probability thresholds
   - `strategy.skipMarkets` — Markets to skip (array of market IDs)
   - Auto-reloaded on next cycle — no restart needed

## Key Architectural Patterns

1. **Contracts Layer** — `src/contracts/` defines shared DTOs (config, http, ws) used by both backend API and frontend. Frontend mirrors these in `web/src/contracts/`.

2. **Multi-Sensor Fusion** — Price source fallback chain: Binance WS > Polymarket WS > Chainlink WS > Chainlink RPC > Binance REST

3. **Simplified Strategy Engine** — No regime multipliers, no confidence scoring, no volatility-implied probability blending. Simple TA-based scoring with linear time decay.

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
| Test files    | `{name}.test.ts` | in `src/__tests__/`               |

### Testing

- Tests in `src/__tests__/` directory (not co-located)
- Pure functions tested without mocks — pass data directly
- Use `toBeCloseTo(value, precision)` for floating-point comparisons

## Critical Reminders

1. **Imports must use `.ts` extensions** — Required by `verbatimModuleSyntax`. Use `import type` for type-only imports.
2. **All types live in `src/types.ts`** — Single source of truth for TypeScript interfaces.
3. **Config validated by Zod** — Invalid values cause fail-fast at startup (`src/core/env.ts`, `src/core/config.ts`).
4. **Price source priority matters** — Binance WS > Polymarket WS > Chainlink RPC > Binance REST (`src/pipeline/fetch.ts`).
5. **Run `bun run lint:fix` before committing** — Biome enforces all style rules.
6. **CI runs**: lint → typecheck (tsconfig.check.json) → test. Docker build runs after checks pass.
7. **Settlement vs Redemption** — Settlement (won/lost) happens in main loop via `resolveTrades()`. Redemption (on-chain claiming) is `src/trading/liveSettler.ts`.
8. **Window boundaries are sacred** — Trades keyed by `windowStartMs`. Never start/stop mid-window (use pending states).
