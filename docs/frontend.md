# Frontend Architecture

> This document reflects the current frontend structure after the app/router/ws/widgets/entities refactor stage completed on March 7, 2026.

## Overview

The frontend is a React 19 + Vite dashboard for monitoring and controlling the bot in real time.

Current stack:

- React 19
- TypeScript
- React Router
- TanStack Query
- Zustand
- shadcn/ui + Tailwind v4
- Recharts

The frontend is no longer just `pages + components + lib`. It now has explicit `app`, `contracts`, `widgets`, `entities`, `features`, and `shared` boundaries, although some old `components/*` implementations still exist and are being phased out.

## Current Structure

```text
web/src/
├── App.tsx
├── app/
│   ├── AppShell.tsx
│   ├── router.tsx
│   ├── layout/
│   │   └── AppLayout.tsx
│   └── ws/
│       ├── cacheSync.ts
│       └── useDashboardStateWithWs.ts
├── contracts/
│   ├── http.ts
│   └── ws.ts
├── entities/
│   ├── account/
│   │   └── queries.ts
│   ├── market/
│   │   └── MarketCard.tsx
│   └── trade/
│       └── queries.ts
├── features/
│   └── botControl/
│       ├── ConfirmToggleDialog.tsx
│       └── mutations.ts
├── shared/
│   └── query/
│       └── queryKeys.ts
├── widgets/
│   ├── overview/
│   │   ├── OverviewPanel.tsx
│   │   └── OverviewTab.tsx
│   └── trades/
│       ├── TradesPanel.tsx
│       ├── TradesTab.tsx
│       ├── TradeTable.tsx
│       ├── TradeTableDesktop.tsx
│       ├── TradeTableMobile.tsx
│       └── MarketComparisonTable.tsx
├── pages/
│   ├── Dashboard.tsx
│   └── Trades.tsx
├── components/              # Legacy implementations + compatibility layer
├── lib/                     # Existing utilities, formatters, client wrappers
├── hooks/
└── styles/
```

## Runtime Composition

Top-level runtime flow:

1. [App.tsx](/Users/youming/GitHub/orakel/web/src/App.tsx) renders [AppShell.tsx](/Users/youming/GitHub/orakel/web/src/app/AppShell.tsx)
2. `AppShell` loads dashboard state, wires start/stop mutations, and owns the confirm dialog
3. [router.tsx](/Users/youming/GitHub/orakel/web/src/app/router.tsx) mounts routes inside [AppLayout.tsx](/Users/youming/GitHub/orakel/web/src/app/layout/AppLayout.tsx)
4. pages are intentionally thin:
   - [Dashboard.tsx](/Users/youming/GitHub/orakel/web/src/pages/Dashboard.tsx) -> `OverviewPanel`
   - [Trades.tsx](/Users/youming/GitHub/orakel/web/src/pages/Trades.tsx) -> `TradesPanel`

This keeps routing/layout concerns out of analytics and trade presentation code.

## Data Contracts

The frontend no longer defines backend DTOs ad hoc in API helpers.

Contract boundary:

- [web/src/contracts/http.ts](/Users/youming/GitHub/orakel/web/src/contracts/http.ts)
- [web/src/contracts/ws.ts](/Users/youming/GitHub/orakel/web/src/contracts/ws.ts)

These mirror backend-facing response/message shapes and should be the first place to update when backend contracts change.

## State Model

### UI State

Zustand is still used for ephemeral UI state, primarily:

- current `viewMode`
- pending confirm action

### Server State

TanStack Query remains the source of truth for HTTP-fetched backend state:

- dashboard snapshot
- paper/live stats
- trades

### Real-Time Sync

WebSocket cache sync is now explicitly separated into `app/ws/*` instead of being mixed into a monolithic queries file.

Important pieces:

- [cacheSync.ts](/Users/youming/GitHub/orakel/web/src/app/ws/cacheSync.ts)
- [useDashboardStateWithWs.ts](/Users/youming/GitHub/orakel/web/src/app/ws/useDashboardStateWithWs.ts)

When WS is healthy, cache updates flow through these adapters rather than page-level merge logic.

## Query / Mutation Boundaries

The old `web/src/lib/queries.ts` now acts as a facade over split modules.

Current responsibility split:

- entity-level reads
  - [entities/account/queries.ts](/Users/youming/GitHub/orakel/web/src/entities/account/queries.ts)
  - [entities/trade/queries.ts](/Users/youming/GitHub/orakel/web/src/entities/trade/queries.ts)
- feature-level write actions
  - [features/botControl/mutations.ts](/Users/youming/GitHub/orakel/web/src/features/botControl/mutations.ts)
- shared query keys
  - [shared/query/queryKeys.ts](/Users/youming/GitHub/orakel/web/src/shared/query/queryKeys.ts)

## Presentation Layers

The intended layering is now:

- `pages/` choose which widget to render
- `widgets/` assemble page-sized UI sections
- `features/` own user actions or workflows
- `entities/` expose reusable domain presentation units
- `components/` remains as a legacy bucket during migration

Examples already moved:

- dashboard summary rendering now enters via `widgets/overview/*`
- trade-history rendering now enters via `widgets/trades/*`
- market card now has an `entities/market/MarketCard.tsx` entry point

Some widgets currently re-export or wrap older `components/*` implementations. That is intentional and keeps the migration incremental rather than breaking imports all at once.

## Routes

Current routes:

- `/` -> dashboard
- `/logs` -> trades/logs view
- unknown routes -> redirect to `/`

The route shell uses [AppLayout.tsx](/Users/youming/GitHub/orakel/web/src/app/layout/AppLayout.tsx), while [components/Layout.tsx](/Users/youming/GitHub/orakel/web/src/components/Layout.tsx) is now only a compatibility wrapper.

## Remaining Refactor Debt

The frontend has crossed the “new structure exists” stage, but not the “legacy layer fully removed” stage yet.

Still pending:

- move more real implementations out of `components/analytics`, `components/trades`, and `components/market`
- narrow `web/src/lib/*` down to transport/utilities instead of mixed concerns
- introduce more entity-specific adapters/selectors instead of page-local shaping
- remove compatibility re-exports once call sites are fully updated

## Verification Baseline

Reliable checks for the refactor stage:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/biome check <targeted files>
```

`vite build` may still depend on the local Node version meeting Vite's minimum requirement.
