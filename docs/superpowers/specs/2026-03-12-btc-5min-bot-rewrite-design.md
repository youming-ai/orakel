# BTC 5-Min Bot Rewrite Design

## Overview

Rewrite `packages/bot` from scratch as a focused BTC 5-minute up/down trading bot for Polymarket. The bot monitors Chainlink BTC/USD price relative to each window's Price-to-Beat, compares the implied real probability to Polymarket's market price, and trades when edge is sufficient. Trade execution happens through the official Polymarket CLI as a subprocess.

**Scope**: Only `packages/bot` is rewritten. `packages/web` and `packages/shared` receive minimal contract/type updates to match the new bot API shape. The monorepo structure, tooling (Bun, Biome, Vitest, Drizzle), and deployment targets (Docker VPS for bot, Cloudflare Workers for web) are unchanged.

## Target Market

**BTC 5-minute Up/Down** on Polymarket.

- **URL pattern**: `btc-updown-5m-{epoch_end_seconds}` (timestamp = window end time)
- **Resolution**: "Up" if Chainlink BTC/USD price at window end >= price at window start. Otherwise "Down". Uses `>=`, so flat resolves as Up.
- **Cycle**: 288 markets per day, continuous, every 5 minutes. New market appears ~5 minutes before its window starts.
- **Resolution source**: Chainlink BTC/USD data stream (`data.chain.link/streams/btc-usd`)
- **Market discovery**: The bot discovers the current active window by computing the slug from the current time (`btc-updown-5m-{windowEndEpoch}`) and fetching it from the Gamma API via `GET /markets?slug={slug}`. No series ID is needed — slug-based lookup is the primary discovery mechanism. The `slugPrefix` config (`btc-updown-5m-`) is used only for filtering when listing multiple markets (e.g., for backtest data fetching). If slug lookup returns no result (market not yet created), the bot retries next tick.

## Data Sources

Only two external data sources:

| Source | Protocol | Purpose |
|--------|----------|---------|
| **Chainlink BTC/USD** | WebSocket (Polygon) + HTTP fallback | Real-time BTC price, Price-to-Beat reference, settlement oracle |
| **Polymarket** | CLOB WebSocket + Gamma REST API | Market discovery, orderbook (bid/ask for Up/Down tokens), market resolution status |

Binance, Bybit, Coinbase, and all other exchange data adapters are removed entirely.

## Architecture

### CLI-First Execution

The bot delegates all Polymarket interactions (order placement, cancellation, balance queries, CTF redemption) to the official Polymarket CLI (`polymarket`) via subprocess calls with JSON output. The bot's own code handles only monitoring, decision-making, and orchestration.

**Why CLI over SDK**:
- Removes ~60% of custom trading code (execution service, wallet service, order manager heartbeat, nonce management)
- CLI handles signing, retries, and error recovery internally
- approve, redeem, split/merge are single CLI commands vs multi-step SDK + ethers integration
- ~50-100ms subprocess latency is negligible for 5-minute windows

**CLI prerequisites**:
- `polymarket` binary installed and on PATH
- Wallet configured via `POLYMARKET_PRIVATE_KEY` env var or `~/.config/polymarket/config.json`
- USDC.e pre-approved via `polymarket approve set`

### Directory Structure

