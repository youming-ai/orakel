# AGENTS.md — Orakel

Automated trading bot for Polymarket 15-minute crypto up/down markets.
Backend: Bun + TypeScript + Hono + SQLite. Frontend: React 19 + Vite 7 + shadcn/ui + Tailwind v4.

## Build & Run Commands

```bash
bun install                          # Install backend dependencies
cd web && bun install                # Install frontend dependencies

bun run start                        # Start bot (src/index.ts, port 9999)
cd web && bun run dev                # Start frontend dev server (port 9998)
bun run dev                          # Start both (concurrently)
bun run dev:mock                     # Start mock server (scripts/mock-server.ts)
```

## Lint / Typecheck

```bash
bun run typecheck                    # Typecheck backend (src/)
bun run typecheck:web                # Typecheck frontend (web/src/)
bun run lint                         # Biome check (lint + format) src/
bun run lint:fix                     # Biome check --write (auto-fix)
bun run lint:web                     # Biome check web/src/
bun run lint:web:fix                 # Biome check --write web/src/
bun run format                       # Biome format --write everything
bun run format:check                 # Biome format --check (CI-safe, no writes)
```

## Testing

No test framework is currently configured. No test files exist.

## Pre-push Checks

Always run before pushing: `bun run lint && bun run typecheck`
Full precommit script: `bun run lint:fix && bun run format && bun run typecheck`

## Docker

```bash
bun run docker:up                    # docker compose up --build
bun run docker:down                  # docker compose down
bun run docker:logs                  # docker compose logs -f
```

## Database

```bash
bun run db:reset                     # Reset SQLite database
bun run db:seed                      # Seed database (scripts/db-seed.ts)
bun run db:migrate                   # Run migrations (src/core/db.ts)
```

## Project Structure

```
src/                        # Backend (Bun runtime)
├── index.ts                # Entry — API server + market loop
├── types.ts                # ALL shared TypeScript types
├── markets.ts              # Market definitions (BTC, ETH, SOL, XRP)
├── contracts.ts            # On-chain contract ABIs/addresses
├── utils.ts                # Shared utility functions
├── core/                   # Infrastructure layer
│   ├── config.ts           #   Zod-validated config (auto-reloads config.json)
│   ├── env.ts              #   Zod-validated env vars (.env)
│   ├── db.ts               #   SQLite setup + prepared statements
│   ├── logger.ts           #   Logger factory (createLogger)
│   ├── state.ts            #   Module singletons + EventEmitter
│   └── cache.ts            #   Caching layer
├── api/                    # HTTP + WebSocket server
│   ├── server.ts           #   Hono app setup
│   ├── routes.ts           #   REST route definitions
│   ├── ws.ts               #   WebSocket event handling
│   ├── middleware.ts        #   Auth, CORS, etc.
│   └── configSnapshot.ts   #   Config snapshot for API responses
├── bot/                    # Bot lifecycle
│   ├── heartbeat.ts        #   Health monitoring
│   ├── helpers.ts          #   Bot utility functions
│   └── windowBoundary.ts   #   15-min window settlement + reset
├── pipeline/               # Per-market processing: fetch → compute → decide
│   ├── fetch.ts            #   Parallel data collection
│   ├── compute.ts          #   Indicator computation
│   └── processMarket.ts    #   Decision + execution
├── engines/                # Core trading logic (pure functions)
│   ├── probability.ts      #   Scoring + probability blending
│   ├── edge.ts             #   Edge computation + trade decisions
│   ├── regime.ts           #   Market regime detection (TREND/RANGE/CHOP)
│   ├── ensemble.ts         #   Ensemble model aggregation
│   ├── signalQuality.ts    #   Signal quality scoring (k-NN)
│   ├── arbitrage.ts        #   Arbitrage opportunity detection
│   ├── positionSizing.ts   #   Kelly-criterion position sizing
│   ├── riskManagement.ts   #   Risk checks and limits
│   ├── feeOptimization.ts  #   Fee-aware order optimization
│   └── adaptiveThresholds.ts # Dynamic threshold adjustment
├── indicators/             # Technical analysis (pure functions)
│   ├── rsi.ts              #   RSI(14)
│   ├── macd.ts             #   MACD(12,26,9)
│   ├── vwap.ts             #   VWAP + slope
│   ├── heikenAshi.ts       #   Heiken Ashi candles
│   ├── incremental.ts      #   Incremental indicator updates
│   └── volatilityBuffer.ts #   Rolling volatility buffer
├── data/                   # External data adapters
│   ├── binance.ts          #   Binance REST (klines)
│   ├── binanceWs.ts        #   Binance WebSocket (live trades)
│   ├── polymarket.ts       #   Polymarket Gamma + CLOB API
│   ├── polymarketLiveWs.ts #   Polymarket live price WebSocket
│   ├── polymarketClobWs.ts #   Polymarket CLOB orderbook WebSocket
│   ├── chainlink.ts        #   Chainlink RPC price feeds
│   ├── chainlinkWs.ts      #   Chainlink WebSocket feeds
│   ├── polygonBalance.ts   #   Polygon balance queries
│   └── polygonEvents.ts    #   Polygon on-chain events
├── trading/                # Order execution + portfolio
│   ├── trader.ts           #   Trade execution entry point
│   ├── live.ts             #   Live trading via CLOB API
│   ├── orderManager.ts     #   Order lifecycle + status polling
│   ├── paperStats.ts       #   Paper trading P&L tracking
│   ├── persistence.ts      #   Signal/trade SQLite persistence
│   ├── accountState.ts     #   Account state management
│   ├── reconciler.ts       #   Position reconciliation
│   ├── redeemer.ts         #   On-chain position redemption
│   └── wallet.ts           #   Wallet connection management
├── strategy/               # Strategy tuning
│   ├── adaptive.ts         #   Adaptive parameter adjustment
│   └── refinement.ts       #   Backtest-driven refinement
└── ui/                     # Terminal UI
    └── terminal.ts         #   CLI status display

web/src/                    # Frontend (Vite 7 + React 19)
├── main.tsx                # App entry point
├── components/             # Dashboard, MarketCard, Header, etc.
│   ├── analytics/          #   Charts and analytics views
│   ├── ui/                 #   shadcn/ui primitives
│   └── ...                 #   Feature components (Dashboard, Header, etc.)
├── hooks/                  # Custom React hooks
├── lib/                    # API client, Zustand store, types, utils
│   ├── api.ts              #   Hono RPC client (type-safe)
│   ├── store.ts            #   Zustand state management
│   ├── ws.ts               #   WebSocket connection + events
│   ├── types.ts            #   Frontend-specific types
│   └── ...                 #   Formatting, chart helpers, constants
└── styles/                 # Tailwind CSS styles
```

