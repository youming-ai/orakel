# Orakel

Automated trading bot for Polymarket **BTC Up/Down** multi-timeframe markets. Paper trading, live trading, web dashboard, Docker deployment.

**Tech Stack**: Bun + TypeScript + Hono + PostgreSQL (backend), React 19 + Vite + shadcn/ui + Tailwind v4 (frontend)

## Supported Markets

| Market | Timeframe | Binance Pair | Resolution Source | Polymarket Series |
|--------|-----------|--------------|-------------------|-------------------|
| BTC-5m | 5 min | BTCUSDT | Chainlink BTC/USD | `btc-up-or-down-5m` |
| BTC-15m | 15 min | BTCUSDT | Chainlink BTC/USD | `btc-up-or-down-15m` |
| BTC-1h | 1 hour | BTCUSDT | Binance BTC/USDT | `btc-up-or-down-hourly` |

## Features

- **Paper Trading** -- Simulate with real-time data, no real money
- **Live Trading** -- Polymarket CLOB orders (GTD + FOK), on-chain settlement
- **Technical Analysis** -- Heiken Ashi, RSI, MACD, VWAP, Realized Volatility
- **Probability Model** -- TA-scored probability with configurable edge thresholds
- **Market Regime** -- TREND / RANGE / CHOP detection (informational)
- **Web Dashboard** -- Real-time monitoring, P&L charts, trade history
- **Docker Deployment** -- One-command `docker compose up`

## Quick Start

```bash
git clone https://github.com/youming-ai/orakel.git
cd orakel
cp .env.example .env
docker compose up --build
```

- Dashboard: http://localhost:9998
- Bot API: http://localhost:9999

## Development

```bash
bun install                          # Backend deps
cd web && bun install && cd ..       # Frontend deps

bun run dev                          # Bot + web dashboard (concurrent)
bun run start                        # Bot only (port 9999)
cd web && bun run dev                # Frontend only (port 5173)
```

| Command | Description |
|---------|-------------|
| `bun run lint` | Biome check (lint + format) |
| `bun run typecheck` | TypeScript type checking |
| `bun run test` | Vitest unit tests |
| `bun run lint:fix` | Auto-fix lint issues |

Pre-push: `bun run lint && bun run typecheck && bun run test`

## Configuration

| File | Purpose | Hot Reload |
|------|---------|------------|
| `.env` | Secrets, ports, market selection | No (restart required) |
| `config.json` | Strategy thresholds, risk parameters | Yes (auto-detected) |

Key env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPER_MODE` | `false` | Start in paper trading mode |
| `ACTIVE_MARKETS` | `""` | Enabled markets (empty = all supported markets) |
| `API_TOKEN` | `""` | Bearer token for API auth |
| `PRIVATE_KEY` | `""` | Wallet key for live trading (auto-connects) |

## Documentation

| Document | Description |
|----------|-------------|
| [Core Logic](./docs/core-logic.md) | Architecture, data flow, trading strategy, decision logic, design decisions |
| [Backend Reference](./docs/backend.md) | Module map, API endpoints, DB schema, data adapters, blockchain |
| [Frontend](./docs/frontend.md) | React components, state management, WebSocket, styling |
| [Deployment](./docs/deployment.md) | Docker, CI/CD, environment setup, VPS auto-deployment |
| [Testing](./docs/testing.md) | Test coverage, organization, running tests |

## Disclaimer

This project does not constitute financial advice. Trading involves significant risk. Participate at your own risk.
