# Orakel System Architecture

## 1. System Overview

Orakel is an automated trading bot for Polymarket 15-minute cryptocurrency Up/Down markets.

**Tech Stack**

- Backend: Bun Runtime + TypeScript + Hono + SQLite
- Frontend: React 19 + Vite + shadcn/ui + Tailwind v4
- Repository Structure: Monorepo (`src/` backend + `web/` frontend)

**Core Features**

- Backend single process hosts both API service and trading logic
- Supports both Paper Trading and Live Trading modes
- Communication Layer: REST API for initial load and mutations, WebSocket for real-time state snapshots
- Data Sources: Binance (price/klines), Polymarket (markets/orderbook), Chainlink (on-chain oracle)

---

## 2. Architecture Diagram

```
External Data Sources                Backend (Bun Runtime)                      Frontend (React 19)
┌──────────────────┐     ┌─────────────────────────────────────┐    ┌────────────────────┐
│ Binance REST/WS  │────>│ Data Layer (src/data/)              │    │ Dashboard          │
│ Polymarket API   │────>│   ├ binance.ts / binanceWs.ts       │    │   ├ Header         │
│ Polymarket WS    │────>│   ├ polymarket.ts / polymarketLiveWs│    │   ├ MarketCard[]   │
│ Chainlink RPC    │────>│   ├ chainlink.ts / chainlinkWs.ts   │    │   ├ AnalyticsTabs  │
│ Chainlink WS     │     │   ├ polymarketClobWs.ts             │    │   └ TradeTable     │
│ CLOB WS          │     │   └ polygonEvents.ts / Balance.ts   │    └────────────────────┘
└──────────────────┘     │                                     │              ↑
                         │ Engine Layer (src/engines/)        │    ┌──────────┴─────────┐
                         │   ├ probability.ts (probability)   │    │ REST API (/api/*)   │
                         │   ├ regime.ts (market state)       │    │ WebSocket (/ws)     │
                         │   ├ edge.ts (decision & edge)      │    └────────────────────┘
                         │   └ arbitrage.ts (arbitrage)       │              ↑
                         │                                     │              │
                         │                                     │              │
                         │                                     │──────────────┘
                         │ Indicators Layer (src/indicators/)  │
                         │   ├ rsi.ts      ├ macd.ts          │
                         │   ├ vwap.ts     └ heikenAshi.ts    │
                         │                                     │
                         │ Trading Layer (src/trading/)       │
                         │   ├ trader.ts (execution)          │
                         │   ├ orderManager.ts (orders)       │
                         │   ├ accountStats.ts (account stats)│
                         │   ├ persistence.ts (persistence)   │
                         │   ├ liveGuards.ts (live safety)    │
                         │   └ strategyRefinement / terminal   │
                         │                                     │
                         │ Blockchain Layer (src/blockchain/) │
                         │   ├ contracts.ts (contracts)       │
                         │   ├ reconciler.ts (reconciliation)  │
                         │   ├ redeemer.ts (redemption)        │
                         │   └ accountState.ts (account)      │
                         │                                     │
                         │ Pipeline Layer (src/pipeline/)     │
                         │   ├ fetch.ts (data fetch)          │
                         │   ├ compute.ts (indicators)        │
                         │   └ processMarket.ts (market)      │
                         │                                     │
                         │ Core Layer (src/core/)             │
                         │   ├ config.ts (config)             │
                         │   ├ env.ts (environment)           │
                         │   ├ state.ts (shared state)        │
                         │   ├ db.ts (SQLite)                 │
                         │   ├ logger.ts (logging)            │
                         │   ├ markets.ts (markets)           │
                         │   ├ utils.ts (utils)               │
                         │   └ cache.ts (cache)               │
                         │                                     │
                         │ Entry (src/)                        │
                         │   ├ index.ts (main loop)           │
                         │   ├ api.ts (Hono server)          │
                         │   └ types.ts (types)              │
                         └─────────────────────────────────────┘
```

---

## 3. Core Module Responsibilities

### index.ts — Main Event Loop

System entry point, drives the entire trading flow.

Startup phase executes sequentially: Initialize API server → Initialize OrderManager → Load active markets → Initialize WebSocket streams (Binance, Polymarket, Chainlink, CLOB).

Main loop executes every second (controlled by `CONFIG.pollIntervalMs`): Check running state → Detect window boundary → Process pending start/stop transitions → Settle paper trades → Process all markets in parallel → Filter candidates (ENTER decision + valid price + proper timing) → Sort by edge DESC, rawSum ASC → Execute trades → Emit state snapshot → Sleep.

