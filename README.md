# Orakel

Automated trading bot for Polymarket **BTC 5-minute Up/Down** markets. CLI-first architecture using Polymarket CLI for trade execution, Chainlink for price feeds, paper + live trading, web dashboard.

**Tech Stack**: Bun + TypeScript + Hono + PostgreSQL (backend), React 19 + Vite + shadcn/ui + Tailwind v4 (frontend)

## Market

| Market | Timeframe | Price Source | Resolution | Polymarket Slug |
|--------|-----------|-------------|------------|-----------------|
| BTC 5m | 5 min | Chainlink BTC/USD | `end >= start` = Up | `btc-updown-5m-{epoch}` |

288 markets per day, each resolving via Chainlink BTC/USD oracle. "Up" wins if BTC price at window end >= price at window start.

## Monorepo Structure

```
orakel/
├── packages/
│   ├── shared/             # @orakel/shared — TypeScript contracts + Zod schemas
│   ├── bot/                # @orakel/bot — Trading bot (Docker VPS)
│   │   ├── src/
│   │   │   ├── app/        # Hono API server, WebSocket, bootstrap
│   │   │   ├── core/       # Config, env, logger, state, clock
│   │   │   ├── engine/     # Signal model, edge computation, trade decision
│   │   │   ├── cli/        # Polymarket CLI subprocess executor
│   │   │   ├── data/       # Chainlink + Polymarket adapters
│   │   │   ├── trading/    # Paper trader, live trader, account, persistence
│   │   │   ├── runtime/    # Main loop, window manager, settlement, redeemer
│   │   │   ├── terminal/   # Terminal dashboard
│   │   │   ├── backtest/   # Backtest engine + replay
│   │   │   ├── db/         # Drizzle ORM schema + client
│   │   │   └── __tests__/  # Vitest tests (9 files, 61 tests)
│   │   └── Dockerfile
│   └── web/                # @orakel/web — Dashboard (Cloudflare Workers)
├── drizzle/                # Database migrations
├── config.json             # Strategy config (hot-reloadable)
├── docs/
│   ├── INTEGRATION_TEST.md # Live testing checklist
│   └── superpowers/        # Design spec + implementation plan
└── docker-compose.yml
```

## Quick Start

### Development

```bash
bun install                  # Install all workspace dependencies
cp .env.example .env         # Configure environment
# Edit .env: set DATABASE_URL, API_TOKEN

bun run dev                  # Bot + web dashboard concurrently
bun run dev:bot              # Bot only (port 9999, watch mode)
bun run dev:web              # Frontend only (port 5173)
```

### Production (Docker)

```bash
docker compose up --build    # Bot + PostgreSQL
```

### Frontend (Cloudflare Workers)

```bash
cd packages/web
wrangler login
wrangler secret put API_URL
bun run deploy
```

## Configuration

### Environment Variables (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `PAPER_MODE` | Yes | `true` = paper, `false` = live trading |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `API_TOKEN` | Yes | Bearer token for API auth |
| `POLYMARKET_PRIVATE_KEY` | Live only | Wallet key (0x prefix) |
| `PORT` | No | Default: 9999 |
| `LOG_LEVEL` | No | Default: info |

### Strategy Config (config.json)

Hot-reloadable, no restart needed. See `config.json` for full schema with strategy, risk, execution, infra, and maintenance sections.

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start all dev servers |
| `bun run start` | Start bot (port 9999) |
| `bun run typecheck` | TypeScript check (all packages) |
| `bun run lint` | Biome lint (all packages) |
| `bun run test` | Vitest tests (bot package) |
| `bun run check:ci` | Lint + typecheck + test |
| `bunx drizzle-kit generate` | Generate DB migration |
| `bunx drizzle-kit migrate` | Apply DB migrations |

## Architecture

```
Chainlink BTC/USD ──(HTTP poll 3s)──► Signal Engine ──► Trade Decision
                                          ▲                    │
Polymarket CLOB WS ──(best_bid_ask)──────┘          ┌─────────┴──────────┐
                                                     ▼                    ▼
                                              Paper Trader          Live Trader
                                              (in-memory)       (Polymarket CLI)
```

**Data sources**: Chainlink (BTC price via `eth_call`) + Polymarket (orderbook via CLOB WebSocket)
**Signal model**: Price deviation (Chainlink vs PriceToBeat) → sigmoid probability → edge vs market midpoint
**Execution**: Polymarket CLI (`polymarket` binary) as subprocess with JSON output

## Documentation

| Document | Description |
|----------|-------------|
| [AGENTS.md](./AGENTS.md) | AI agent context, code style |
| [docs/INTEGRATION_TEST.md](./docs/INTEGRATION_TEST.md) | Live testing checklist |
| [Design Spec](./docs/superpowers/specs/2026-03-12-btc-5min-bot-rewrite-design.md) | Architecture design |
| [Implementation Plan](./docs/superpowers/plans/2026-03-12-btc-5min-bot-rewrite.md) | 27-task plan |

## Disclaimer

This project does not constitute financial advice. Trading involves significant risk.
