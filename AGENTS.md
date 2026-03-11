# AGENTS.md — Orakel

Bun monorepo for Polymarket crypto up/down trading bot. Backend (Bun + Hono + PostgreSQL) deploys to VPS via Docker. Frontend (React 19 + Vite) deploys to Cloudflare Workers.

## Build & Run Commands

```bash
bun install                          # Install all workspace dependencies

bun run start                        # Start bot (packages/bot/src/index.ts, port 9999)
bun run dev                          # Start bot + web dashboard concurrently
bun run dev:bot                      # Start bot only (with watch mode)
bun run dev:web                      # Start frontend dev server only (Vite, port 5173)
bun run build                        # Build frontend for production

bun run typecheck                    # Typecheck all packages
bun run lint                         # Biome check (lint + format) all packages
bun run lint:fix                     # Biome check --write (auto-fix)
bun run format                       # Biome format --write
bun run check:ci                     # Run lint + typecheck + test (CI pipeline)

bun run test                         # Run all bot tests (vitest)
bunx vitest run src/__tests__/rsi.test.ts --config packages/bot/vitest.config.ts  # Single test file
bunx vitest run -t "clamp" --config packages/bot/vitest.config.ts                # Tests by name pattern

bunx drizzle-kit generate            # Generate migration from schema changes
bunx drizzle-kit migrate             # Apply pending migrations
bunx drizzle-kit push                # Push schema directly (dev only)

cd packages/web && bun run deploy    # Deploy frontend to Cloudflare Workers
```

## CI Pipeline

1. `bun run lint` — Lint all packages
2. `bun run typecheck` — Typecheck all packages
3. `bun run test` — Run tests
4. `docker build -f packages/bot/Dockerfile -t orakel:ci .` — Docker build

Always run `bun run check:ci` before pushing.

## Monorepo Structure

```
packages/
├── shared/                # Shared types and contracts (@orakel/shared)
│   ├── src/contracts/     # TypeScript interfaces + Zod schemas
│   ├── package.json
│   └── tsconfig.json
├── bot/                   # Backend trading bot (@orakel/bot)
│   ├── src/
│   │   ├── index.ts       # Entry point
│   │   ├── app/           # API routes, middleware, WebSocket
│   │   ├── core/          # Config, env, logger, state
│   │   ├── db/            # Drizzle ORM schema + client
│   │   ├── repositories/  # Data access layer
│   │   ├── runtime/       # Main loop, settlement, order management
│   │   ├── trading/       # Trade execution, account stats
│   │   ├── pipeline/      # Market data processing
│   │   ├── blockchain/    # On-chain operations
│   │   ├── engines/       # Edge, probability, regime detection
│   │   ├── indicators/    # RSI, MACD, VWAP (pure functions)
│   │   ├── data/          # External API adapters
│   │   └── __tests__/     # Test files (centralized)
│   ├── scripts/           # Utility scripts (approve-usdc, redeem, etc.)
│   ├── Dockerfile         # VPS deployment
│   └── docker-compose.yml # Local dev stack
└── web/                   # Frontend dashboard (@orakel/web)
    ├── src/
    │   ├── components/    # React components + shadcn/ui
    │   ├── lib/           # API client, stores, utils
    │   ├── hooks/         # Custom React hooks
    │   └── widgets/       # Page-level widgets
    ├── wrangler.toml      # Cloudflare Workers config
    └── vite.config.ts
```

## Code Style

### Formatting (Biome)

- **Indent**: tabs (width 2)
- **Line width**: 120
- **Quotes**: double quotes
- **Semicolons**: always
- **Trailing commas**: all
- **Arrow parentheses**: always `(x) => ...`

### Lint Rules

- `noUnusedVariables`: warn · `noUnusedImports`: warn
- `noExplicitAny`: warn · `noConsole`: warn
- `useConst`: error · `noNonNullAssertion`: warn
- Test overrides: `noExplicitAny` and `noNonNullAssertion` are OFF in `__tests__/`
- Logger override: `noConsole` is OFF in `packages/bot/src/core/logger.ts`

### Imports