```
packages/bot/src/
├── index.ts                # Entry: bootstrap -> main loop
├── core/
│   ├── config.ts           # Zod-validated config.json + hot-reload
│   ├── env.ts              # Environment variables (Zod-validated)
│   ├── logger.ts           # createLogger factory (unchanged pattern)
│   ├── state.ts            # Paper/live running state + pending start/stop
│   ├── clock.ts            # 5-min window time calculations
│   └── types.ts            # Core type definitions
├── data/
│   ├── chainlink.ts        # Chainlink WS/HTTP price feed
│   └── polymarket.ts       # Gamma API (market discovery) + CLOB WS (orderbook)
├── cli/
│   ├── executor.ts         # CLI subprocess wrapper (spawn, JSON parse, timeout, retry)
│   ├── commands.ts         # Type-safe CLI command builders
│   └── types.ts            # CLI output type definitions
├── engine/
│   ├── signal.ts           # Price-vs-PtB signal: direction + confidence
│   ├── edge.ts             # Edge: model probability - market probability
│   └── decision.ts         # Trade decision: enter/skip, side, sizing
├── runtime/
│   ├── mainLoop.ts         # Main loop: discover window -> monitor -> decide -> execute
│   ├── windowManager.ts    # Window lifecycle (discover -> trade -> settle -> redeem)
│   ├── settlement.ts       # Post-window settlement verification
│   └── redeemer.ts         # Auto-redeem resolved positions via CLI
├── trading/
│   ├── paperTrader.ts      # Paper trade simulation
│   ├── liveTrader.ts       # Live trading via CLI commands
│   ├── account.ts          # Account stats (P&L, balance, positions)
│   └── persistence.ts      # Signal/trade persistence to DB
├── db/
│   ├── schema.ts           # Drizzle schema (simplified for BTC 5-min)
│   └── client.ts           # PostgreSQL connection
├── app/
│   ├── api/                # Hono API routes (status, config, trades, control)
│   ├── ws.ts               # WebSocket push to frontend
│   └── bootstrap.ts        # App startup (DB, API server, config watcher)
├── backtest/
│   ├── engine.ts           # Backtest engine (replay historical windows)
│   └── replay.ts           # Historical data fetcher for replay
└── terminal/
    └── dashboard.ts        # Terminal UI rendering
```

### What Is Removed vs Current Bot

| Removed | Reason |
|---------|--------|
| `indicators/` (RSI, MACD, VWAP, Heiken Ashi) | TA indicators are meaningless in 5-min binary windows |
| `engines/probability.ts` (TA scoring) | Replaced by direct price-vs-PtB signal |
| `engines/regime.ts` (TREND/CHOP detection) | No regime concept in 5-min windows |
| `data/binance.ts`, `data/bybit.ts`, `data/bybitWs.ts`, `data/binanceWs.ts` | Only Chainlink + Polymarket data |
| `data/priceAggregator.ts` | Single price source (Chainlink) |
| `trading/executionService.ts` | Replaced by CLI executor |
| `trading/walletService.ts` | CLI handles wallet/signing |
| `trading/heartbeatService.ts` | CLI handles order lifecycle |
| `trading/orderManager.ts` (most of it) | CLI handles order tracking |
| `blockchain/` (contracts, redeemer, reconciler, accountState) | Redeem via CLI, no direct on-chain calls |
| `contracts/` (ABIs) | Not needed with CLI |
| `runtime/onchainRuntime.ts` | No direct on-chain operations |
| `runtime/streamFactory.ts` | Replaced by simpler data layer |
| `pipeline/` (fetch, compute, processMarket) | Replaced by simpler engine/ |

## Strategy: Real-Time Price Deviation

### Core Logic

Every tick (1-second poll interval), the bot computes:

```
currentPrice     = Chainlink BTC/USD real-time price
priceToBeat      = Chainlink BTC/USD price at window start (from Polymarket market data)
priceDeviation   = (currentPrice - priceToBeat) / priceToBeat
direction        = currentPrice >= priceToBeat ? "UP" : "DOWN"

modelProbUp      = f(priceDeviation, timeLeft, volatility)
marketProbUp     = Polymarket Up token midpoint price ((bestBid + bestAsk) / 2)

edgeUp           = modelProbUp - marketProbUp
edgeDown         = (1 - modelProbUp) - (1 - marketProbUp)  // = marketProbUp - modelProbUp

bestEdge         = max(edgeUp, edgeDown)
bestSide         = edgeUp > edgeDown ? "UP" : "DOWN"
```

### Model Probability Function

The model probability (`modelProbUp`) maps the current price deviation to a probability that the window closes Up. This is a sigmoid-like function:

```typescript
function modelProbability(
  priceDeviation: number,    // (current - ptb) / ptb, e.g. +0.001 = +0.1%
  timeLeftSeconds: number,   // seconds remaining in window
  recentVolatility: number,  // rolling std of Chainlink price ticks
): number {
  // Larger deviation = higher confidence in direction
  // Less time left = higher confidence (less time for reversal)
  // Higher volatility = lower confidence (more uncertainty)
  const timeDecay = timeLeftSeconds / 300; // 1.0 at start, 0.0 at end
  const volAdjust = Math.max(recentVolatility, MIN_VOLATILITY);
  const z = priceDeviation / (volAdjust * Math.sqrt(timeDecay + EPSILON));
  return sigmoid(z * SIGMOID_SCALE);
}
```

