# AGENTS.md — Orakel

Automated trading bot for Polymarket 15-minute crypto up/down markets.
Backend: Bun + TypeScript + Hono + SQLite. Frontend: React 19 + Vite + shadcn/ui + Tailwind v4.

## Build & Run Commands

```bash
bun install                          # Install backend dependencies
cd web && bun install                # Install frontend dependencies

bun run start                        # Start bot (src/index.ts, port 9999)
cd web && bun run dev                # Start frontend dev server (Vite default port)

bun run typecheck                    # Typecheck all src/ (includes tests)
bun run typecheck:ci                 # Typecheck src/ excluding test files
bun run lint                         # Biome check (lint + format) src/
bun run lint:fix                     # Biome check --write (auto-fix)
bun run format                       # Biome format --write src/

bun run test                         # Run all tests (vitest)
bunx vitest run src/__tests__/rsi.test.ts   # Run a single test file
bunx vitest run -t "clamp"           # Run tests matching name pattern
bun run test:watch                   # Vitest in watch mode
```

## CI Pipeline (.github/workflows/ci.yml)

1. `bunx biome lint src/` — Lint only (stricter than `bun run lint`)
2. `tsc --noEmit -p tsconfig.check.json` — Typecheck (excludes test files)
3. `bun run test` — Tests
4. `docker build -t orakel:ci .` — Docker build (runs after checks pass)

Always run `bun run lint && bun run typecheck && bun run test` before pushing.

## Project Structure

```
src/                           # Backend (Bun runtime)
├── index.ts                   # Entry point, main loop startup
├── api.ts                     # Hono API server + WebSocket (~800 lines)
├── types.ts                   # ALL shared TypeScript interfaces/types
├── core/                      # Foundational modules
│   ├── config.ts              # Zod-validated config loader (auto-reloads)
│   ├── env.ts                 # Zod-validated environment variables
│   ├── logger.ts              # Logger factory (createLogger)
│   ├── state.ts               # Shared runtime state (singletons + EventEmitter)
│   ├── db.ts                  # SQLite setup + prepared statements
│   ├── cache.ts               # Caching utilities
│   ├── markets.ts             # Market definitions (BTC, ETH, SOL, XRP)
│   └── utils.ts               # Pure utility functions
├── trading/                   # Trade execution & account management
│   ├── trader.ts              # Trade execution, wallet management
│   ├── accountStats.ts        # Paper/live account tracking + settlement
│   ├── orderManager.ts        # Live order polling lifecycle
│   ├── liveGuards.ts          # Pre-trade safety checks for live mode
│   ├── liveSettler.ts         # Live trade settlement
│   ├── persistence.ts         # Trade/signal persistence layer
│   ├── strategyRefinement.ts  # Backtest insights + market adjustments
│   └── terminal.ts            # Terminal output formatting
├── pipeline/                  # Per-market processing pipeline
│   ├── processMarket.ts       # Main per-market loop (runs every 1s)
│   ├── fetch.ts               # Parallel data fetching from all sources
│   └── compute.ts             # Indicator + probability computation
├── blockchain/                # On-chain operations
│   ├── accountState.ts        # On-chain account/position queries
│   ├── contracts.ts           # Contract interaction helpers
│   ├── reconciler.ts          # On-chain vs local state reconciliation
│   ├── reconciler-utils.ts    # Reconciliation utilities
│   └── redeemer.ts            # Position redemption
├── engines/                   # Core trading logic
│   ├── edge.ts                # Edge computation + confidence scoring + decisions
│   ├── probability.ts         # TA scoring + vol-implied prob + blending
│   ├── regime.ts              # Market state detection (TREND/RANGE/CHOP)
│   └── arbitrage.ts           # Arbitrage detection
├── indicators/                # Technical analysis (pure functions)
│   ├── rsi.ts, macd.ts, vwap.ts, heikenAshi.ts
├── data/                      # External data source adapters
│   ├── binance.ts/binanceWs.ts            # Binance REST + WebSocket
│   ├── polymarket.ts/polymarketLiveWs.ts  # Gamma + CLOB API + live WS
│   ├── polymarketClobWs.ts                # CLOB WebSocket client
│   ├── chainlink.ts/chainlinkWs.ts        # On-chain RPC + WebSocket
│   └── polygonBalance.ts/polygonEvents.ts # Polygon chain queries
└── __tests__/                 # All test files (centralized, not co-located)
    ├── rsi.test.ts, edge.test.ts, probability.test.ts, ...

web/                           # Frontend (Vite + React 19)
├── src/
│   ├── components/            # Dashboard, MarketCard, Header, TradeTable, etc.
│   │   ├── ui/                # shadcn/ui primitives
│   │   ├── analytics/         # Charts and analytics components
│   │   ├── market/            # Market-specific components
│   │   └── trades/            # Trade display components
│   ├── lib/                   # API client, Zustand stores, types, utils
│   ├── hooks/                 # Custom React hooks
│   ├── pages/                 # Page-level components
│   └── styles/                # Global styles
```

