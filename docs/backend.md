# Backend Architecture

> For system architecture, data flow pipeline, trading engines, and decision logic, see [Core Logic](./core-logic.md).

## 1. Backend Overview

Orakel backend is a single-process trading bot built with Bun Runtime, TypeScript, Hono, and SQLite. The backend hosts both the trading logic and the API server in one process, supporting both Paper Trading and Live Trading modes.

**Tech Stack**

- Runtime: Bun
- Language: TypeScript (strict mode)
- Web Server: Hono (lightweight HTTP + WebSocket)
- Database: SQLite (WAL mode)
- Module System: ESM-only (no CommonJS)
- Architecture: Monorepo structure (`src/` backend + `web/` frontend)
- Dependency Injection: None (module-level singletons)

**Key Design Principles**

- Single-process architecture with no DI framework
- ESM-only modules with verbatimModuleSyntax for import hygiene
- Zod validation for all runtime configuration and environment variables
- Module-level singletons for shared state (suitable for single-process bot)
- Cycle-aware state transitions deferred to 15-minute window boundaries

---

## 2. Module Map

```
src/
├── index.ts                    # Main loop entry point
├── api.ts                      # Hono HTTP server + WebSocket (~800 lines)
├── types.ts                    # All shared TypeScript interfaces/types
├── core/                       # Core infrastructure
│   ├── config.ts               # Zod-validated config loader, hot-reload, atomic write
│   ├── env.ts                  # Zod-validated environment variables
│   ├── db.ts                   # SQLite setup, migrations, prepared statements
│   ├── state.ts                # Shared runtime state, EventEmitter (botEvents)
│   ├── markets.ts              # Market definitions (BTC, ETH, SOL, XRP)
│   ├── logger.ts               # Logger factory (createLogger)
│   ├── utils.ts                # Pure utility functions (clamp, normalCDF, getCandleWindowTiming)
│   └── cache.ts                # TTL cache factory
├── data/                       # External data source adapters
│   ├── binance.ts              # Binance REST (fetchKlines, fetchLastPrice)
│   ├── binanceWs.ts            # Binance WebSocket (real-time price ticks)
│   ├── polymarket.ts           # Polymarket Gamma REST (market metadata, CLOB prices, orderbook)
│   ├── polymarketLiveWs.ts     # Polymarket live price WebSocket
│   ├── polymarketClobWs.ts     # Polymarket CLOB WebSocket (bestBid/bestAsk, tick size, settlement)
│   ├── chainlink.ts            # Chainlink on-chain price via JSON-RPC
│   ├── chainlinkWs.ts          # Chainlink price streaming via WebSocket
│   ├── polygonBalance.ts       # Polygon balance polling (USDC, CTF tokens)
│   └── polygonEvents.ts        # Polygon on-chain events (transfers, batch transfers)
├── engines/                    # Core trading logic
│   ├── probability.ts          # TA scoring, vol-implied prob, time decay, blending
│   ├── edge.ts                 # Edge computation, confidence scoring, trade decision
│   ├── regime.ts               # Market regime detection (TREND/RANGE/CHOP)
│   └── arbitrage.ts            # Arbitrage opportunity detection
├── indicators/                 # Technical analysis (pure functions)
│   ├── rsi.ts                  # RSI(14), SMA, slope
│   ├── macd.ts                 # MACD(12,26,9)
│   ├── vwap.ts                 # Session VWAP, VWAP series, slope
│   └── heikenAshi.ts           # Heiken Ashi candles, consecutive count
├── pipeline/                   # Per-market processing orchestration
│   ├── fetch.ts                # Data fetch orchestration (Binance + Polymarket + Chainlink)
│   ├── compute.ts              # Indicator calculation + engine orchestration → TradeDecision
│   └── processMarket.ts        # Per-market entry point: fetch → compute → signal
├── trading/                    # Trade execution and tracking
│   ├── trader.ts               # Trade execution (paper + live), wallet mgmt, heartbeat
│   ├── orderManager.ts         # Live order polling lifecycle (placed → filled/cancelled)
│   ├── accountStats.ts         # Paper/live account tracking, PnL, daily stats
│   ├── liveGuards.ts           # Live trading safety checks
│   ├── liveSettler.ts          # Live trade settlement
│   ├── persistence.ts          # Trade/signal persistence to DB
│   ├── strategyRefinement.ts   # Strategy parameter adjustments
│   └── terminal.ts             # Terminal output formatting
└── blockchain/                 # On-chain integration
    ├── contracts.ts            # Contract addresses and constants
    ├── accountState.ts         # On-chain account state (USDC balance, CTF positions)
    ├── reconciler.ts           # Trade reconciliation with on-chain data
    ├── reconciler-utils.ts     # Reconciler utility functions
    └── redeemer.ts             # Position redemption (auto-redeem settled markets)
```