**Key tunable parameters** (in config.json):
- `SIGMOID_SCALE` — Sensitivity of probability to price deviation
- `MIN_VOLATILITY` — Floor for volatility estimate to avoid division by near-zero
- `EPSILON` — Prevents division by zero when timeLeft approaches 0

### Phase-Based Edge Thresholds

Time within the window determines how much edge is required:

| Phase | Time Left | Edge Threshold | Rationale |
|-------|-----------|----------------|-----------|
| EARLY | > 3 min | High (e.g. 0.08) | Price can reverse, need large edge |
| MID | 1-3 min | Medium (e.g. 0.05) | More signal, moderate bar |
| LATE | < 1 min | Low (e.g. 0.03) | Strong signal, lower bar |

These thresholds are configurable per-phase in `config.json`.

### Trade Decision Flow

```
1. Is paper/live running? → No: skip
2. Is there an active window? → No: skip
3. Fetch Chainlink price + Polymarket orderbook
4. Compute model probability + edge
5. Check phase-based edge threshold
6. Check risk limits (max position, daily loss, etc.)
7. If edge sufficient → execute trade (paper or live via CLI)
8. If already have position → monitor (no double-entry per window)
```

### Volatility Estimation

Since we only have Chainlink data, volatility is estimated from recent price ticks:

```typescript
// Rolling window of Chainlink price ticks (last N seconds)
// Compute standard deviation of log returns
const logReturns = ticks.map((t, i) => i > 0 ? Math.log(t.price / ticks[i-1].price) : 0);
const volatility = stddev(logReturns.slice(1));
```

This uses the Chainlink WS feed ticks accumulated during the current window (and optionally the previous window for a warm start).

## CLI Integration Layer

### Executor Design

```typescript
// cli/executor.ts
interface CliResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}

async function execCli<T>(args: string[], opts?: {
  timeoutMs?: number;    // default 10_000
  retries?: number;      // default 1
  parseJson?: boolean;   // default true
}): Promise<CliResult<T>>;
```

All CLI calls go through this single executor which handles:
- Spawning `polymarket` with `-o json` flag
- Timeout (configurable, default 10s)
- JSON output parsing
- Retry on transient failures (network errors, 5xx)
- Structured error logging

### Command Mapping

```typescript
// cli/commands.ts
function createOrder(params: {
  tokenId: string;
  side: "buy";
  price: number;
  size: number;
  orderType: "GTC" | "GTD" | "FOK";
}): Promise<CliResult<OrderResponse>>;

function cancelOrder(orderId: string): Promise<CliResult<void>>;
function cancelAll(): Promise<CliResult<void>>;
function getBalance(): Promise<CliResult<BalanceResponse>>;
function getPositions(): Promise<CliResult<PositionResponse[]>>;
function redeemPositions(): Promise<CliResult<RedeemResponse>>;
function getOrderStatus(orderId: string): Promise<CliResult<OrderStatusResponse>>;
```

### Error Handling

CLI failures are categorized:
- **Transient** (network timeout, 5xx) → retry with backoff
- **Permanent** (insufficient balance, invalid token) → log and skip
- **Fatal** (CLI not found, auth failure) → halt bot with alert

## Window Lifecycle

### WindowManager State Machine

Each 5-minute window goes through these states:

```
PENDING → ACTIVE → CLOSING → SETTLED → REDEEMED
```

| State | Description | Actions |
|-------|-------------|---------|
| PENDING | Window discovered, not yet started | Fetch market metadata, resolve token IDs |
| ACTIVE | Window in progress (0-5 min) | Monitor price, compute edge, execute trades |
| CLOSING | Window ended, awaiting resolution | Stop trading, wait for Polymarket resolution |
| SETTLED | Resolution confirmed | Record outcome, update P&L |
| REDEEMED | Positions redeemed (live only) | CLI redeem call, update balance |

### Window Discovery

