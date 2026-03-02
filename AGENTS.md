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
```

## Lint / Typecheck

```bash
bun run typecheck                    # Typecheck all src/
bun run typecheck:web                # Typecheck web/src/ only
bun run lint                         # Biome check (lint + format) src/
bun run lint:fix                     # Biome check --write (auto-fix)
bun run lint:web                     # Biome check web/src/
bun run lint:web:fix                 # Biome check --write web/src/
bun run format                       # Biome format --write everything

```

## Pre-push Checks

Always run before pushing: `bun run lint && bun run typecheck`
Full precommit script: `bun run lint:fix && bun run format && bun run typecheck`

## Project Structure

```
src/                    # Backend (Bun runtime)
├── index.ts            # Entry — API server + market loop
├── api.ts              # Hono API + WebSocket events
├── types.ts            # ALL shared TypeScript types
├── config.ts           # Zod-validated config (auto-reloads config.json)
├── env.ts              # Zod-validated env vars (.env)
├── db.ts               # SQLite setup + prepared statements
├── logger.ts           # Logger factory (createLogger)
├── state.ts            # Module singletons + EventEmitter
├── pipeline/           # fetch → compute → processMarket per market
├── data/               # External sources (Binance, Polymarket, Chainlink, Polygon)
├── engines/            # Core trading logic (pure functions)
└── indicators/         # TA indicators (RSI, MACD, VWAP, Heiken Ashi, etc.)

web/src/                # Frontend (Vite 7 + React 19)
├── components/         # Dashboard, MarketCard, Header, TradeTable, etc.
│   └── ui/             # shadcn/ui primitives
└── lib/                # API client, Zustand stores, types, utils
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
import fs from "node:fs";                    // 1. Node builtins — always node: protocol
import { Hono } from "hono";                // 2. External packages — named imports
import { clamp } from "./utils.ts";         // 3. Internal — relative paths WITH .ts extension
import type { AppConfig } from "./types.ts"; // 4. Type-only — MUST use `import type`
```

Biome organizes imports automatically. Do not manually reorder.
Relative `.ts` extension is **required** by `verbatimModuleSyntax`.

**Frontend exception**: `web/` uses path aliases `@/*` → `web/src/*` and `@server/*` → `src/*`.
Backend code must NOT use path aliases — relative imports with `.ts` extension only.

### Types

- **All shared types** live in `src/types.ts` — `interface` for object shapes, `type` for unions/aliases
- Zod schemas for **runtime validation** (config.ts, env.ts) — infer with `z.infer<typeof Schema>`
- TypeScript strict mode: `noUncheckedIndexedAccess: true`
- Frontend types live in `web/src/lib/types.ts`

### Naming Conventions

| Element            | Convention       | Example                                |
|--------------------|------------------|----------------------------------------|
| Files              | camelCase        | `paperStats.ts`, `binanceWs.ts`        |
| Functions          | camelCase        | `computeRsi()`, `getCandleWindowTiming()` |
| Interfaces/Types   | PascalCase       | `MarketConfig`, `Phase`, `Regime`      |
| Module constants   | UPPER_SNAKE_CASE | `MARKETS`, `CONFIG`, `REGIME_DISABLED` |
| Local constants    | camelCase        | `const baseThreshold = ...`            |
| React components   | PascalCase       | `MarketCard.tsx`, `Dashboard.tsx`      |

### Functions & Error Handling

- **Named `function` declarations** for exported/top-level; **arrow functions** for callbacks
- **try/catch** with structured logging via `createLogger()` — always degrade to defaults
- **Zod** for validation errors — use `z.prettifyError()` for readable messages
- **API responses**: `{ ok: true, data }` | `{ ok: false, error: string }`
- **No custom Error subclasses** — use plain Error
- **Logging**: always use `createLogger("module-name")`, never raw `console.log`


## Architecture Notes

- **ESM-only** (`"type": "module"` in package.json)
- **No DI framework** — module-level singletons for shared state
- **Config**: `config.json` (strategy/risk, Zod-validated, auto-reloads) + `.env` (secrets, Zod-validated)
- **API**: Hono with chained routes for RPC type inference (`AppType` export)
- **Database**: SQLite via `src/db.ts`. New code uses `statements` from db.ts
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
