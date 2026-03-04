# Backend Architecture

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
├── api.ts                      # Hono HTTP server + WebSocket
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
│   ├── persistence.ts          # Trade/signal persistence to DB
│   ├── liveGuards.ts           # Live trading safety checks
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
| MarketPerformance | Per-market performance tracking and adaptive multipliers | Yes |

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

## 5. Engine Layer (src/engines/)

### probability.ts

Computes probability estimates by fusing technical analysis scoring with volatility-implied probability.

**Key Functions**

| Function | Purpose |
|----------|---------|
| `scoreDirection(data, direction)` | Technical analysis scoring (6 indicators) |
| `computeVolatilityImpliedProb(currentPrice, priceToBeat, volatility, timeLeft)` | Black-Scholes-style probability with fat-tail dampening |
| `applyTimeDecay(prob, timeLeftMin)` | S-curve time decay adjustment |
| `blendProbabilities(volImplied, taRaw, adjustments)` | 50/50 blend with adjustments |

**Blending Adjustments**

- Binance lead effect: ±2% if price leads by >0.1%
- Orderbook imbalance: ±2% if imbalance >0.2

For detailed formulas and thresholds, see [Trading Strategy](./trading-strategy.md#2-probability-engine-srcenginesprobabilityts).

**Key Exports**

- `computeProbability()`: Main probability computation function

### edge.ts

Calculates edge (model probability minus market price) and makes trading decisions.

**Key Functions**

| Function | Purpose |
|----------|---------|
| `computeEdge(modelProb, marketPrice, orderbookData)` | Edge calculation with slippage and fee adjustments |
| `computeConfidence(data, direction, regime)` | 5-factor weighted confidence score |
| `decide(data, marketConfig)` | Complete trading decision pipeline |

**Decision Logic**

17 sequential checks including:
- Data validation
- Skip markets filter
- Edge threshold (phase-based)
- Min probability check
- Overconfidence protection (soft cap 0.25, hard cap 0.40)
- Regime multipliers
- Confidence scoring

For detailed decision flow, see [Trading Strategy](./trading-strategy.md#6-trading-decision-decide).

**Key Exports**

- `computeEdge()`, `computeConfidence()`, `decide()`

### regime.ts

Detects current market regime (trend, range, or choppy).

**Decision Tree**

1. Missing data → CHOP
2. Low volume + near VWAP → CHOP
3. Price > VWAP + rising slope → TREND_UP
4. Price < VWAP + falling slope → TREND_DOWN
5. VWAP cross count >= 3 → CHOP
6. Default → RANGE

**Regime Implications**

| Regime | Multiplier (Aligned) | Multiplier (Opposed) |
|--------|----------------------|----------------------|
| TREND_UP (UP) | 0.75 | 1.3 |
| TREND_DOWN (DOWN) | 0.75 | 1.3 |
| RANGE | 1.0 | 1.0 |
| CHOP | 1.4 | 1.4 |

For detailed regime detection logic, see [Trading Strategy](./trading-strategy.md#3-market-regime-engine-srcenginesregimets).

**Key Exports**

- `detectRegime(data, window)`: Returns regime (TREND_UP, TREND_DOWN, RANGE, CHOP)

### arbitrage.ts

Detects arbitrage opportunities between UP and DOWN contracts.

**Detection Logic**

- `rawSum < 0.98`: Arbitrage opportunity (UP + DOWN quotes sum below 1)
- `rawSum > 1.04`: Vig too high, skip market

**Key Exports**

- `detectArbitrage(marketData)`: Returns arbitrage opportunity data

---

## 6. Indicators Layer (src/indicators/)

### rsi.ts

Computes Relative Strength Index with SMA and slope.

**Parameters**

| Parameter | Value | Description |
|-----------|-------|-------------|
| Period | 14 | RSI lookback period |
| SMA Period | 3 | SMA period for RSI |

**Outputs**

- RSI value (0-100)
- RSI SMA
- RSI slope (change over time)

**Key Exports**

- `computeRsi(prices, period = 14)`
- `computeRsiSma(rsiValues, period = 3)`
- `computeSlope(values)`

### macd.ts

Computes MACD (Moving Average Convergence Divergence) indicator.

**Parameters**

| Parameter | Value | Description |
|-----------|-------|-------------|
| Fast Period | 12 | Fast EMA period |
| Slow Period | 26 | Slow EMA period |
| Signal Period | 9 | Signal line EMA period |

**Outputs**

- MACD line
- Signal line
- Histogram (MACD - Signal)
- Histogram delta (change over time)

**Key Exports**

- `computeMacd(prices, fast = 12, slow = 26, signal = 9)`

### vwap.ts

Computes Volume Weighted Average Price and session VWAP series.

**Outputs**

| Output | Description |
|--------|-------------|
| Current VWAP | Session VWAP value |
| VWAP Series | Array of VWAP values over time |
| VWAP Slope | Rate of change of VWAP |

**Key Exports**

- `computeVwap(candles)`: Returns current VWAP and series
- `computeVwapSlope(vwapSeries)`: Returns VWAP slope

### heikenAshi.ts

Computes Heiken Ashi smoothed candles.

**Formula**

- Close = (Open + High + Low + Close) / 4
- Open = (Previous Open + Previous Close) / 2
- High = max(High, Open, Close)
- Low = min(Low, Open, Close)

**Outputs**

| Output | Description |
|--------|-------------|
| HA Candles | Heiken Ashi candle data |
| Consecutive Green | Count of consecutive green candles |
| Consecutive Red | Count of consecutive red candles |

**Key Exports**

- `computeHeikenAshi(candles)`: Returns HA candles and consecutive counts

---

## 7. Pipeline Layer (src/pipeline/)

### fetch.ts

Orchestrates data fetching from multiple external sources in parallel.

**Fetch Strategy**

| Data Source | Fetch Method | Cache | Parallel |
|-------------|--------------|-------|----------|
| Binance Klines | REST | 60s | Yes |
| Binance Price | WS (streaming) | N/A | N/A |
| Polymarket Market | REST | 30s | Yes |
| Polymarket Price | REST | 3s | Yes |
| Polymarket Orderbook | WS (streaming) | N/A | N/A |
| Chainlink Price | RPC | 2s min | Yes |
| Chainlink Price | WS (streaming) | N/A | N/A |

**Key Exports**

- `fetchMarketData(marketConfig)`: Returns aggregated market data

### compute.ts

Orchestrates indicator calculation and engine orchestration to produce trade decisions.

**Pipeline Flow**

1. Compute Heiken Ashi candles
2. Compute RSI with SMA and slope
3. Compute MACD with histogram and delta
4. Compute VWAP with series and slope
5. Compute realized volatility
6. Compute probability (TA + vol-implied blend)
7. Detect market regime
8. Compute edge and confidence
9. Make trading decision

**Key Exports**

- `computeDecision(marketData)`: Returns TradeDecision object

### processMarket.ts

Per-market entry point that orchestrates fetch → compute → signal flow.

**Execution Flow**

1. Call `fetchMarketData()` to get latest data
2. Call `computeDecision()` to get trade decision
3. If ENTER decision, emit `signal:new` event
4. Update market snapshot in shared state

**Key Exports**

- `processMarket(marketConfig)`: Main per-market processing function

---

## 8. Trading Layer (src/trading/)

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

## 9. Blockchain Layer (src/blockchain/)

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

## 10. API Server (src/api.ts)

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

## 11. Main Loop (src/index.ts)

System entry point that drives the entire trading flow.

### Startup Sequence

Executes sequentially on startup:

1. Initialize logger
2. Load configuration (config.json)
3. Load environment variables (.env)
4. Initialize SQLite database
5. Initialize shared state
6. Start Hono API server
7. Initialize OrderManager
8. Load active markets
9. Initialize WebSocket streams:
   - Binance price stream
   - Polymarket live price stream
   - Polymarket CLOB stream
   - Chainlink price stream
10. Enter main loop

### Main Loop Execution

Executes every `CONFIG.pollIntervalMs` milliseconds (default 1000ms):

1. Check running state (paper/live)
2. Detect 15-minute window boundary
3. Process pending start/stop transitions (if at boundary)
4. Settle previous window's paper trades (if at boundary)
5. Process all markets in parallel:
   - Fetch data
   - Compute indicators
   - Run engines
   - Generate signals
6. Filter candidates:
   - ENTER decision
   - Valid price data
   - Proper window timing
7. Sort candidates by edge DESC, rawSum ASC
8. Execute trades (subject to position limits)
9. Emit state snapshot (`state:snapshot` event)
10. Sleep for pollIntervalMs

### Safe Mode

After 3 consecutive all-market failures, enters safe mode:

- Skips trade execution
- Continues processing markets
- Exits safe mode when at least one market processes successfully

### Key Exports

- None (main entry point)

---

## 12. Dependencies

### Key npm Packages

| Package | Purpose |
|---------|---------|
| `@polymarket/clob-client` | Polymarket CLOB API integration |
| `ethers` | Ethereum/Polygon blockchain interaction |
| `hono` | HTTP server framework |
| `ws` | WebSocket client implementation |
| `zod` | Runtime schema validation |
| `better-sqlite3` | SQLite database driver |

### Built-in Node Modules

- `node:fs`: File system operations
- `node:path`: Path manipulation
- `node:events`: EventEmitter

---

## 13. Related Documentation

- [System Architecture](./architecture.md) — Overall system design and data flow
- [Trading Strategy](./trading-strategy.md) — Detailed probability, edge, and decision formulas
- [Deployment Guide](./deployment.md) — Docker setup and environment configuration
- [Flowcharts](./FLOWCHARTS.md) — Visual diagrams of system and decision flows