```typescript
// Every tick, compute the current and next window
const WINDOW_SEC = 300;
const nowSec = Math.floor(Date.now() / 1000);
const currentWindowEnd = Math.ceil(nowSec / WINDOW_SEC) * WINDOW_SEC;
const currentWindowStart = currentWindowEnd - WINDOW_SEC;
const slug = `btc-updown-5m-${currentWindowEnd}`;

// Fetch market from Gamma API (cached 30s)
const market = await fetchMarketBySlug(slug);
```

### Rolling Window Overlap and Position Counting

The bot tracks two windows simultaneously:
1. **Current window** — actively trading
2. **Previous window** — settling/redeeming

This ensures settlement of the previous window happens while the current window is active.

**Position counting rule**: `maxOpenPositions` counts only **unsettled positions in the current active window**. A previous-window position that is in CLOSING/SETTLED/REDEEMED state does NOT count against the limit, because it can no longer be acted upon and its outcome is determined. This means the bot can always enter a trade in the new window even while the previous window is still settling. The risk is bounded because each window can have at most `maxTradesPerWindow` entries (default 1), and each trade's max loss is `maxTradeSizeUsdc`.

## Data Flow

```
                    ┌─────────────────┐
                    │  Chainlink WS   │
                    │  (BTC/USD feed) │
                    └────────┬────────┘
                             │ price ticks (1-2/sec)
                             ▼
┌──────────────┐    ┌────────────────┐    ┌─────────────┐
│ Polymarket   │───▶│  Main Loop     │───▶│  Engine     │
│ CLOB WS      │    │  (1s interval) │    │  signal.ts  │
│ (orderbook)  │    └────────┬───────┘    │  edge.ts    │
└──────────────┘             │            │  decision.ts│
                             │            └──────┬──────┘
┌──────────────┐             │                   │
│ Gamma API    │─────────────┘            ┌──────▼──────┐
│ (market      │  (market discovery,      │  Decision   │
│  discovery)  │   PriceToBeat,           │  ENTER/SKIP │
└──────────────┘   token IDs)             └──────┬──────┘
                                                 │
                                          ┌──────▼──────┐
                                          │   Trader    │
                                          │  paper or   │
                                          │  live (CLI) │
                                          └──────┬──────┘
                                                 │
                                          ┌──────▼──────┐
                                          │  Database   │
                                          │  (signals,  │
                                          │   trades,   │
                                          │   P&L)      │
                                          └─────────────┘
```

### Tick Processing (per 1-second loop iteration)

1. Read latest Chainlink price from WS buffer
2. Read latest Polymarket orderbook from WS buffer
3. Determine current window state (PENDING/ACTIVE/CLOSING/SETTLED)
4. If ACTIVE:
   a. Compute signal (price vs PtB)
   b. Compute edge (model prob vs market prob)
   c. Make decision (phase, thresholds, risk limits)
   d. Execute trade if warranted
5. If CLOSING/SETTLED: run settlement logic
6. Publish state snapshot (API + WS to frontend)
7. Render terminal dashboard

## Configuration

### config.json Structure (Simplified)

```json
{
  "strategy": {
    "edgeThresholdEarly": 0.08,
    "edgeThresholdMid": 0.05,
    "edgeThresholdLate": 0.03,
    "phaseEarlySeconds": 180,
    "phaseLateSeconds": 60,
    "sigmoidScale": 5.0,
    "minVolatility": 0.0001,
    "maxEntryPrice": 0.92,
    "minTimeLeftSeconds": 15,
    "maxTimeLeftSeconds": 270
  },
  "risk": {
    "paper": {
      "maxTradeSizeUsdc": 5,
      "dailyMaxLossUsdc": 100,
      "maxOpenPositions": 1,
      "maxTradesPerWindow": 1
    },
    "live": {
      "maxTradeSizeUsdc": 5,
      "dailyMaxLossUsdc": 100,
      "maxOpenPositions": 1,
      "maxTradesPerWindow": 1
    }
  },
  "execution": {
    "orderType": "GTC",
    "limitDiscount": 0.02,
    "minOrderPrice": 0.05,
    "maxOrderPrice": 0.95
  },
  "infra": {
    "pollIntervalMs": 1000,
    "cliTimeoutMs": 10000,
    "cliRetries": 1,
    "chainlinkWssUrls": ["wss://..."],
    "chainlinkHttpUrl": "https://...",
    "chainlinkAggregator": "0xc907E116054Ad103354f2D350FD2514433D57F6f",
    "chainlinkDecimals": 8,
    "polymarketGammaUrl": "https://gamma-api.polymarket.com",
    "polymarketClobUrl": "https://clob.polymarket.com",
    "polymarketClobWsUrl": "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    "slugPrefix": "btc-updown-5m-",
    "windowSeconds": 300
  },
  "maintenance": {
    "signalLogRetentionDays": 30,
    "pruneIntervalMs": 3600000,
    "redeemIntervalMs": 60000
  }
}
```

