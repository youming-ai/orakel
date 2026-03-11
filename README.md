# Orakel

Automated trading bot for Polymarket **Crypto Up/Down** multi-timeframe markets. Paper trading, live trading, web dashboard.

**Tech Stack**: Bun + TypeScript + Hono + PostgreSQL (backend), React 19 + Vite + shadcn/ui + Tailwind v4 (frontend)

## Supported Markets

| Market | Timeframe | Binance Pair | Resolution Source | Polymarket Series |
|--------|-----------|--------------|-------------------|-------------------|
| BTC-15m | 15 min | BTCUSDT | Chainlink BTC/USD | `btc-up-or-down-15m` |
| ETH-15m | 15 min | ETHUSDT | Chainlink ETH/USD | `eth-up-or-down-15m` |

## Monorepo Structure

This is a Bun workspace monorepo with separate deployment targets:

- **Frontend** (`packages/web/`) → Cloudflare Workers
- **Backend** (`packages/bot/`) → VPS via Docker
- **Shared** (`packages/shared/`) → Type definitions used by both

```
orakel/
├── bun.workspaces              # Workspace configuration
├── package.json                # Root workspace manifest
├── packages/
│   ├── shared/                 # Shared types and contracts
│   ├── bot/                    # Backend trading bot (Docker VPS)
│   └── web/                    # Frontend dashboard (Cloudflare Workers)
├── docker-compose.yml          # Local development stack
└── drizzle/                    # Database migrations
```

## Quick Start

### Development (Local)

```bash
# Install dependencies for all packages
bun install

# Start all services (bot + frontend dev server)
bun run dev

# Or start individually
bun run dev:bot      # Backend only (port 9999)
bun run dev:web      # Frontend only (port 5173)
```

### Production

```bash
# Deploy frontend to Cloudflare Workers
cd packages/web
bun run deploy

# Build and run the bot on VPS
docker build -f packages/bot/Dockerfile -t orakel-bot .
docker run -d -p 9999:9999 --env-file .env orakel-bot
```

## Development Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install all workspace dependencies |
| `bun run dev` | Start all development servers |
| `bun run build` | Build all packages |
| `bun run typecheck` | TypeScript type checking |
| `bun run test` | Run tests |
| `bun run lint` | Biome linting |
| `bun run lint:fix` | Auto-fix lint issues |

## Frontend Deployment (Cloudflare Workers)

```bash
cd packages/web

# Login (first time)
wrangler login

# Set API endpoint secret
wrangler secret put API_URL

# Deploy
bun run deploy
```

## Backend Deployment (Docker VPS)

```bash
# Build image
docker build -f packages/bot/Dockerfile -t orakel-bot .

# Run container
docker run -d \
  -p 9999:9999 \
  -v $(pwd)/config.json:/app/config.json:ro \
  --env-file .env \
  orakel-bot
```

## Configuration

| File | Purpose | Hot Reload |
|------|---------|------------|
| `.env` | Secrets, ports, market selection | No (restart required) |
| `config.json` | Strategy thresholds, risk parameters | Yes (auto-detected) |

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPER_MODE` | `false` | Start in paper trading mode |
| `ACTIVE_MARKETS` | `""` | Enabled markets (empty = all supported) |
| `API_TOKEN` | `""` | Bearer token for API auth |
| `PRIVATE_KEY` | `""` | Wallet key for live trading |
| `DATABASE_URL` | `""` | PostgreSQL connection string |
| `API_URL` | `""` | Bot API URL for frontend |

## Database

PostgreSQL with Drizzle ORM:

```bash
# Generate migration after schema changes
bunx drizzle-kit generate

# Apply migrations
bunx drizzle-kit migrate

# Direct schema push (development only)
bunx drizzle-kit push
```

## Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](./docs/README.md) | Technical architecture |
| [CLAUDE.md](./CLAUDE.md) | Claude Code development guide |
| [AGENTS.md](./AGENTS.md) | AI agent context, code style |

## License

MIT

## Disclaimer

This project does not constitute financial advice. Trading involves significant risk. Participate at your own risk.
