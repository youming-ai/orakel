# Orakel Development Guide

This guide is for developers who want to contribute to Orakel or customize it for their own use.

## Quick Setup

```bash
# Clone the repository
git clone https://github.com/youming-ai/orakel.git
cd orakel

# Run the setup script (installs dependencies, creates .env, sets up git hooks)
bun run setup

# Start everything (bot + web dashboard)
bun run dev
```

The setup script will:
- ✓ Install bot dependencies
- ✓ Install web dependencies
- ✓ Create `.env` from `.env.example`
- ✓ Create `data/` directory
- ✓ Install git hooks (pre-commit, pre-push)
- ✓ Run type check to verify setup

## Development Workflow

### Running the Application

| Command | Description |
|---------|-------------|
| `bun run dev` | Start bot + web dashboard in parallel |
| `bun run dev:bot` | Start bot only |
| `bun run dev:web` | Start web dashboard only |
| `bun run dev:mock` | Start mock API server for UI development |

### Testing

| Command | Description |
|---------|-------------|
| `bun run test` | Run all tests once |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage report |

### Code Quality

| Command | Description |
|---------|-------------|
| `bun run lint` | Check code style with Biome |
| `bun run lint:fix` | Auto-fix lint issues |
| `bun run format` | Format all files with Biome |
| `bun run format:check` | Check if files are formatted |
| `bun run typecheck` | TypeScript type check (bot) |
| `bun run typecheck:web` | TypeScript type check (web) |

### Database Utilities

| Command | Description |
|---------|-------------|
| `bun run db:reset` | Delete all database data (⚠️ destructive) |
| `bun run db:seed` | Seed database with mock data |
| `bun run db:migrate` | Run database migrations |

### Docker Development

| Command | Description |
|---------|-------------|
| `bun run docker:dev` | Start development containers with hot-reload |
| `bun run docker:dev:down` | Stop development containers |
| `bun run docker:prod` | Start production containers |
| `bun run docker:prod:down` | Stop production containers |
| `bun run docker:logs` | View container logs |

### Other Utilities

| Command | Description |
|---------|-------------|
| `bun run clean` | Remove node_modules, build artifacts, and database |
| `bun run hooks:install` | Reinstall git hooks |
| `bun run precommit` | Run full pre-commit checks manually |
| `bun run prepush` | Run full pre-push checks manually |

## Project Structure

```
orakel/
├── src/                      # Bot source code
│   ├── index.ts              # Main entry point
│   ├── api.ts                # Hono API server
│   ├── db.ts                 # SQLite database setup
│   ├── trader.ts             # Trade execution logic
│   ├── config.ts             # Configuration loader
│   ├── state.ts              # Global state management
│   ├── types.ts              # TypeScript type definitions
│   ├── pipeline/             # Trading pipeline
│   │   ├── fetch.ts          # Data fetching layer
│   │   ├── compute.ts        # Computation layer
│   │   └── processMarket.ts  # Market orchestration
│   ├── engines/              # Trading engines
│   │   ├── edge.ts           # Edge computation & decisions
│   │   ├── probability.ts    # Probability models
│   │   ├── regime.ts         # Market regime detection
│   │   ├── ensemble.ts       # Ensemble model
│   │   ├── signalQuality.ts  # Signal quality prediction
│   │   ├── adaptiveThresholds.ts # Adaptive thresholds
│   │   ├── positionSizing.ts # Kelly position sizing
│   │   ├── riskManagement.ts # Risk management
│   │   ├── feeOptimization.ts # Fee optimization
│   │   └── arbitrage.ts      # Arbitrage detection
│   ├── indicators/           # Technical indicators
│   │   ├── rsi.ts            # RSI
│   │   ├── macd.ts           # MACD
│   │   ├── vwap.ts           # VWAP
│   │   ├── heikenAshi.ts     # Heiken Ashi
│   │   ├── incremental.ts    # Incremental RSI
│   │   └── volatilityBuffer.ts # Rolling volatility
│   └── data/                 # Data sources
│       ├── binance.ts        # Binance REST API
│       ├── binanceWs.ts      # Binance WebSocket
│       ├── polymarket.ts     # Polymarket APIs
│       └── chainlink.ts      # Chainlink price feed
├── web/                      # Web dashboard
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── lib/              # Utilities and stores
│   │   └── main.tsx          # Entry point
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── scripts/                  # Utility scripts
│   ├── setup.sh              # First-time setup
│   ├── install-git-hooks.sh  # Git hooks installation
│   ├── db-reset.sh           # Database reset
│   ├── db-seed.ts            # Database seeding
│   ├── mock-server.ts        # Mock API server
│   └── vps-deploy.sh         # VPS deployment
├── data/                     # Runtime data (gitignored)
│   └── orakel.db             # SQLite database
├── .env                      # Environment variables (gitignored)
├── .env.example              # Environment variables template
├── config.json               # Strategy configuration
├── docker-compose.yml        # Production Docker config
├── docker-compose.dev.yml    # Development Docker config
├── package.json
├── bun.lock
├── tsconfig.json
├── biome.json                # Biome configuration
├── orakel.code-workspace     # VS Code workspace
└── .vscode/                  # VS Code settings
    ├── settings.json
    └── extensions.json
```

## Development Tools

### VS Code Setup

1. **Open the workspace** for optimal experience:
   ```bash
   code orakel.code-workspace
   ```