All fields Zod-validated at startup. Hot-reload for `strategy` and `risk` sections.

### Environment Variables

```
PAPER_MODE=true              # Start in paper mode
POLYMARKET_PRIVATE_KEY=0x... # Wallet private key (used by CLI; single source of truth)
DATABASE_URL=postgres://...  # PostgreSQL
API_TOKEN=...                # API auth for Hono endpoints
PORT=9999                    # API server port
LOG_LEVEL=info               # Logging level
```

**Note**: Only `POLYMARKET_PRIVATE_KEY` is used. The bot does not manage a separate wallet — the CLI reads this env var directly for all signing operations.

## Database Schema

Simplified from current schema. Only tables needed for BTC 5-min:

### trades

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| mode | text | "paper" or "live" |
| windowSlug | text | e.g. "btc-updown-5m-1773298200" |
| windowStartMs | bigint | Window start epoch ms |
| windowEndMs | bigint | Window end epoch ms |
| side | text | "UP" or "DOWN" |
| price | numeric | Entry price |
| size | numeric | USDC size |
| priceToBeat | numeric | BTC price at window start |
| entryBtcPrice | numeric | BTC price at trade entry |
| edge | numeric | Calculated edge at entry |
| modelProb | numeric | Model probability at entry |
| marketProb | numeric | Market probability at entry |
| phase | text | "EARLY", "MID", "LATE" |
| orderId | text | CLI order ID (null for paper) |
| outcome | text | "WIN", "LOSS", null (pending) |
| settleBtcPrice | numeric | BTC price at window end (null until settled) |
| pnlUsdc | numeric | Profit/loss (null until settled) |
| createdAt | timestamp | |
| settledAt | timestamp | |

### signals

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| windowSlug | text | |
| timestamp | timestamp | |
| chainlinkPrice | numeric | |
| priceToBeat | numeric | |
| deviation | numeric | |
| modelProbUp | numeric | |
| marketProbUp | numeric | |
| edgeUp | numeric | |
| edgeDown | numeric | |
| volatility | numeric | |
| timeLeftSeconds | integer | |
| phase | text | |
| decision | text | "ENTER_UP", "ENTER_DOWN", "SKIP" |
| reason | text | Skip reason if applicable |

### balanceSnapshots

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| mode | text | |
| balanceUsdc | numeric | |
| totalPnl | numeric | |
| winCount | integer | |
| lossCount | integer | |
| snapshotAt | timestamp | |

## Error Handling

### Layered Strategy

| Layer | Error Type | Response |
|-------|-----------|----------|
| **Data** | Chainlink WS disconnect | Reconnect with backoff; use HTTP fallback; skip trading until price is fresh |
| **Data** | Polymarket WS disconnect | Reconnect; use REST fallback for orderbook; skip trading if market price stale |
| **Data** | Gamma API failure | Retry with backoff; use cached market data (30s TTL) |
| **CLI** | Transient failure (timeout, 5xx) | Retry once; log warning |
| **CLI** | Permanent failure (auth, balance) | Log error; halt live trading; continue paper |
| **CLI** | CLI binary not found | Fatal error at startup |
| **Engine** | Stale price (> 5s old) | Skip trading this tick |
| **Engine** | Missing PriceToBeat | Skip window entirely |
| **Runtime** | All ticks failing for 60s+ | Enter safe mode; stop trading; alert |
| **DB** | Connection failure | Degrade: continue trading without persistence; reconnect in background |

### Safe Mode

If the bot detects N consecutive tick failures (configurable, default 10), it enters safe mode:
- Stops placing new trades
- Continues monitoring and settlement
- Publishes alert via API/WS
- Auto-recovers when ticks succeed again

## Testing Strategy

### Unit Tests (Pure Functions)

