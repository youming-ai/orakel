# AGENTS.md — Orakel

Automated trading bot for Polymarket crypto up/down markets (15m).
Backend: Bun + TypeScript + Hono + PostgreSQL (Drizzle ORM). Frontend: React 19 + Vite + shadcn/ui + Tailwind v4.

## Build & Run Commands

```bash
bun install                          # Install backend dependencies
cd web && bun install                # Install frontend dependencies

bun run start                        # Start bot (src/index.ts, port 9999)
bun run dev                          # Start bot + web dashboard concurrently
cd web && bun run dev                # Start frontend dev server only (Vite, port 5173)

bun run typecheck                    # Typecheck all src/ (includes tests)
bun run typecheck:ci                 # Typecheck src/ excluding test files
bun run lint                         # Biome check (lint + format) src/
bun run lint:fix                     # Biome check --write (auto-fix)
bun run format                       # Biome format --write src/

bun run test                         # Run all tests (vitest)
bunx vitest run src/__tests__/rsi.test.ts   # Run a single test file
bunx vitest run -t "clamp"           # Run tests matching name pattern
bun run test:watch                   # Vitest in watch mode

bunx drizzle-kit generate            # Generate migration from schema changes
bunx drizzle-kit migrate             # Apply pending migrations
bunx drizzle-kit push                # Push schema directly (dev only)
```

## CI Pipeline (.github/workflows/ci.yml)

1. `bunx biome lint src/` — Lint only (stricter than `bun run lint`)
2. `bunx tsc --noEmit -p tsconfig.check.json` — Typecheck (excludes test files)
3. `bun run test` — Tests
4. `docker build -t orakel:ci` — Docker build (runs after checks pass)

Always run `bun run lint && bun run typecheck && bun run test` before pushing.

## Project Structure

```
src/
├── index.ts                   # Entry point, main loop startup
├── api.ts                     # Hono API server + WebSocket (legacy, see app/api/)
├── types.ts                   # ALL shared TypeScript interfaces/types
├── app/                       # Application lifecycle
│   ├── api/                   # Routes, middleware, server, WebSocket broadcaster
│   ├── bootstrap.ts           # Startup sequence (wallet, config, auto-redeem)
│   └── shutdown.ts            # Graceful shutdown
├── core/                      # Config, env, logger, state, utils, cache, markets
├── db/                        # Database layer (Drizzle ORM + PostgreSQL)
│   ├── schema.ts              # All table definitions (pgTable)
│   ├── client.ts              # postgres connection + drizzle instance
│   ├── queries.ts             # Shared query helpers
│   └── index.ts               # Re-exports
├── repositories/              # Data access — query objects per domain
│   ├── tradeRepo.ts           # Trade CRUD + settlement queries
│   ├── dailyStatsRepo.ts      # Daily P&L tracking
│   ├── stateRepo.ts           # Paper/live state persistence
│   ├── kvRepo.ts              # Key-value store
│   ├── pendingOrderRepo.ts    # Live order tracking
│   ├── onchainRepo.ts         # On-chain events + balance snapshots
│   └── maintenanceRepo.ts     # DB pruning / maintenance
├── runtime/                   # Runtime orchestration (cycles, state machines)
│   ├── marketState.ts         # Per-market state management
│   ├── settlementCycle.ts     # Settlement timing and execution
│   ├── tradeDispatch.ts       # Trade routing (paper vs live)
│   ├── orderRecovery.ts       # Recover pending orders on restart
│   ├── orderStatusSync.ts     # Sync order status from Polymarket
│   ├── onchainRuntime.ts      # On-chain monitoring runtime
│   └── snapshotPublisher.ts   # WebSocket state broadcasting
├── contracts/                 # Polymarket contract config (addresses, ABIs)
├── trading/                   # Trade execution, account stats, order management
├── pipeline/                  # Per-market processing: fetch → compute → processMarket
├── blockchain/                # On-chain: account state, reconciliation, redemption
├── engines/                   # Edge, probability, regime detection
├── indicators/                # RSI, MACD, VWAP, Heiken Ashi (pure functions)
├── data/                      # External adapters: Binance, Polymarket, Chainlink
└── __tests__/                 # All test files (centralized, not co-located)

web/                           # Frontend (Vite + React 19)
├── src/components/            # Dashboard, MarketCard, Header, TradeTable + ui/ (shadcn)
├── src/lib/                   # API client, Zustand stores, types, utils
├── src/hooks/                 # Custom React hooks
└── src/pages/                 # Page-level components
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
- **Logger override**: `noConsole` is OFF in `src/core/logger.ts`

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

## Database (PostgreSQL + Drizzle ORM)

- **Schema**: `src/db/schema.ts` — all tables defined with `pgTable()`
- **Client**: `src/db/client.ts` — `postgres` driver, exported `db` (drizzle instance)
- **Repositories**: `src/repositories/` — domain-specific query objects (not raw SQL)
- **Migrations**: `drizzle/` directory, managed by `drizzle-kit`
- **Config**: `drizzle.config.ts` at project root
- New DB code should use repositories or add queries to existing repo files.
  Do NOT use raw SQL strings — use Drizzle query builder.

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
- **API**: Hono with chained routes; `src/app/api/` has routes, middleware, server, WS broadcaster
- **Database**: PostgreSQL via Drizzle ORM (`src/db/`), repository pattern (`src/repositories/`)
- **Frontend**: TanStack Query + Zustand + WebSocket (`state:snapshot` events are single source of truth)
- **Docker**: multi-stage build, docker-compose for local dev
- **Named exports only** — no default exports anywhere in this codebase

## Things to Avoid

- `as any`, `@ts-ignore`, `@ts-expect-error` — fix the types properly
- Default exports — named exports exclusively
- `console.log` directly — use `createLogger()` factory
- Path aliases — use relative imports with `.ts` extension
- Mixing runtime values into type-only imports (verbatimModuleSyntax enforced)
- Raw SQL strings — use Drizzle query builder via repositories
- Adding new dependencies without justification — prefer existing libraries
