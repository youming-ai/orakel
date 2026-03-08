# Backend Architecture

> Trading logic details live in [Core Logic](./core-logic.md). This document focuses on runtime structure, module boundaries, and API-facing backend design as of March 7, 2026.

## Overview

The backend is a single Bun process that hosts:

- the trading runtime loop
- the Hono API/WebSocket server
- wallet + Polymarket execution services
- on-chain reconciliation/redeem flows
- PostgreSQL persistence via Drizzle + `postgres`

The codebase is still ESM-only and still uses module-level singletons, but the runtime has now been split into `app/`, `runtime/`, `repositories/`, `contracts/`, and thinner `trading/` services instead of concentrating everything in `src/index.ts` and `src/api.ts`.

## Current Module Map

```text
src/
├── index.ts                # Composition root for the trading process
├── api.ts                  # Thin facade for app/api/server.ts
├── types.ts                # Compatibility barrel over split type modules
├── app/
│   ├── bootstrap.ts        # Process startup, wallet auto-connect, auto-redeem timer
│   ├── shutdown.ts         # Graceful shutdown wiring
│   └── api/
│       ├── middleware.ts
│       ├── routes.ts
│       ├── server.ts
│       └── wsBroadcaster.ts
├── contracts/
│   ├── config.ts           # Config DTOs
│   ├── http.ts             # HTTP response DTOs
│   └── ws.ts               # WS envelope/message DTOs
├── runtime/
│   ├── mainLoop.ts
│   ├── onchainRuntimeHandlers.ts
│   ├── streamFactory.ts
│   ├── orderPolling.ts
│   ├── liveSettlerRuntime.ts
│   ├── marketState.ts      # Per-market in-memory state helpers
│   ├── snapshotPublisher.ts
│   ├── settlementCycle.ts
│   ├── tradeDispatch.ts
│   ├── orderRecovery.ts
│   ├── orderStatusSync.ts
│   └── onchainRuntime.ts
├── repositories/
│   ├── tradeRepo.ts
│   ├── stateRepo.ts
│   ├── pendingOrderRepo.ts
│   ├── onchainRepo.ts
│   ├── dailyStatsRepo.ts
│   ├── kvRepo.ts
│   └── maintenanceRepo.ts
├── trading/
│   ├── trader.ts           # Facade only
│   ├── traderState.ts      # Shared wallet/client/heartbeat state
│   ├── walletService.ts
│   ├── heartbeatService.ts
│   ├── executionService.ts
│   ├── accountStats.ts     # Facade + singletons
│   ├── accountService.ts   # AccountStatsManager behavior
│   ├── accountPersistence.ts
│   ├── accountTypes.ts
│   ├── signalPayload.ts
│   ├── liveSettlerResolver.ts
│   ├── liveSettlerStore.ts
│   ├── orderManagerPersistence.ts
│   ├── orderManagerStatus.ts
│   ├── orderManager.ts
│   ├── liveSettler.ts
│   ├── persistence.ts
│   └── terminal.ts
├── core/
│   ├── configTypes.ts
│   └── marketDataTypes.ts
├── pipeline/
│   ├── fetch.ts
│   ├── compute.ts
│   └── processMarket.ts
├── blockchain/
│   ├── reconcilerMatching.ts
│   └── redeemTypes.ts
├── data/
├── db/
└── __tests__/
```

## Runtime Flow

`src/index.ts` is still the process entry point, but it is now mostly startup wiring:

1. `bootstrapApp()` starts API/config watchers and optional wallet auto-connect.
2. `createMarketStreams()` wires Binance, Chainlink, Polymarket live, and Polymarket CLOB streams.
3. `restoreRuntimeState()` reconstructs pending live state from persisted trades/orders.
4. `runMainLoop()` owns the recurring runtime cycle:
   - `ensureOrderPolling()`
   - `onchainRuntime.ensurePipelines()`
   - `runSettlementCycle()`
   - `liveSettler.ensure()`
   - `processMarket()` across all active markets
   - `dispatchTradeCandidates()`
   - `publishMarketSnapshots()`
5. `registerShutdownHandlers()` closes streams, timers, DB, and order polling.

This is still one process, but the side effects are no longer all embedded inline.

`onchainRuntime.ts` now mainly wires the Polygon balance/event/reconciler pipelines. Snapshot projection and event persistence live in [src/runtime/onchainRuntimeHandlers.ts](/Users/youming/GitHub/orakel/src/runtime/onchainRuntimeHandlers.ts).

## Supported Markets

The runtime currently targets Crypto multi-timeframe markets:

| Market | Window | Resolution Source | Polymarket Series |
|--------|--------|-------------------|-------------------|
| `BTC-15m` | 15 min | Chainlink | `btc-up-or-down-15m` |
| `ETH-15m` | 15 min | Chainlink | `eth-up-or-down-15m` |

Definitions live in [src/core/markets.ts](/Users/youming/GitHub/orakel/src/core/markets.ts).

## API Layer

The API server is implemented in `src/app/api/*` and re-exported through [src/api.ts](/Users/youming/GitHub/orakel/src/api.ts).

Key responsibilities:

- HTTP routes for state, trades, stats, config, controls, wallet info
- WebSocket client registration/broadcasting
- contract shaping through `src/contracts/*`

High-level route groups:

- `/api/state`
- `/api/trades`
- `/api/paper-stats`
- `/api/live-stats`
- `/api/config`
- `/api/paper/*`
- `/api/live/*`
- `/api/wallet/*`
- `/ws`

The frontend should treat `src/contracts/http.ts`, `src/contracts/ws.ts`, and `src/contracts/stateTypes.ts` as the backend contract boundary, not `src/types.ts`.