- `clock.ts` — Window time calculations, slug generation, phase detection
- `engine/signal.ts` — Model probability function with known inputs/outputs
- `engine/edge.ts` — Edge calculation correctness
- `engine/decision.ts` — Decision logic with various edge/phase/risk combinations
- `cli/executor.ts` — JSON parsing, timeout behavior, retry logic (mock subprocess)
- `trading/paperTrader.ts` — Paper fill simulation
- `trading/account.ts` — P&L calculation, balance updates

### Integration Tests

- CLI commands — Verify JSON output parsing against real CLI (optional, requires CLI installed)
- Chainlink data — Verify price parsing from WS messages
- Polymarket data — Verify orderbook parsing from CLOB WS messages
- Database — Verify schema and query correctness via test DB

### Backtest Validation

The backtest engine replays historical 5-min windows. There are two distinct data needs:

**A. BTC/USD price (Chainlink oracle — used for signal computation)**:
- **Primary (high fidelity)**: The bot's own `signals` table, which stores `chainlinkPrice` at every 1-second tick during live/paper operation. This is only available for windows after the bot starts running.
- **Fallback (low fidelity)**: For windows before the bot existed, use Chainlink's on-chain historical data via Polygon RPC (`getRoundData` on the aggregator contract). This provides ~1 update per heartbeat (~20s for BTC/USD). Alternatively, fetch from a third-party Chainlink data archive.
- **Note**: The Polymarket CLOB `/prices-history` endpoint returns **token price history** (Up/Down outcome prices), NOT BTC/USD oracle prices. These are different data.

**B. Polymarket market prices (used for edge computation)**:
- **Primary (high fidelity)**: The bot's `signals` table stores `marketProbUp` at each tick.
- **Fallback (low fidelity)**: The CLOB `/prices-history?market={upTokenId}` endpoint provides historical Up token prices at 1-minute fidelity. This represents the market-implied probability of Up.

**C. Price-to-Beat and outcome**: For each historical window, fetch the market via `GET /markets?slug={slug}`. The market's `eventStartTime` identifies the window start; the resolution outcome (Up/Down) is available from the market's resolved state.

**Replay flow**:
1. For a date range, generate all window slugs (`btc-updown-5m-{t}` for each 5-min boundary)
2. For each window, fetch: (a) BTC/USD price series, (b) Up token price series, (c) PriceToBeat, (d) actual outcome
3. Simulate the strategy tick-by-tick (1-second from signals table, or interpolated from lower-fidelity sources)
4. Record simulated decisions and compare to actual outcomes
5. Report: win rate, P&L, Sharpe ratio, max drawdown, edge distribution, calibration curve

**Practical implication**: The backtest is most accurate for windows where the bot was running and recording ticks. For pre-existing windows, backtest fidelity is lower (1-minute for market prices, ~20s for BTC/USD) and results should be interpreted with that caveat.

## API Endpoints (Hono)

Simplified from current bot, focused on BTC 5-min:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Bot status (mode, running state, current window, balance) |
| GET | `/api/trades` | Trade history with pagination |
| GET | `/api/signals` | Recent signal log |
| GET | `/api/config` | Current config snapshot |
| PATCH | `/api/config` | Update strategy/risk config (hot-reload) |
| POST | `/api/control/start` | Start paper/live trading |
| POST | `/api/control/stop` | Stop trading |
| GET | `/api/stats` | Aggregated stats (win rate, P&L, etc.) |
| WS | `/ws` | Real-time state snapshots to frontend |

## API & WebSocket Contracts

### GET /api/status → StatusDto

```typescript
interface StatusDto {
  paperRunning: boolean;
  liveRunning: boolean;
  paperPendingStart: boolean;
  paperPendingStop: boolean;
  livePendingStart: boolean;
  livePendingStop: boolean;
  currentWindow: {
    slug: string;                // "btc-updown-5m-1773298200"
    state: "PENDING" | "ACTIVE" | "CLOSING" | "SETTLED" | "REDEEMED";
    startMs: number;
    endMs: number;
    timeLeftSeconds: number;
    priceToBeat: number | null;
  } | null;
  chainlinkPrice: number | null;
  chainlinkPriceAgeMs: number | null;
  cliAvailable: boolean;
  dbConnected: boolean;
  uptimeMs: number;
}
```

