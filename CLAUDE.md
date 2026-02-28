# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

```bash
# Setup
bun install                          # Install backend dependencies
cd web && bun install                # Install frontend dependencies

# Running
bun run start                        # Start bot (src/index.ts, port 9999)
cd web && bun run dev                # Start frontend dev server (port 9998)

# Code quality
bun run typecheck                    # Typecheck all src/ (includes tests)
bun run lint                         # Biome check (lint + format) src/
bun run lint:fix                     # Biome check --write (auto-fix)
bun run format                       # Biome format --write src/

# Testing
bun run test                         # Run all tests (vitest)
bunx vitest run src/path.test.ts     # Run a single test file
bun run test:watch                   # Vitest in watch mode
```

**Pre-push checklist**: `bun run lint && bun run typecheck && bun run test`

## Architecture Overview

Orakel is a production-grade automated trading bot for Polymarket 15-minute crypto up/down markets. It uses real-time market data from Binance, Polymarket, and Chainlink to make trading decisions.

### Core Loop (src/index.ts)

The main loop runs every second:
1. **Fetch** parallel market data from Binance REST, Binance WebSocket, Polymarket WebSocket, and Chainlink RPC
2. **Compute** technical indicators (RSI, MACD, VWAP, Heiken Ashi, volatility)
3. **Decide** using the trading pipeline (edge calculation, probability blending, regime detection)
4. **Execute** trades if conditions are met (paper or live mode)
5. **Emit** WebSocket events for the frontend dashboard

### Key Directories

- **src/pipeline/** — Market processing pipeline: `fetch.ts` → `compute.ts` → `processMarket.ts`
- **src/engines/** — Pure trading logic: edge computation, probability blending, regime detection, signal quality (k-NN), ensemble models
- **src/indicators/** — Technical analysis: RSI, MACD, VWAP, Heiken Ashi (all pure functions)
- **src/data/** — External data adapters: Binance REST/WebSocket, Polymarket REST/WebSocket, Chainlink RPC/WebSocket, Polygon balance/events
- **web/src/** — React 19 + Vite frontend with shadcn/ui components

### State Management

- **Module singletons** for shared state (src/state.ts)
- **Zod** for runtime validation of config (config.json) and environment variables (.env)
- **SQLite** for persistence (src/db.ts) with prepared statements
- **EventEmitter** (botEvents) for WebSocket state broadcasting

### Configuration

- **config.json** — Strategy and risk parameters (Zod-validated, auto-reloads on change)
- **.env** — Secrets and environment-specific values (Zod-validated)
- Per-account risk configs: `paper.risk` vs `live.risk` in config.json

### Trading Modes

- **Paper mode** (default) — Simulated trading without real money
- **Live mode** — Real trading via Polymarket CLOB API, requires wallet connection through Web UI

## Code Style (Enforced by Biome)

- **Indent**: tabs (width 2) · **Line width**: 120
- **Imports**: `node:` protocol for builtins, relative imports with `.ts` extension
- **Types**: All shared types in [src/types.ts](src/types.ts)
- **Named exports only** — no default exports
- **Logging**: Use `createLogger("module-name")` factory, never raw `console.log`

## Key Types and Patterns

- **Result objects**: `{ ok: true, data }` | `{ ok: false, error: string }`
- **Market state**: `MarketState` interface tracks per-market state across iterations (priceToBeat latching)
- **Trade signals**: Persisted to SQLite via [src/persistence.ts](src/persistence.ts)
- **Order lifecycle**: Live trades tracked by [src/orderManager.ts](src/orderManager.ts) with status polling

## Important Notes

- Market-specific edge multipliers are hardcoded in [src/engines/edge.ts](src/engines/edge.ts) based on backtest performance (BTC: 1.5x, ETH: 1.2x, SOL/XRP: 1.0x)
- Safe mode triggers after 3 consecutive all-market failures (configurable via `strategy.safeModeThreshold`)
- 15-minute window boundary handling in [src/windowBoundary.ts](src/windowBoundary.ts) handles settlement and tracker reset
- Live trading requires API_TOKEN to be set for endpoint authentication

## See Also

- [AGENTS.md](AGENTS.md) — Detailed development conventions, project structure, and testing patterns
- [README.md](README.md) — Project overview, features, and deployment guide