---

## 3. Core Layer (src/core/)

### config.ts

Zod-validated configuration loader with hot-reload capability.

**Key Features**

- Atomic writes using temp file + rename pattern
- Hot-reload via `fs.watch` on config.json changes
- Supports legacy format migration
- Separates `RiskConfig` (paper vs live) from `StrategyConfig`

**Configuration Structure**

| Config Type | Purpose | Hot-Reload |
|-------------|---------|------------|
| RiskConfig | Position sizing, daily limits, risk parameters | Yes |
| StrategyConfig | Edge thresholds, probability weights, decision parameters | Yes |

**Key Exports**

- `loadConfig()`: Load and validate config.json
- `CONFIG`: Global config singleton
- `RiskConfig`, `StrategyConfig`: TypeScript interfaces

### env.ts

Zod-validated environment variables loaded from `.env` file.

**Environment Variables**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PAPER_MODE` | boolean | `true` | Paper trading mode |
| `ACTIVE_MARKETS` | string | `BTC,ETH,SOL,XRP` | Enabled markets (comma-separated) |
| `API_PORT` | number | `9999` | API server port |
| `API_TOKEN` | string | `""` | Optional Bearer token for auth |
| `LOG_LEVEL` | string | `"info"` | Logging level (debug, info, warn, error) |
| `CORS_ORIGIN` | string | `"*"` | CORS allowed origin |
| `PRIVATE_KEY` | string | `""` | Wallet private key (64-char hex) |

**Key Exports**

- `ENV`: Global env singleton
- `EnvSchema`: Zod schema for validation

### db.ts

SQLite database setup with WAL mode, migration system, and prepared statement caching.

**Database Configuration**

- Mode: WAL (Write-Ahead Logging) for better concurrency
- Location: `data/orakel.db`
- Prepared statements: Cached at module level

**Tables**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `trades` | Historical trade records | id, market, side, price, size, pnl, timestamp |
| `signals` | Trading signals | id, market, direction, probability, edge, confidence, timestamp |
| `paper_trades` | Paper trade tracking | id, market, side, entryPrice, exitPrice, pnl, settled |
| `daily_stats` | Daily performance stats | date, totalTrades, winRate, totalPnl, maxDrawdown |
| `paper_state` | Paper mode state balance | balance, lastUpdated |
| `live_state` | Live mode state balance | balance, lastUpdated |
| `live_trades` | Live trade records | id, market, side, price, size, orderId, status |
| `live_pending_orders` | Pending live orders | orderId, market, side, price, placedAt |
| `onchain_events` | On-chain event logs | eventType, txHash, timestamp, data |
| `balance_snapshots` | Historical balance snapshots | mode, balance, timestamp |
| `known_ctf_tokens` | Known CTF token addresses | address, market, firstSeen |

**Migrations**

| Version | Description |
|---------|-------------|
| v1-v6 | Incremental schema additions (trades, signals, paper_trades, etc.) |

**Key Exports**

- `statements`: Prepared statements object (accessed via statements.tableName.insert, etc.)
- `runMigrations()`: Apply pending migrations
- `getDatabase()`: Get SQLite connection

### state.ts

Shared runtime state managed via module-level singleton + EventEmitter.

**Managed State**

- `paperRunning`: Boolean, paper trading active state
- `liveRunning`: Boolean, live trading active state
- `pendingStart`: String, pending mode start (deferred to window boundary)
- `pendingStop`: String, pending mode stop (deferred to window boundary)
- `marketSnapshots`: Map, per-market state snapshots
- `stateVersion`: Number, increments on each snapshot

**EventEmitter (botEvents)**

| Event | Payload | Purpose |
|-------|---------|---------|
| `state:snapshot` | Full state object | Broadcast to frontend WebSocket |
| `signal:new` | Signal object | New trading signal generated |
| `trade:executed` | Trade object | Trade executed (paper or live) |

**Cycle-Aware Transitions**

Pending mode switches (`pendingStart`, `pendingStop`) are only consumed at 15-minute window boundaries. This ensures state changes don't occur mid-window processing, avoiding data inconsistencies where some trades would be in one mode and others in another within the same window.

**Key Exports**

- `botEvents`: EventEmitter instance
- `paperRunning`, `liveRunning`: Boolean flags
- `getFullState()`: Returns complete state snapshot

### markets.ts

Market definitions for supported cryptocurrencies (BTC, ETH, SOL, XRP).

**MARKETS Constant**

Each market object contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Market identifier (e.g., "BTC") |
| `binanceSymbol` | string | Binance trading pair (e.g., "BTCUSDT") |
| `polymarketSeriesId` | string | Polymarket series ID |
| `polymarketSlug` | string | Polymarket slug |
| `chainlinkAggregator` | string | Chainlink aggregator contract address |
| `chainlinkDecimals` | number | Chainlink price decimals |
| `precision` | number | Price precision |

**Key Exports**

- `MARKETS`: Array of market configurations
- `MARKET_IDS`: Array of market IDs for quick lookup

### logger.ts

Logger factory creating named loggers with level filtering.

**Log Levels**

- `debug`: Detailed diagnostic information
- `info`: General informational messages (default)
- `warn`: Warning messages
- `error`: Error messages

**Usage Pattern**

```typescript
import { createLogger } from "./core/logger.ts";
const log = createLogger("module-name");
log.info("message", data);
```

**Key Exports**

- `createLogger(name)`: Returns logger instance

### utils.ts

Pure utility functions used across the codebase.

**Key Functions**

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `clamp(value, min, max)` | value, min, max | number | Clamps value between min and max |
| `normalCDF(x)` | x (number) | number | Standard normal cumulative distribution |
| `getCandleWindowTiming(nowMs)` | nowMs (number) | object | Returns window timing data (phase, timeLeft, etc.) |
| `smoothstep(edge0, edge1, x)` | edge0, edge1, x | number | Smooth interpolation function |
| `roundToPrecision(value, decimals)` | value, decimals | number | Round to specified precision |

### cache.ts

TTL (Time-To-Live) cache factory with hit rate tracking.

**Features**

- Generic type support
- Automatic expiration based on TTL
- Hit/miss rate tracking for monitoring
- Optional cleanup of expired entries

**Key Exports**

- `createTtlCache<T>(ttlMs, maxSize)`: Returns cache object with get/set methods

---

## 4. Data Layer (src/data/)

### binance.ts

Binance REST API adapter for fetching historical price data.

**Endpoints**

| Method | Endpoint | Cache | Purpose |
|--------|----------|-------|---------|
| `fetchKlines(symbol, interval, limit)` | `/api/v3/klines` | 60s | Fetch candlestick data |
| `fetchLastPrice(symbol)` | `/api/v3/ticker/price` | 5s | Fetch current price |

**Caching Strategy**

- Klines: 60 second cache to avoid API rate limits
- Last price: 5 second cache for near real-time updates

**Key Exports**

- `fetchKlines()`, `fetchLastPrice()`

### binanceWs.ts

Binance WebSocket adapter for real-time price streaming.

**Channels**

| Channel | Purpose |
|---------|---------|
| `<symbol>@trade` | Real-time trade ticks |
| `<symbol>@kline_1m` | 1-minute candle updates |

**Auto-Reconnect**

- Exponential backoff from 500ms to max 10 seconds
- Reconnects automatically on disconnect

**Key Exports**

- `connectBinanceWs()`: Returns WebSocket connection

### polymarket.ts

Polymarket Gamma REST API adapter for market metadata and pricing.

**Endpoints**

| Method | Endpoint | Cache | Purpose |
|--------|----------|-------|---------|
| `fetchMarket(slug)` | `/markets` | 30s | Fetch market metadata |
| `fetchPrice(marketId)` | `/markets/{id}` | 3s | Fetch current price |
| `fetchOrderbook(marketId)` | `/markets/{id}/orderbook` | 3s | Fetch orderbook data |

**Key Exports**

- `fetchMarket()`, `fetchPrice()`, `fetchOrderbook()`

### polymarketLiveWs.ts

Polymarket live price WebSocket adapter for streaming price updates.

**Channels**

- `live_price`: Real-time price updates for active markets

**Key Exports**

- `connectPolymarketLiveWs()`: Returns WebSocket connection

### polymarketClobWs.ts

Polymarket CLOB (Central Limit Order Book) WebSocket adapter for orderbook and settlement data.

**Channels**

| Channel | Data |
|---------|------|
| `price_level` | Best bid/ask prices |
| `tick_size` | Minimum price tick size |
| `settlement` | Market settlement events |

**Key Exports**

- `connectPolymarketClobWs()`: Returns WebSocket connection

### chainlink.ts

Chainlink on-chain price fetcher via JSON-RPC.

**Method**

| Method | Parameters | Description |
|--------|-----------|-------------|
| `eth_call` | contract data | Fetch latest round data from aggregator |

**RPC Failover**

- Configured with multiple RPC endpoints
- Auto-remembers last successful primary endpoint
- Rotates on failure

**Key Exports**

- `fetchChainlinkPrice(aggregatorAddress)`: Fetch latest price

### chainlinkWs.ts

Chainlink price streaming via WebSocket.

**Events**

| Event | Purpose |
|-------|---------|
| `AnswerUpdated` | New price update from aggregator |

**Key Exports**

- `connectChainlinkWs()`: Returns WebSocket connection

### polygonBalance.ts

Polygon balance polling adapter for USDC and CTF token balances.

**Method**

- `eth_getBalance`: Query USDC balance
- ERC-20 `balanceOf`: Query CTF token balances

**Key Exports**

- `fetchUsdcBalance(address)`
- `fetchCtfBalance(tokenAddress, walletAddress)`

### polygonEvents.ts

Polygon on-chain events adapter for transfer tracking.

**Events**

| Event | Description |
|-------|-------------|
| `Transfer` | Single token transfer |
| `BatchTransfer` | Batch token transfers |

**Key Exports**

- `fetchTransfers(address)`: Fetch recent transfer events

---

## 5. Trading Layer (src/trading/)

### trader.ts

Handles trade execution for both paper and live modes.

**Paper Mode Flow**

1. Validate price data
2. Apply limit discount
3. Clamp price to [0.02, 0.98]
4. Record to paper tracking
5. Write to database

**Live Mode Flow**

1. Validate client and wallet
2. Check daily loss limit
3. Select order type based on timing and confidence:
   - LATE phase + HIGH confidence → FOK
   - EARLY/MID phase → GTD post-only
4. Calculate dynamic expiry (min 10s, max 50% of remaining window)
5. Place order via CLOB API
6. Register heartbeat monitoring

**Heartbeat Mechanism**

- Checks every 5 seconds
- Only active when GTD orders exist
- After 3 consecutive failures, stops live trading
- Initiates exponential backoff reconnection (max 5 attempts)

**Key Exports**

- `executePaperTrade(market, side, price, size)`
- `executeLiveTrade(market, side, price, size)`

### orderManager.ts

Manages live order polling lifecycle.

**State Flow**

```
placed → live → matched / filled / cancelled / expired
```

**Polling Strategy**

- Polls active order status every 5 seconds via CLOB API
- Triggers callbacks on state changes
- Auto-cleanup of historical orders older than 20 minutes
- Drives heartbeat tracking in trader.ts

**Key Exports**

- `pollOrders()`: Main polling function
- `registerOrder(order)`: Register order for polling

### accountStats.ts

Tracks paper and live account performance including PnL, daily stats, and win rates.

**Tracked Metrics**

- Balance (paper and live)
- Total trades
- Win rate
- Total PnL
- Daily PnL
- Max drawdown
- Positions held

**Key Exports**

- `updatePaperStats(trade)`: Update paper trading stats
- `updateLiveStats(trade)`: Update live trading stats
- `getDailyStats(date)`: Get stats for specific date

### persistence.ts

Handles trade and signal persistence to SQLite database.

**Persistence Operations**

| Operation | Table | Purpose |
|-----------|-------|---------|
| Insert trade | `trades` / `live_trades` | Record executed trade |
| Insert signal | `signals` | Record trading signal |
| Update order status | `live_pending_orders` | Update order lifecycle |
| Insert balance snapshot | `balance_snapshots` | Record balance history |

**Key Exports**

- `persistTrade(trade)`: Persist trade to database
- `persistSignal(signal)`: Persist signal to database

### liveGuards.ts

Implements live trading safety checks and risk controls.

**Safety Checks**

| Check | Condition | Action |
|-------|-----------|--------|
| Daily loss limit | `todayPnl < -dailyMaxLoss` | Stop trading |
| Max drawdown | Drawdown >= 50% of initial balance | Stop trading |
| Max positions | Open positions >= maxOpenPositions | Reject new trade |
| Rate limit | Orders in last 16 mins >= limit | Reject new trade |

**Key Exports**

- `checkDailyLossLimit()`: Check if loss limit exceeded
- `checkMaxPositions()`: Check if max positions reached
- `checkRateLimit()`: Check if rate limit exceeded

### strategyRefinement.ts

Adjusts strategy parameters based on market performance data.

**Refinement Types**

- Market-specific edge multipliers based on historical win rate
- Volatility thresholds based on recent market conditions
- Confidence thresholds based on signal accuracy

**Key Exports**

- `refineStrategy()`: Apply strategy refinements based on performance

### terminal.ts

Formats terminal output for logging and debugging.

**Output Formats**

- Market status display
- Trade execution confirmation
- Signal generation notification
- Error/warning messages

**Key Exports**

- `formatMarketStatus(market)`: Format market status string
- `formatTrade(trade)`: Format trade execution string

---

## 6. Blockchain Layer (src/blockchain/)

### contracts.ts

Defines contract addresses and constants for on-chain interactions.

**Contract Definitions**

| Contract | Network | Address |
|----------|---------|---------|
| CTF Token | Polygon | (token address per market) |
| USDC | Polygon | 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 |

**Chainlink Aggregators**

| Market | Address |
|--------|---------|
| BTC | 0xc907E116054Ad103354f2D350FD2514433D57F6f |
| ETH | 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612 |
| SOL | 0x5d4316B4fddEe94c1D9DA3a8a3c48bD6DA966047 |
| XRP | 0x8F62BF41D0B0Ec112D6953973B1Db26240129c37 |

**Key Exports**

- `CTF_TOKENS`: Map of market ID to token address
- `CHAINLINK_AGGREGATORS`: Map of market ID to aggregator address
- `USDC_ADDRESS`: USDC contract address

### accountState.ts

Manages on-chain account state including USDC balance and CTF positions.

**State Tracking**

- USDC balance
- CTF token balances per market
- Pending transactions
- Last sync timestamp

**Key Exports**

- `syncAccountState()`: Sync account state from on-chain data
- `getBalance()`: Get current USDC balance
- `getPositions()`: Get current CTF positions

### reconciler.ts

Reconciles trade records with on-chain data for accuracy verification.

**Reconciliation Process**

1. Fetch on-chain transaction history
2. Match trades with confirmed transactions
3. Identify discrepancies
4. Update trade records with confirmed on-chain data
5. Log reconciliation results

**Key Exports**

- `reconcileTrades()`: Reconcile trade records with on-chain data

### reconciler-utils.ts

Utility functions for trade reconciliation.

**Functions**

- `parseTxLog(tx)`: Parse transaction logs
- `extractTradeData(logs)`: Extract trade data from logs
- `compareTradeWithTx(trade, tx)`: Compare trade with transaction

**Key Exports**

- Various reconciliation helper functions

### redeemer.ts

Handles automatic redemption of CTF tokens for settled markets.

**Redemption Flow**

1. Detect settled markets
2. Identify CTF token positions in settled markets
3. Call redemption contract
4. Track redemption transactions
5. Update account state

**Key Exports**

- `redeemSettledPositions()`: Redeem all settled positions
- `autoRedeem()`: Auto-redemption triggered on settlement

---

## 7. API Server (src/api.ts)

Hono-based HTTP server providing REST endpoints and WebSocket interface.

**Server Configuration**

- Framework: Hono
- Port: `API_PORT` env var (default 9999)
- Authentication: Bearer token (optional, `API_TOKEN` env var)
- Rate limiting: 600 tokens per 60 seconds
- CORS: Configurable via `CORS_ORIGIN` env var
- Type inference: Exports `AppType` for frontend RPC types

### REST Endpoints

#### Health/Status

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Health check |
| GET | `/api/state` | Full state snapshot |

#### Trades/Signals

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/trades` | Historical trade records |
| GET | `/api/signals` | Trading signals |