### GET /api/stats → StatsDto

```typescript
interface StatsDto {
  paper: AccountStatsDto;
  live: AccountStatsDto;
}

interface AccountStatsDto {
  totalTrades: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;           // 0-1
  totalPnl: number;          // USDC
  todayPnl: number;
  todayTrades: number;
  dailyMaxLoss: number;      // from config
  balanceUsdc: number;       // current balance
}
```

### PATCH /api/config — Request Body

```typescript
interface ConfigUpdateDto {
  strategy?: Partial<{
    edgeThresholdEarly: number;
    edgeThresholdMid: number;
    edgeThresholdLate: number;
    phaseEarlySeconds: number;
    phaseLateSeconds: number;
    sigmoidScale: number;
    minVolatility: number;
    maxEntryPrice: number;
    minTimeLeftSeconds: number;
    maxTimeLeftSeconds: number;
  }>;
  risk?: {
    paper?: Partial<RiskConfigDto>;
    live?: Partial<RiskConfigDto>;
  };
}

interface RiskConfigDto {
  maxTradeSizeUsdc: number;
  dailyMaxLossUsdc: number;
  maxOpenPositions: number;
  maxTradesPerWindow: number;
}
```

### GET /api/trades → TradeRecordDto[]

```typescript
// Query params: ?mode=paper|live&limit=50&offset=0&from=2026-03-01&to=2026-03-12
interface TradeRecordDto {
  id: number;
  mode: "paper" | "live";
  windowSlug: string;
  side: "UP" | "DOWN";
  price: number;
  size: number;
  priceToBeat: number;
  entryBtcPrice: number;
  edge: number;
  modelProb: number;
  marketProb: number;
  phase: "EARLY" | "MID" | "LATE";
  orderId: string | null;
  outcome: "WIN" | "LOSS" | null;
  settleBtcPrice: number | null;
  pnlUsdc: number | null;
  createdAt: string;        // ISO timestamp
  settledAt: string | null;
}
```

### GET /api/signals → SignalRecordDto[]

```typescript
// Query params: ?windowSlug=btc-updown-5m-1773298200&limit=100&offset=0
interface SignalRecordDto {
  id: number;
  windowSlug: string;
  timestamp: string;
  chainlinkPrice: number;
  priceToBeat: number;
  deviation: number;
  modelProbUp: number;
  marketProbUp: number;
  edgeUp: number;
  edgeDown: number;
  volatility: number;
  timeLeftSeconds: number;
  phase: "EARLY" | "MID" | "LATE";
  decision: "ENTER_UP" | "ENTER_DOWN" | "SKIP";
  reason: string | null;
}
```

### GET /api/config → ConfigSnapshotDto

```typescript
interface ConfigSnapshotDto {
  strategy: {
    edgeThresholdEarly: number;
    edgeThresholdMid: number;
    edgeThresholdLate: number;
    phaseEarlySeconds: number;
    phaseLateSeconds: number;
    sigmoidScale: number;
    minVolatility: number;
    maxEntryPrice: number;
    minTimeLeftSeconds: number;
    maxTimeLeftSeconds: number;
  };
  risk: {
    paper: RiskConfigDto;
    live: RiskConfigDto;
  };
  execution: {
    orderType: string;
    limitDiscount: number;
    minOrderPrice: number;
    maxOrderPrice: number;
  };
}
```

### POST /api/control/start and /api/control/stop

```typescript
// Request body
interface ControlRequestDto {
  mode: "paper" | "live";
}

// Response
interface ControlResponseDto {
  ok: boolean;
  message: string;       // e.g. "Paper trading started" or "Already running"
  state: {
    paperRunning: boolean;
    liveRunning: boolean;
  };
}
```

### WS state:snapshot → StateSnapshotPayload