## Code Style

### Formatting (enforced by Biome)

- **Indent**: tabs (width 2)
- **Line width**: 120
- **Quotes**: double quotes (`"`)
- **Semicolons**: always
- **Trailing commas**: all (including function params)
- **Arrow parentheses**: always (`(x) => ...`, never `x => ...`)

### Biome Lint Rules (biome.json)

- `noUnusedVariables`: warn · `noUnusedImports`: warn
- `noExplicitAny`: warn · `noConsole`: warn
- `useConst`: error · `noNonNullAssertion`: warn
- `noParameterAssign`: off · `noForEach`: off
- **Test overrides**: `noExplicitAny` and `noNonNullAssertion` are OFF in `src/__tests__/`

### Imports

```typescript
// 1. Node builtins — always node: protocol
import fs from "node:fs";
// 2. External packages — named imports
import { Hono } from "hono";
// 3. Internal — relative paths WITH .ts extension (required by verbatimModuleSyntax)
import { clamp } from "./core/utils.ts";
// 4. Type-only — MUST use `import type` (enforced by verbatimModuleSyntax)
import type { AppConfig } from "./types.ts";
```

Biome organizes imports automatically. Do not manually reorder.

### Type Definitions

- **All shared types** live in `src/types.ts` — interfaces, type aliases, enums
- `interface` for object shapes, `type` for unions/aliases
- Zod schemas for **runtime validation** (config.ts, env.ts) — infer with `z.infer<typeof Schema>`
- TypeScript strict mode with `noUncheckedIndexedAccess: true`
- Frontend types live in `web/src/lib/types.ts`

### Naming Conventions

| Element            | Convention       | Example                                |
|--------------------|------------------|----------------------------------------|
| Files              | camelCase        | `accountStats.ts`, `binanceWs.ts`      |
| Functions          | camelCase        | `computeRsi()`, `getCandleWindowTiming()` |
| Interfaces/Types   | PascalCase       | `MarketConfig`, `Phase`, `Regime`      |
| Module constants   | UPPER_SNAKE_CASE | `MARKETS`, `CONFIG`, `READ_BACKEND`    |
| Local constants    | camelCase        | `const baseThreshold = ...`            |
| React components   | PascalCase       | `MarketCard.tsx`, `Dashboard.tsx`      |
| Test files         | `{name}.test.ts` | `rsi.test.ts` in `src/__tests__/`      |

### Functions

- **Named `function` declarations** for exported/top-level functions
- **Arrow functions** for callbacks, inline handlers, middleware

### Error Handling

- **try/catch** with structured logging via `createLogger()` — always degrade to defaults
- **Zod** for validation errors — use `z.prettifyError()` for readable messages
- **API responses**: `{ ok: true, data }` | `{ ok: false, error: string }`
- **No custom Error subclasses** — use plain Error

### Logging

Use the logger factory, never raw `console.log`:
```typescript
import { createLogger } from "./core/logger.ts";
const log = createLogger("module-name");
log.info("message", data);    // debug | info | warn | error
```

## Testing Conventions

Tests use **Vitest**, centralized in `src/__tests__/` (not co-located with source).
Test timeout: 10 seconds (vitest.config.ts).

- One `describe` per exported function, descriptive `it("should ...")` names
- Factory helpers for complex data: `function makeStrategy(overrides = {}): StrategyConfig`
- `it.each([...])` for parameterized tests
- Pure functions tested without mocks — pass data directly
- `toBeCloseTo(value, precision)` for floating-point comparisons

## Architecture Notes

- **ESM-only** (`"type": "module"` in package.json)
- **No DI framework** — module-level singletons for shared state
- **Config**: `config.json` (strategy/risk, Zod-validated, auto-reloads) + `.env` (secrets, Zod-validated)
- **API**: Hono with chained routes for RPC type inference (`AppType` export)
- **Database**: SQLite primary (`src/core/db.ts`), CSV legacy. New code uses `statements` from db.ts
- **Frontend**: TanStack Query + Zustand + WebSocket (`state:snapshot` events are single source of truth)
- **Docker**: multi-stage build (bot-deps → web-build → release), docker-compose for local dev
- **Named exports only** — no default exports anywhere in this codebase

## Things to Avoid

- `as any`, `@ts-ignore`, `@ts-expect-error` — fix the types properly
- Default exports — named exports exclusively
- `console.log` directly — use `createLogger()` factory
- Path aliases — use relative imports with `.ts` extension
- Mixing runtime values into type-only imports (verbatimModuleSyntax enforced)
- Adding new dependencies without justification — prefer existing libraries