Enters safe mode after 3 consecutive all-market failures, skips execution until recovery.

### trading/trader.ts — Trade Execution

Handles trade execution for both paper and live modes.

**Paper Mode**: Validate price → Apply limit discount → Add to paper tracking → Write to database.

**Live Mode**: Validate client and wallet → Check daily loss limit → Select order type based on timing and confidence (LATE phase + HIGH confidence → FOK; EARLY/MID phase → GTD post-only) → Calculate dynamic expiry → Place order → Register heartbeat monitoring.

**Heartbeat Mechanism**: Checks every 5 seconds, only active when GTD orders exist. After 3 consecutive failures, stops live trading and initiates exponential backoff reconnection (max 5 attempts).

### trading/orderManager.ts — Order Polling Lifecycle

Polls active order status via CLOB API every 5 seconds.

State flow: placed → live → matched / filled / cancelled / expired. Triggers callbacks on state changes (drives heartbeat tracking). Auto-cleanup of historical orders older than 20 minutes.

### core/state.ts — Shared Runtime State

Manages global state via module-level singleton + EventEmitter.

Managed content: Running states (paper/live), pending start/stop transitions (cycle-aware), per-market snapshots, state version number.

Emitted events: `state:snapshot` (every loop), `signal:new`, `trade:executed`.

Cycle-aware pending transition mechanism ensures state changes don't occur mid-window processing, avoiding data inconsistencies.

### api.ts — Hono HTTP Server

Provides 15 REST endpoints + WebSocket interface.

Authentication via Bearer Token. Rate limiting at 600 tokens/60s. CORS enabled (origin configurable via `CORS_ORIGIN` env var). Exports `AppType` for frontend RPC type inference.

### core/config.ts — Configuration Management

Validates `config.json` via Zod. Supports `fs.watch` auto hot-reload. Atomic writes (temp file + rename). Supports legacy format migration. Contains `RiskConfig` (separate for paper/live) and `StrategyConfig`.

### core/db.ts — Database Layer