2. **Recommended extensions** (auto-prompted):
   - Biome (linting/formatting)
   - Tailwind CSS IntelliSense
   - Vitest (test explorer)
   - GitLens (Git supercharged)
   - Docker

3. **Keyboard shortcuts** (workspace tasks):
   - `Ctrl+Shift+B` - Run build task
   - `F5` - Debug bot
   - `Ctrl+Shift+T` - Run tests

### Git Hooks

Pre-commit hook (runs on `git commit`):
- Biome lint check
- TypeScript type check

Pre-push hook (runs on `git push`):
- Full test suite
- TypeScript type check

To skip hooks (not recommended):
```bash
git commit --no-verify
git push --no-verify
```

### Hot Reload

- **Bot**: Not supported (requires restart for code changes)
- **Web**: Supported via Vite HMR (edits appear instantly)

## UI Development Without Bot

For frontend-only development, use the mock server:

```bash
# Terminal 1: Start mock API server
bun run dev:mock

# Terminal 2: Start web dashboard
cd web && bun run dev
```

The mock server provides:
- Realistic market data (updates on each request)
- Mock trades and signals from database
- Full API compatibility (`/api/state`, `/api/trades`, etc.)

Note: WebSocket is not supported in mock mode. The dashboard will poll REST endpoints instead.

## Debugging

### Debug Bot

```bash
# With Bun debugger
bun --inspect src/index.ts

# Or use VS Code debugger (F5 in workspace)
```

### Debug Tests

```bash
# With Bun debugger
bun --inspect-brk vitest run

# Or use VS Code test explorer
```

### Debug Web

1. Open DevTools in browser (F12)
2. React DevTools extension recommended
3. Network tab shows API/WebSocket traffic

## Code Style

The project uses [Biome](https://biomejs.dev/) for consistent formatting:

- **Indent**: Tabs (width 2)
- **Line width**: 120 characters
- **Quotes**: Double quotes
- **Semicolons**: Always
- **Trailing commas**: All (including function params)
- **Imports**: Grouped (node: → external → internal with .ts extensions)

Format on save is enabled in VS Code workspace settings.

## Testing

### Writing Tests

Tests are co-located with source files:
```
src/
├── indicators/
│   ├── rsi.ts
│   └── rsi.test.ts          # Test file
└── engines/
    ├── edge.ts
    └── edge.test.ts         # Test file
```

### Test Utilities

```typescript
// Example test
import { describe, it, expect } from "vitest";
import { computeEdge } from "./edge.ts";

describe("computeEdge", () => {
	it("should calculate edge correctly", () => {
		const result = computeEdge({
			modelProb: 0.60,
			marketPrice: 0.50,
			// ... other params
		});
		expect(result.edge).toBeCloseTo(0.10, 2);
	});
});
```

### Running Specific Tests

```bash
# Run all tests in a file
bunx vitest run src/engines/edge.test.ts

# Run tests matching pattern
bunx vitest run -t "computeEdge"

# Run tests in watch mode
bunx vitest
```

## Database

### Schema

See [`src/db.ts`](src/db.ts) for the latest schema:
- `trades` - All executed trades
- `signals` - Generated signals for backtest
- `daily_stats` - Daily P&L per mode
- `paper_state` - Paper trading state

### Inspecting Database

Using SQLite CLI:
```bash
sqlite3 data/orakel.db
.tables
.schema trades
SELECT * FROM trades ORDER BY created_at DESC LIMIT 10;
```

Using Docker (uncomment `db-viewer` in `docker-compose.dev.yml`):
```bash
docker compose -f docker-compose.dev.yml up db-viewer
# Open http://localhost:8080
```

### Resetting Database

```bash
# Quick reset (deletes all data)
bun run db:reset

# Seed with mock data
bun run db:seed
```

## Common Issues

### Port Already in Use

```bash
# Check what's using the port
lsof -i :9999  # Bot
lsof -i :9998  # Web

# Kill the process
kill -9 <PID>
```

### Database Locked

```bash
# Stop the bot first
# Then reset database
bun run db:reset
```

### Environment Variable Not Found

```bash
# Ensure .env exists
cp .env.example .env

# Check required variables
grep -v "^#" .env.example | grep -v "^$"
```

### Hot Reload Not Working

- For bot: Restart manually (hot reload not supported)
- For web: Ensure Vite dev server is running (not production build)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes and commit: `git commit -m "feat: add my feature"`
4. Push and create PR: `git push origin feature/my-feature`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `test:` - Tests
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

Example:
```
feat(engines): add trailing stop loss support

Implement dynamic trailing stop for high-confidence trades.
The stop adjusts every 30 seconds based on volatility.
```

## Performance Tips

### Bot Performance

- Use incremental indicators (`IncrementalRSI`) instead of recomputing
- Enable caching for external API calls
- Profile with `--inspect` to find bottlenecks

### Web Performance

- Avoid re-renders with `useMemo` and `useCallback`
- Debounce rapid state updates
- Use React DevTools Profiler to identify slow components

## Further Reading

- [`README.md`](README.md) - Project overview
- [`CLAUDE.md`](CLAUDE.md) - Architectural guide
- [`CONTRIBUTING.md`](CONTRIBUTING.md) - Contribution guidelines
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - Development roadmap
- [`docs/TASKS.md`](docs/TASKS.md) - Detailed task breakdown

## Getting Help

- GitHub Issues: https://github.com/youming-ai/orakel/issues
- Documentation: Check `docs/` folder
- CLAUDE.md: Comprehensive architectural guide