## Persistence

The project now uses PostgreSQL, not SQLite.

- driver: `postgres`
- ORM: `drizzle-orm/postgres-js`
- connection setup: [src/db/client.ts](/Users/youming/GitHub/orakel/src/db/client.ts)
- schema: [src/db/schema.ts](/Users/youming/GitHub/orakel/src/db/schema.ts)

Repository responsibilities are split by aggregate:

- trade history and trade status
- paper/live account state
- pending live orders
- on-chain event/token knowledge
- daily stats / maintenance / kv helpers

`src/db/queries.ts` is now a re-export barrel over `src/repositories/*`.

## Trading Services

The former monolithic `trader.ts` has been decomposed:

- [walletService.ts](/Users/youming/GitHub/orakel/src/trading/walletService.ts)
  - wallet connection
  - CLOB client initialization
  - API credential loading/derivation
- [heartbeatService.ts](/Users/youming/GitHub/orakel/src/trading/heartbeatService.ts)
  - GTD order tracking
  - heartbeat start/stop
  - heartbeat reconnect backoff
  - live-trade gating
- [executionService.ts](/Users/youming/GitHub/orakel/src/trading/executionService.ts)
  - paper execution
  - live FOK/GTD execution
  - pending-order persistence
  - event emission / post-trade accounting
- [signalPayload.ts](/Users/youming/GitHub/orakel/src/trading/signalPayload.ts)
  - trade signal payload shaping
  - websocket signal event shaping
- [orderManagerPersistence.ts](/Users/youming/GitHub/orakel/src/trading/orderManagerPersistence.ts)
  - pending order load/sync helpers
- [orderManagerStatus.ts](/Users/youming/GitHub/orakel/src/trading/orderManagerStatus.ts)
  - order status normalization
  - active-window counting rules
- [liveSettlerStore.ts](/Users/youming/GitHub/orakel/src/trading/liveSettlerStore.ts)
  - redeemed trade id persistence
- [liveSettlerResolver.ts](/Users/youming/GitHub/orakel/src/trading/liveSettlerResolver.ts)
  - conditionId resolution for redeem flows
- [traderState.ts](/Users/youming/GitHub/orakel/src/trading/traderState.ts)
  - shared in-memory execution state

[src/trading/trader.ts](/Users/youming/GitHub/orakel/src/trading/trader.ts) remains only as a compatibility facade.

## Account State

Account tracking has also been separated:

- [accountTypes.ts](/Users/youming/GitHub/orakel/src/trading/accountTypes.ts)
- [accountPersistence.ts](/Users/youming/GitHub/orakel/src/trading/accountPersistence.ts)
- [accountService.ts](/Users/youming/GitHub/orakel/src/trading/accountService.ts)
- [accountStats.ts](/Users/youming/GitHub/orakel/src/trading/accountStats.ts) facade + singletons

`AccountStatsManager` still owns:

- balances / reserved balances
- pending + resolved trade memory
- stop-loss flags
- daily PnL aggregation
- trade resolution logic

But DB/file persistence has been moved out of the class body.

## Type Split

The shared type layer has started moving out of the old monolithic file, and the runtime/core/api path now imports these split modules directly:

- [configTypes.ts](/Users/youming/GitHub/orakel/src/core/configTypes.ts)
- [marketDataTypes.ts](/Users/youming/GitHub/orakel/src/core/marketDataTypes.ts)
- [tradeTypes.ts](/Users/youming/GitHub/orakel/src/trading/tradeTypes.ts)
- [stateTypes.ts](/Users/youming/GitHub/orakel/src/contracts/stateTypes.ts)
- [redeemTypes.ts](/Users/youming/GitHub/orakel/src/blockchain/redeemTypes.ts)

[src/types.ts](/Users/youming/GitHub/orakel/src/types.ts) remains as a compatibility barrel so external callers and staged migrations still have a stable import surface, but backend source modules no longer depend on it directly.

## Remaining Refactor Debt

The backend is materially cleaner than before, but these are still open:

- `src/index.ts` is smaller but still the composition root for startup and loop orchestration
- the strategy layer now uses per-market overrides and a replay/backtest entrypoint, but profitability calibration still needs broader historical runs and parameter tuning
- `liveSettler.ts` is thinner now, but settlement/redeem behavior is still spread across trading and blockchain helpers
- some persistence and reconciliation write paths still mix orchestration with storage updates

## Verification Baseline

For this refactor stage, the reliable checks are:

```bash
bun run typecheck
./node_modules/.bin/biome check <targeted files>
```

Full-repo lint/build may still be blocked by pre-existing issues outside the refactor scope or local Node version constraints on the frontend build.

## Replay Calibration

The backtest entrypoint at [src/backtest/replay.ts](/Users/youming/GitHub/orakel/src/backtest/replay.ts) now supports both quote and fill modes:

- `quote=fixed`: synthetic neutral Polymarket odds (`0.5/0.5`) for fast signal calibration
- `quote=historical`: replay injects historical Polymarket token prices into `computeEdge()`
- `quoteScope=traded`: optimization mode that first finds candidate windows with the fast replay, then loads historical quotes only for those windows
- `fill=fixed`: synthetic even-odds fills for fast signal-quality replay
- `fill=historical`: fills and PnL are repriced from historical Gamma market metadata plus CLOB `prices-history`

That means replay is now split into two levels:

- fast signal calibration
- slower approximate trade replay with historical entry prices and binary-option PnL
- slower still but more realistic replay where both edge computation and fills use historical Polymarket prices
