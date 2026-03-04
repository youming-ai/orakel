# Orakel

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/youming-ai/orakel)](https://github.com/youming-ai/orakel/stargazers)
[![Docker Pulls](https://img.shields.io/docker/pulls/orakel/bot)](https://hub.docker.com/r/orakel/bot)

A production-grade automated trading bot for Polymarket **15-minute Up/Down** cryptocurrency markets with paper trading, web dashboard, and Docker deployment.

## Supported Markets

| Market | Binance Pair | Chainlink Aggregator |
|--------|--------------|----------------------|
| BTC | BTCUSDT | 0xc907E116054Ad103354f2D350FD2514433D57F6f |
| ETH | ETHUSDT | 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612 |
| SOL | SOLUSDT | 0x5d4316B4fddEe94c1D9DA3a8a3c48bD6DA966047 |
| XRP | XRPUSDT | 0x8F62BF41D0B0Ec112D6953973B1Db26240129c37 |

## Features

- **Paper Trading** — Real-time data simulation without real money
- **Live Data** — Binance WS + Polymarket Chainlink + on-chain fallback
- **Technical Analysis** — Heiken Ashi, RSI, MACD, VWAP, Realized Volatility
- **Probability Model** — Volatility-implied probability fused with TA scoring
- **Market Regime** — TREND/RANGE/CHOP detection with dynamic thresholds
- **Web Dashboard** — React 19 + shadcn/ui + recharts
- **Docker Deployment** — One-command docker-compose setup

## Quick Start

### 1. Launch the Bot

```bash
git clone https://github.com/youming-ai/orakel.git
cd orakel
cp .env.example .env
docker compose up --build
```

### 2. Access the Web Dashboard

After bot startup, the web dashboard is available at port `:9998`:

```bash
# Local access
open http://localhost:9998

# Bot API is available at port 9999
curl http://localhost:9999/api/health

# Or remote access via Cloudflare Tunnel / frp / ngrok
# Example: https://your-subdomain.pages.dev
```

### 3. Configuration

Edit `.env` file:

| Variable | Description | Default |
|----------|-------------|---------|
| `PAPER_MODE` | Paper trading mode | `true` |
| `ACTIVE_MARKETS` | Enabled markets | `BTC,ETH,SOL,XRP` |
| `API_TOKEN` | API auth token (optional) | empty |
| `LOG_LEVEL` | Log level | `info` |

- Bot API: http://localhost:9999
- Web Dashboard: http://localhost:9998
- Frontend dev server: `cd web && bun run dev` (Vite default port 5173)

## Development

| Command | Description |
|---------|-------------|
| `bun run lint` | Biome check (lint + format) |
| `bun run typecheck` | TypeScript type checking |
| `bun run test` | Vitest unit tests |
| `bun run lint:fix` | Auto-fix issues |
| `cd web && bun run dev` | Frontend dev server |

Pre-push check: `bun run lint && bun run typecheck && bun run test`

## Configuration

- **Environment Variables** (`.env`): API port, market selection, RPC nodes → see [Deployment Guide](./docs/deployment.md#environment-variables)
- **Strategy Parameters** (`config.json`): Edge thresholds, probability weights, risk rules → see [Trading Strategy](./docs/trading-strategy.md)
- Default: Paper trading mode (`PAPER_MODE=true`), for live trading configure `PRIVATE_KEY` in `.env` (auto-connects wallet on startup)

## Security

- Paper trading enabled by default (`PAPER_MODE=true`)
- Live trading requires `PRIVATE_KEY` in `.env` (64-char hex, auto-connects on startup)
- Daily loss limit + max position limits

## Documentation

| Document | Description |
|----------|-------------|
| [System Architecture](./docs/architecture.md) | Overall architecture, module relationships, data flow, design decisions |
| [Backend Documentation](./docs/backend.md) | Backend modules, API endpoints, database schema, data layer |
| [Frontend Documentation](./docs/frontend.md) | React components, state management, WebSocket integration, styling |
| [Trading Strategy](./docs/trading-strategy.md) | Probability model, edge calculation, confidence scoring, decision logic |
| [Deployment Guide](./docs/deployment.md) | Docker, CI/CD, environment setup, VPS auto-deployment |
| [Testing Documentation](./docs/testing.md) | Test coverage, test file organization, running tests |


## Disclaimer

This project does not constitute financial advice. Trading involves significant risk. Participate at your own risk.