## Code Style

### Formatting (enforced by Biome)

- **Indent**: tabs (width 2) · **Line width**: 120
- **Quotes**: double quotes (`"`) · **Semicolons**: always
- **Trailing commas**: all (including function params) · **Arrow parens**: always

### Biome Lint Rules (biome.json)

- `noUnusedVariables`: warn · `noUnusedImports`: warn
- `noExplicitAny`: warn · `noConsole`: warn
- `useConst`: error · `noNonNullAssertion`: warn
- `noParameterAssign`: off · `noForEach`: off

### Imports

```typescript
import fs from "node:fs";                       // 1. Node builtins — always node: protocol
import { Hono } from "hono";                   // 2. External packages — named imports
import { clamp } from "../utils.ts";            // 3. Internal — relative paths WITH .ts extension
import type { AppConfig } from "../types.ts";   // 4. Type-only — MUST use `import type`
```

Biome organizes imports automatically. Do not manually reorder.
Relative `.ts` extension is **required** by `verbatimModuleSyntax`.

**Frontend exception**: `web/` uses path aliases `@/*` → `web/src/*` and `@server/*` → `src/*`.
Backend code must NOT use path aliases — relative imports with `.ts` extension only.

### Types

- **All shared types** live in `src/types.ts` — `interface` for object shapes, `type` for unions/aliases
- Zod schemas for **runtime validation** (core/config.ts, core/env.ts) — infer with `z.infer<typeof Schema>`
- TypeScript strict mode: `noUncheckedIndexedAccess: true`
- Frontend types live in `web/src/lib/types.ts`

### Naming Conventions

| Element            | Convention       | Example                                   |
|--------------------|------------------|--------------------------------------------|
| Files              | camelCase        | `paperStats.ts`, `binanceWs.ts`            |
| Functions          | camelCase        | `computeRsi()`, `getCandleWindowTiming()`  |
| Interfaces/Types   | PascalCase       | `MarketConfig`, `Phase`, `Regime`          |
| Module constants   | UPPER_SNAKE_CASE | `MARKETS`, `CONFIG`, `REGIME_DISABLED`     |
| Local constants    | camelCase        | `const baseThreshold = ...`                |
| React components   | PascalCase       | `MarketCard.tsx`, `Dashboard.tsx`          |

### Functions & Error Handling

- **Named `function` declarations** for exported/top-level; **arrow functions** for callbacks
- **try/catch** with structured logging via `createLogger()` — always degrade to defaults
- **Zod** for validation errors — use `z.prettifyError()` for readable messages
- **API responses**: `{ ok: true, data }` | `{ ok: false, error: string }`
- **No custom Error subclasses** — use plain Error
- **Logging**: always use `createLogger("module-name")`, never raw `console.log`

## Architecture Notes

- **ESM-only** (`"type": "module"` in package.json)
- **No DI framework** — module-level singletons for shared state (src/core/state.ts)
- **Config**: `config.json` (strategy/risk, Zod-validated, auto-reloads) + `.env` (secrets, Zod-validated)
- **API**: Hono with chained routes in `src/api/routes.ts` for RPC type inference (`AppType` export)
- **Database**: SQLite via `src/core/db.ts` — use `statements` for prepared queries
- **Frontend**: TanStack Query + Zustand + WebSocket (`state:snapshot` events are single source of truth)
- **Docker**: multi-stage build, docker-compose for local dev
- **Named exports only** — no default exports anywhere in this codebase

## Things to Avoid

- `as any`, `@ts-ignore`, `@ts-expect-error` — fix the types properly
- Default exports — named exports exclusively
- `console.log` directly — use `createLogger()` factory
- Path aliases in backend — use relative imports with `.ts` extension
- Mixing runtime values into type-only imports (verbatimModuleSyntax enforced)
- Adding new dependencies without justification — prefer existing libraries