```typescript
// 1. Node builtins — node: protocol
import fs from "node:fs";
// 2. External packages — named imports
import { Hono } from "hono";
// 3. Workspace packages
import type { MarketConfig } from "@orakel/shared/contracts";
// 4. Internal — relative paths WITH .ts extension
import { clamp } from "../core/utils.ts";
// 5. Type-only — MUST use `import type`
import type { AppConfig } from "./types.ts";
```

Biome organizes imports automatically. Do not manually reorder.

### Type Definitions

- Shared types in `packages/shared/src/contracts/` (config.ts, state.ts, http.ts)
- `interface` for object shapes, `type` for unions/aliases
- Zod schemas for runtime validation — infer with `z.infer<typeof Schema>`
- TypeScript strict mode with `noUncheckedIndexedAccess: true`
- Re-export from shared package: `export * from "@orakel/shared/contracts"`

### Naming Conventions

| Element            | Convention       | Example                                |
|--------------------|------------------|----------------------------------------|
| Files              | camelCase        | `accountStats.ts`, `binanceWs.ts`      |
| Functions          | camelCase        | `computeRsi()`, `getCandleWindow()`    |
| Interfaces/Types   | PascalCase       | `MarketConfig`, `TradeSignal`          |
| Module constants   | UPPER_SNAKE_CASE | `CONFIG`, `MARKETS`                    |
| Local constants    | camelCase        | `const baseThreshold = ...`            |
| React components   | PascalCase       | `MarketCard.tsx`, `Dashboard.tsx`      |
| Test files         | `{name}.test.ts` | `rsi.test.ts` in `__tests__/`          |

### Functions

- **Named `function`** for exported/top-level functions
- **Arrow functions** for callbacks, inline handlers, middleware

### Error Handling

- **try/catch** with structured logging via `createLogger()` — degrade to defaults
- **Zod** for validation errors — use `z.prettifyError()` for readable messages
- **API responses**: `{ ok: true, data }` | `{ ok: false, error: string }`
- **No custom Error subclasses** — use plain Error

### Logging

Use logger factory, never raw `console.log`:

```typescript
import { createLogger } from "../core/logger.ts";
const log = createLogger("module-name");
log.info("message", data);    // debug | info | warn | error
```

## Database (PostgreSQL + Drizzle ORM)

- **Schema**: `packages/bot/src/db/schema.ts` — all tables with `pgTable()`
- **Client**: `packages/bot/src/db/client.ts` — postgres driver + drizzle instance
- **Repositories**: `packages/bot/src/repositories/` — domain-specific query objects
- **Migrations**: `drizzle/` directory at project root
- **Config**: `drizzle.config.ts` at root (points to packages/bot/src/db/schema.ts)
- Use Drizzle query builder, never raw SQL strings

## Testing Conventions

Tests use **Vitest**, centralized in `__tests__/` (not co-located).
Test timeout: 10 seconds.

- One `describe` per exported function, descriptive `it("should ...")` names
- Factory helpers: `function makeStrategy(overrides = {}): StrategyConfig`
- `it.each([...])` for parameterized tests
- Pure functions tested without mocks — pass data directly
- `toBeCloseTo(value, precision)` for floating-point comparisons

## Architecture Notes

- **ESM-only** (`"type": "module"` in all package.json files)
- **No DI framework** — module-level singletons for shared state
- **Config**: `config.json` (Zod-validated, auto-reloads) + `.env` (secrets, Zod-validated)
- **API**: Hono with chained routes; `packages/bot/src/app/api/` has routes, middleware, WS
- **Frontend**: TanStack Query + Zustand + WebSocket (`state:snapshot` is source of truth)
- **Named exports only** — no default exports

## Things to Avoid

- `as any`, `@ts-ignore`, `@ts-expect-error` — fix types properly
- Default exports — named exports exclusively
- `console.log` directly — use `createLogger()` factory
- Path aliases in bot package — use relative imports with `.ts` extension
- Mixing runtime values into type-only imports (verbatimModuleSyntax enforced)
- Raw SQL strings — use Drizzle query builder via repositories
- Adding new dependencies without justification — prefer existing libraries
