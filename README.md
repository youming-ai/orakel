# Orakel

Automated trading bot for Polymarket **Crypto Up/Down** multi-timeframe markets. Paper trading, live trading, web dashboard, Docker deployment.

**Tech Stack**: Bun + TypeScript + Hono + PostgreSQL (backend), React 19 + Vite + shadcn/ui + Tailwind v4 (frontend)

## Supported Markets

| Market | Timeframe | Binance Pair | Resolution Source | Polymarket Series |
|--------|-----------|--------------|-------------------|-------------------|
| BTC-15m | 15 min | BTCUSDT | Chainlink BTC/USD | `btc-up-or-down-15m` |
| ETH-15m | 15 min | ETHUSDT | Chainlink ETH/USD | `eth-up-or-down-15m` |

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
# Edit .env with your configuration
docker compose up --build
```

- Dashboard: http://localhost:9998
- Bot API: http://localhost:9999

## Development

```bash
# Install dependencies
bun install                          # Backend deps
cd web && bun install && cd ..       # Frontend deps

# Run development servers
bun run dev                          # Bot + web dashboard (concurrent)
bun run start                        # Bot only (port 9999)
cd web && bun run dev                # Frontend only (port 5173)
```

### Development Commands

| Command | Description |
|---------|-------------|
| `bun run lint` | Biome check (lint + format) |
| `bun run lint:fix` | Auto-fix lint issues |
| `bun run typecheck` | TypeScript type checking |
| `bun run test` | Vitest unit tests |
| `bun run test:watch` | Vitest in watch mode |

Pre-push: `bun run lint && bun run typecheck && bun run test`

## Configuration

| File | Purpose | Hot Reload |
|------|---------|------------|
| `.env` | Secrets, ports, market selection | No (restart required) |
| `config.json` | Strategy thresholds, risk parameters | Yes (auto-detected) |

### Key Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPER_MODE` | `false` | Start in paper trading mode |
| `ACTIVE_MARKETS` | `""` | Enabled markets (empty = all supported markets) |
| `API_TOKEN` | `""` | Bearer token for API auth |
| `PRIVATE_KEY` | `""` | Wallet key for live trading (auto-connects) |
| `DATABASE_URL` | `""` | PostgreSQL connection string |

## Documentation

| 文档 | 描述 |
|------|------|
| [docs/README.md](./docs/README.md) | 技术架构、开发指南、核心流程 |
| [CLAUDE.md](./CLAUDE.md) | Claude Code 开发指南、架构细节 |
| [AGENTS.md](./AGENTS.md) | AI 代理上下文、代码规范 |

## Project Structure

```
├── src/                      # Backend source
│   ├── app/                  # 应用启动、API、WebSocket
│   ├── runtime/              # 交易运行时
│   ├── repositories/         # 数据访问层
│   ├── trading/              # 交易执行
│   ├── pipeline/             # 市场数据处理
│   ├── engines/              # 决策引擎
│   ├── indicators/           # 技术指标
│   ├── data/                 # 外部数据适配器
│   └── __tests__/            # 测试文件
├── web/                      # Frontend (React + Vite)
├── docs/                     # 技术文档
├── drizzle/                  # 数据库迁移
└── docker-compose.yml        # Docker 配置
```

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

## License

MIT

## Disclaimer

This project does not constitute financial advice. Trading involves significant risk. Participate at your own risk.