#### Paper Mode

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/paper/start` | Start paper trading |
| POST | `/api/paper/stop` | Stop paper trading |
| POST | `/api/paper/reset` | Reset paper trading state |
| POST | `/api/paper/cancel` | Cancel all paper trades |
| GET | `/api/paper-stats` | Paper trading statistics |

#### Live Mode

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/live/connect` | Connect live wallet |
| POST | `/api/live/disconnect` | Disconnect live wallet |
| POST | `/api/live/start` | Start live trading |
| POST | `/api/live/stop` | Stop live trading |
| POST | `/api/live/reset` | Reset live trading state |
| GET | `/api/live-stats` | Live trading statistics |
| GET | `/api/live/balance` | Current USDC balance |
| GET | `/api/live/positions` | Current CTF positions |

#### Configuration

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/config` | Get current configuration |
| PUT | `/api/config` | Update configuration |

#### Database

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/db/diagnostics` | Database diagnostics |

### WebSocket

**Endpoint**: `/ws`

**Events**

| Event | Payload | Description |
|-------|---------|-------------|
| `state:snapshot` | Full state object | Emitted every 1 second |
| `signal:new` | Signal object | Emitted when new signal generated |
| `trade:executed` | Trade object | Emitted when trade executed |

**Key Exports**

- `app`: Hono application instance
- `AppType`: TypeScript type for frontend RPC inference

---

## 8. Dependencies

### Key npm Packages

| Package | Purpose |
|---------|---------|
| `@polymarket/clob-client` | Polymarket CLOB API integration |
| `ethers` | Ethereum/Polygon blockchain interaction |
| `hono` | HTTP server framework |
| `ws` | WebSocket client implementation |
| `zod` | Runtime schema validation |
| `bun:sqlite` | Bun built-in SQLite driver |

### Built-in Node Modules

- `node:fs`: File system operations
- `node:path`: Path manipulation
- `node:events`: EventEmitter

---

## Related Documentation

- [Core Logic](./core-logic.md) — Architecture, data flow, trading strategy, decision logic
- [Deployment Guide](./deployment.md) — Docker setup and environment configuration
- [Frontend Documentation](./frontend.md) — React components, state management, WebSocket integration