SQLite with WAL mode enabled. Contains 11 tables: `trades`, `signals`, `paper_trades`, `daily_stats`, `paper_state`, `live_state`, `live_trades`, `live_pending_orders`, `onchain_events`, `balance_snapshots`, `known_ctf_tokens`. Uses prepared statement caching. Includes 6 migration versions. For full schema details, see [Backend Documentation](./backend.md#3-core-layer).

### core/markets.ts — Market Definitions

Defines BTC, ETH, SOL, XRP markets. Each market contains: Binance trading pair symbol, Polymarket series ID/slug, Chainlink aggregator contract address, price precision.

---

## 4. Data Flow Pipeline (Per Second Execution)

### Phase 1: Data Collection (Parallel)

| Data Source | Content | Cache Strategy |
|-------------|---------|----------------|
| Binance REST | 240 × 1-minute klines | 60 second cache |
| Binance WS | Real-time tick data | Streaming |
| Polymarket REST | Market metadata | 30 second cache |
| Polymarket REST | Price and orderbook | 3 second cache |
| Polymarket WS | Chainlink price feed | Streaming |
| Chainlink RPC | On-chain price | Min 2 second interval |
| Chainlink WS | AnswerUpdated events | Streaming |
| CLOB WS | Best bid/ask, tick size, settlement status | Streaming |

### Phase 2: Technical Indicator Calculation

Heiken Ashi smoothed candles → RSI(14) → MACD(12,26,9) → VWAP and slope → Realized volatility (60 candles × √15 annualized)

### Phase 3: Probability Engine

1. TA Scoring: Aggregate 6 indicators into `rawUp` raw probability
2. Volatility-Implied Probability: Φ(z) normal distribution with fat-tail dampening
3. Time Decay: S-curve adjustment
4. Blend: 50% volatility + 50% TA
5. Adjustments: Binance lead effect ±2%, orderbook imbalance ±2%

### Phase 4: Market Regime Detection

`detectRegime()` outputs four states: `TREND_UP` / `TREND_DOWN` / `RANGE` / `CHOP`

### Phase 5: Edge Computation

`edge = modelProb - marketPrice`, deduct in sequence: orderbook slippage, spread penalty, fees, finally check vig thresholds.

### Phase 6: Confidence Scoring

5 dimensions weighted scoring:

| Dimension | Weight |
|-----------|--------|
| Indicator Alignment | 25% |
| Volatility Score | 15% |
| Orderbook Score | 15% |
| Timing Score | 25% |
| Regime Score | 20% |

### Phase 7: Trading Decision

Phase-based thresholds → Market multiplier → Regime multiplier → Overconfidence cap → Minimum confidence check → Output `ENTER` or `NO_TRADE`.

For detailed strategy parameters, see `docs/trading-strategy.md`.

### Phase 8: Execution

- **Paper Mode**: Record trade, settle at window end by settlement price
- **Live Mode**: Submit FOK or GTD order via CLOB API

---

## 5. 15-Minute Window Lifecycle

### Window Alignment

Windows strictly aligned to quarter-hour marks: 0:00, 0:15, 0:30, 0:45. Tracks previous window start time via `prevWindowStartMs` to detect boundaries.

### Phase Division

| Phase | Time Remaining | Characteristics |
|-------|----------------|-----------------|
| EARLY | > 10 minutes | High uncertainty, use GTD post-only orders |
| MID | 5–10 minutes | Medium certainty, use GTD post-only orders |
| LATE | < 5 minutes | High certainty, use FOK orders when confidence is high |

### Boundary Handling Flow

When new window detected, execute in sequence:

1. Process pending start/stop transitions
2. Settle previous window's paper trades
3. Redeem live positions
4. Reset per-market trackers

### Cycle-Aware Transitions

Pending mode switches (paper ↔ live) are deferred to window boundaries, preventing state changes mid-window processing that could cause data inconsistencies.

---

## 6. State Management Pattern

**Module-Level Singleton**: No dependency injection framework, uses module top-level variables as shared state. Suitable for single-process bot, simple with no overhead.

**EventEmitter (botEvents)**: Core mechanism for cross-module communication. Main events:

- `state:snapshot` — Emitted after each main loop, carries full state snapshot, WebSocket broadcast to frontend
- `signal:new` — Emitted when new signal generated
- `trade:executed` — Emitted when trade execution completes

**State Version Number**: Increments each snapshot, frontend uses it to detect out-of-order messages.

**Cycle-Aware Pending Transitions**: `pendingStart` / `pendingStop` flags only consumed at window boundaries, ensuring atomic state transitions.

---

## 7. Error Handling Strategy

**Market-Level Isolation**: Each market processed independently, single market failure doesn't block others.

**Safe Mode**: After 3+ consecutive all-market failures, enters safe mode, skips trade execution until at least one market processes successfully.

**Heartbeat Resilience**: Live GTD orders monitored via heartbeat. After consecutive failures, initiates exponential backoff reconnection, max 5 attempts.

**RPC Failover**: Chainlink configured with multiple RPC endpoints, auto-remembers last successful primary endpoint, rotates on failure.

**WebSocket Auto-Reconnect**: All WebSocket connections (Binance, Polymarket, Chainlink, CLOB) auto-reconnect on disconnect, backoff grows exponentially from 500ms to max 10 seconds.

**Graceful Degradation**: Uses cached data when data fetch fails, logs warning but doesn't interrupt main loop.

---

## 8. Design Decisions

### Why Bun

Bun provides fast startup time, native TypeScript support (no additional compilation step), and built-in SQLite driver, reducing external dependency count, suitable for single-process trading bot scenario.

### Why Hono

Hono is lightweight, no runtime dependencies, supports chained route definitions and exports `AppType`, frontend gets full end-to-end type inference via `hc<AppType>()`, eliminating API contract drift risk.

### Why Module-Level Singleton Over Dependency Injection

Orakel is a single-process application, doesn't need multiple instances or test isolation. Module-level singleton code is simpler, no framework overhead, follows YAGNI principle.

### Why Cycle-Aware Transitions

State switches within 15-minute windows (like switching from paper to live) could cause some trades in same window to be recorded in paper mode while others executed in live mode, creating statistical inconsistencies. Deferring transitions to window boundaries ensures mode uniformity within each window.

### Why Both REST and WebSocket

REST API used for initial page load (fetching historical data, config, trade records) and mutations (changing config, starting/stopping bot), semantically clear and easy to debug. WebSocket used for pushing real-time state snapshots (once per second), avoiding frontend frequent polling, reducing latency. Clear separation of concerns, no interference.

---

## 9. Architecture Diagrams

For detailed flowcharts showing:
- System data flow
- Trading decision logic
- Probability engine
- Order execution
- Market regime detection

See [FLOWCHARTS.md](./FLOWCHARTS.md)