```typescript
interface StateSnapshotPayload {
  updatedAt: string;         // ISO timestamp
  paperRunning: boolean;
  liveRunning: boolean;
  paperPendingStart: boolean;
  paperPendingStop: boolean;
  livePendingStart: boolean;
  livePendingStop: boolean;
  currentWindow: {
    slug: string;
    state: "PENDING" | "ACTIVE" | "CLOSING" | "SETTLED" | "REDEEMED";
    startMs: number;
    endMs: number;
    timeLeftSeconds: number;
    priceToBeat: number | null;
    chainlinkPrice: number | null;
    deviation: number | null;
    modelProbUp: number | null;
    marketProbUp: number | null;
    edgeUp: number | null;
    edgeDown: number | null;
    phase: "EARLY" | "MID" | "LATE" | null;
    decision: "ENTER_UP" | "ENTER_DOWN" | "SKIP" | null;
    volatility: number | null;
  } | null;
  paperStats: AccountStatsDto | null;
  liveStats: AccountStatsDto | null;
}
```

### WS Event Types

```typescript
type WsEventType = "state:snapshot" | "signal:new" | "trade:executed";

interface WsMessage<T = unknown> {
  type: WsEventType;
  data: T;
  ts: number;
}

// signal:new payload
interface SignalNewPayload {
  windowSlug: string;
  chainlinkPrice: number;
  priceToBeat: number;
  deviation: number;
  modelProbUp: number;
  marketProbUp: number;
  edgeUp: number;
  edgeDown: number;
  phase: "EARLY" | "MID" | "LATE";
  decision: "ENTER_UP" | "ENTER_DOWN" | "SKIP";
  reason: string | null;
}

// trade:executed payload
interface TradeExecutedPayload {
  mode: "paper" | "live";
  windowSlug: string;
  side: "UP" | "DOWN";
  price: number;
  size: number;
  edge: number;
  orderId: string | null;  // null for paper
  timestamp: string;
}
```

## Frontend Impact (OUT OF SCOPE)

`packages/web` updates are **not part of this implementation plan**. They will be a separate spec and plan after the bot rewrite is complete and stable. The bot's API and WS contracts defined above are the interface boundary — the frontend will consume them.

For reference, the web changes needed eventually:
- Remove multi-market UI (only BTC 5-min now)
- Update state types to match new snapshot/DTO shapes
- Simplify dashboard widgets (no RSI/MACD/VWAP charts)
- Add: current window timer, Chainlink price vs PtB visualization, edge gauge

## Shared Package Impact

`packages/shared/src/contracts/` is rewritten to export the DTOs defined in the "API & WebSocket Contracts" section above. The existing files (`config.ts`, `state.ts`, `http.ts`) are replaced:

- **config.ts**: Export `StrategyConfig`, `RiskConfigDto`, `ConfigUpdateDto` (new shapes from config section)
- **state.ts**: Export `StateSnapshotPayload`, `SignalNewPayload`, `TradeExecutedPayload`, `AccountStatsDto`, `WsEventType`, `WsMessage` (new shapes from WS contracts section)
- **http.ts**: Export `StatusDto`, `StatsDto`, `TradeRecordDto`, `ConfigSnapshotDto` (new shapes from API contracts section)
- **schemas.ts**: Zod schemas for runtime validation of the above types (used by both bot and web)

All old types (`MarketSnapshot`, `ConfidenceDto`, `PaperStats`, `DashboardStateDto`, etc.) are removed.

## Deployment

Unchanged:
- Bot: Docker on VPS (`packages/bot/Dockerfile`)
- Frontend: Cloudflare Workers

New requirement:
- Docker image must include `polymarket` CLI binary
- Dockerfile needs: install Rust toolchain OR download pre-built binary from GitHub releases

## Migration Path

1. Create new bot code in `packages/bot/src/` (replace existing files)
2. New Drizzle schema → generate migration
3. Update `packages/shared` contracts to match new DTOs
4. Test with paper trading on live 5-min markets
5. Deploy bot
6. (Separate plan) Update `packages/web` to match new API

## Resolved Design Decisions

1. **Market discovery**: Uses slug-based lookup (`GET /markets?slug=btc-updown-5m-{epochEnd}`), not series ID. No series ID needed.
2. **CLI in Docker**: Download pre-built binary from GitHub releases in Dockerfile (faster, no Rust toolchain needed). Use `curl` to fetch the latest release for linux-amd64 during build. Fallback: user can mount a host-compiled binary via Docker volume.
3. **Backtest data source**: Primary source is the Polymarket CLOB price history API (1-minute fidelity). Secondary source is the bot's own `signals` table accumulated during live operation (1-second fidelity). See Backtest Validation section for details.
