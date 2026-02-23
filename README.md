# Polymarket Crypto 15m Trading Bot

A production-grade automated trading bot for Polymarket **15-minute Up/Down** crypto markets with paper trading support, web dashboard, and Docker containerization.

## Supported Markets

| Market | Binance Symbol | Chainlink Aggregator |
|--------|----------------|---------------------|
| BTC | BTCUSDT | 0xc907E116054Ad103354f2D350FD2514433D57F6f |
| ETH | ETHUSDT | 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612 |
| SOL | SOLUSDT | 0x5d4316B4fddEe94c1D9DA3a8a3c48bD6DA966047 |
| XRP | XRPUSDT | 0x8F62BF41D0B0Ec112D6953973B1Db26240129c37 |

## Features

- **Paper Trading Mode** — Simulate trades against live market data without spending real USDC
- **Real-time Data** — Binance WebSocket + Polymarket Chainlink feed + on-chain fallback
- **Technical Analysis** — Heiken Ashi, RSI, MACD, VWAP, realized volatility
- **Probability Model** — Volatility-implied probability blended with TA scoring
- **Regime Detection** — Trend/RANGE/CHOP market state detection with dynamic thresholds
- **Web Dashboard** — Astro + React + shadcn/ui + recharts for monitoring and visualization
- **Docker Ready** — One-command deployment with docker-compose

## Architecture

```
                         Docker Compose
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─────────────────────┐    ┌──────────────────────────┐ │
│  │  web (port 4321)    │    │  bot (port 9999)         │ │
│  │  Astro Dev Server   │───▶│  Bun Runtime             │ │
│  │                     │/api│                          │ │
│  │  React 19           │    │  Hono API Server         │ │
│  │  shadcn/ui          │    │  ├ GET /api/state        │ │
│  │  recharts           │    │  ├ GET /api/trades       │ │
│  │  Tailwind v4        │    │  ├ GET /api/signals      │ │
│  │  Hot Reload         │    │  └ GET /api/paper-stats  │ │
│  └─────────────────────┘    │                          │ │
│                              │  Trading Engine          │ │
│                              │  ├ Data Collection       │ │
│                              │  ├ TA Indicators         │ │
│                              │  ├ Probability Blend     │ │
│                              │  ├ Edge Computation      │ │
│                              │  └ Paper/Live Execution  │ │
│                              └──────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) + Docker Compose (for containerized deployment)
- [OrbStack](https://orbstack.dev/) (recommended for macOS)

### Run with Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/FrondEnt/PolymarketBTC15mAssistant.git
cd PolymarketBTC15mAssistant

# Create .env file
echo "PAPER_MODE=true" > .env

# Start both services
docker compose up --build

# Bot API:    http://localhost:9999
# Web Dashboard: http://localhost:4321
```

### Run Locally (Development)

```bash
# Install dependencies
bun install

# Install web dependencies
cd web && bun install && cd ..

# Create .env file
echo "PAPER_MODE=true" > .env

# Terminal 1: Run bot
bun run start

# Terminal 2: Run web dev server
cd web && bun run dev
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPER_MODE` | `false` | Enable paper trading (no real money) |
| `PRIVATE_KEY` | - | EOA wallet private key (64 hex chars, without 0x prefix) |
| `POLYGON_RPC_URL` | `https://polygon-rpc.com` | Polygon RPC endpoint |
| `POLYGON_WSS_URL` | - | Polygon WebSocket RPC |
| `HTTPS_PROXY` | - | HTTP proxy for all requests |

### Strategy Configuration (`config.json`)

```json
{
  "risk": {
    "maxTradeSizeUsdc": 5,
    "limitDiscount": 0.05,
    "dailyMaxLossUsdc": 100,
    "maxOpenPositions": 2,
    "minLiquidity": 15000,
    "maxTradesPerWindow": 1
  },
  "strategy": {
    "edgeThresholdEarly": 0.06,
    "edgeThresholdMid": 0.08,
    "edgeThresholdLate": 0.10,
    "minProbEarly": 0.52,
    "minProbMid": 0.55,
    "minProbLate": 0.60,
    "blendWeights": { "vol": 0.5, "ta": 0.5 },
    "regimeMultipliers": {
      "CHOP": 1.3,
      "RANGE": 1.0,
      "TREND_ALIGNED": 0.8,
      "TREND_OPPOSED": 1.2
    }
  }
}
```

#### Strategy Parameters Explained

| Parameter | Description |
|-----------|-------------|
| `edgeThresholdEarly/Mid/Late` | Minimum edge required to trade in each time phase (>10min, 5-10min, <5min) |
| `minProbEarly/Mid/Late` | Minimum model probability required |
| `blendWeights.vol/ta` | Weight for volatility-implied vs TA-based probability |
| `regimeMultipliers` | Threshold multiplier based on detected market regime |

#### Edge Calculation

```
effectiveThreshold = baseThreshold × regimeMultiplier
edge = modelProbability - marketPrice

Trade triggers when: edge ≥ effectiveThreshold AND modelProb ≥ minProb
```

Example: In CHOP regime during EARLY phase:
- Effective threshold = 0.06 × 1.3 = 0.078
- Model must show at least 7.8% edge over market price

## Trading Logic

### Data Flow (per second)

```
1. Data Collection (parallel)
   ├─ Binance REST: 240 × 1-min candles
   ├─ Binance WS: Real-time trade price
   ├─ Polymarket WS: Chainlink current price
   ├─ Polymarket REST: Market data + UP/DOWN prices + orderbook

2. Technical Indicators
   ├─ Heiken Ashi: Candle color + consecutive count
   ├─ RSI(14): Relative strength + slope
   ├─ MACD(12,26,9): Histogram + histogram delta
   ├─ VWAP: Volume-weighted average price + slope
   └─ Volatility: 60-candle realized volatility × √15

3. Direction Scoring
   ├─ Price vs VWAP: +2 points for direction
   ├─ VWAP slope: +2 points for direction
   ├─ RSI + slope: +2 points if aligned
   ├─ MACD histogram: +2 points if expanding
   └─ Heiken Ashi: +1 point if 2+ consecutive
   → rawUp = upScore / (upScore + downScore)

4. Probability Blending
   ├─ Volatility-implied: Φ(ln(P/PTB) / (vol × √(t/15)))
   ├─ TA raw: rawUp from step 3
   └─ Blended: (0.5×vol + 0.5×ta) + adjustments

5. Regime Detection
   ├─ TREND_UP: Price>VWAP, VWAP↑, volume>avg
   ├─ TREND_DOWN: Price<VWAP, VWAP↓, volume>avg
   ├─ CHOP: VWAP crossovers >3 in 20 candles
   └─ RANGE: Default

6. Edge Computation
   ├─ rawSum = marketYes + marketNo
   ├─ Arbitrage if rawSum < 0.98
   ├─ Skip if rawSum > 1.06 (vig too high)
   └─ edgeUp = modelUp - marketUp

7. Trade Decision
   ├─ Phase: EARLY(>10min), MID(5-10min), LATE(<5min)
   ├─ Apply regime multiplier to threshold
   └─ ENTER if edge ≥ threshold AND prob ≥ minProb
```

### Paper Trading Settlement

When a 15-minute window expires:
- If `finalPrice > PTB` → UP wins
- If `finalPrice < PTB` → DOWN wins  
- If `finalPrice = PTB` → DOWN wins (Polymarket rule)

P&L calculation:
- Win: `+size × (1 - buyPrice)`
- Loss: `-size × buyPrice`

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/state` | Full dashboard state (markets, wallet, config, paper stats) |
| `GET /api/trades` | Recent trades from CSV (100 records) |
| `GET /api/signals` | Recent signals from CSV (200 records) |
| `GET /api/paper-stats` | Paper trading statistics + trade details |

### Example Response: `/api/state`

```json
{
  "markets": [{
    "id": "BTC",
    "spotPrice": 68034,
    "priceToBeat": 68010,
    "marketUp": 0.66,
    "marketDown": 0.33,
    "predictDirection": "LONG",
    "haColor": "green",
    "haConsecutive": 3,
    "rsi": 51.8,
    "macd": {"hist": 0.2, "histDelta": 0.05},
    "vwapSlope": 0.12,
    "action": "ENTER",
    "side": "UP",
    "edge": 0.082,
    "strength": "GOOD"
  }],
  "paperMode": true,
  "paperStats": {
    "totalTrades": 5,
    "wins": 3,
    "losses": 2,
    "pending": 0,
    "winRate": 0.6,
    "totalPnl": 1.45
  }
}
```

## Web Dashboard

### Features

- **Header**: Mode badge (PAPER/LIVE), wallet status
- **Paper Stats Cards**: Trades, Win Rate, Wins, Losses, P&L
- **Cumulative P&L Chart**: Area chart showing profit over time
- **Market Breakdown Chart**: Stacked bar chart by market
- **Market Cards**: Real-time price, prediction, 8 indicators, trade decision
- **Trade Table**: Recent trades with PAPER indicator
- **Strategy Config Panel**: Current thresholds and risk parameters

### Tech Stack

- [Astro](https://astro.build/) v5 — Static site generator with React islands
- [React](https://react.dev/) v19 — UI components
- [shadcn/ui](https://ui.shadcn.com/) — Component library (new-york style)
- [recharts](https://recharts.org/) — Chart visualization
- [Tailwind CSS](https://tailwindcss.com/) v4 — Styling

## Project Structure

```
├── src/                      # Bot source code
│   ├── index.ts              # Main loop, processMarket()
│   ├── trader.ts             # executeTrade(), paper mode
│   ├── paperStats.ts         # Paper trade tracking
│   ├── api.ts                # Hono API server
│   ├── state.ts              # Shared state management
│   ├── config.ts             # Configuration loader
│   ├── types.ts              # TypeScript interfaces
│   ├── markets.ts            # Market definitions
│   ├── orderManager.ts       # Order lifecycle management
│   ├── redeemer.ts           # On-chain redemption
│   ├── utils.ts              # Helper functions
│   ├── data/                 # Data sources
│   │   ├── binance.ts        # REST API
│   │   ├── binanceWs.ts      # WebSocket
│   │   ├── polymarket.ts     # Gamma + CLOB API
│   │   ├── polymarketLiveWs.ts
│   │   ├── chainlink.ts      # On-chain RPC
│   │   └── chainlinkWs.ts
│   ├── engines/              # Trading logic
│   │   ├── probability.ts    # Scoring + blending
│   │   ├── edge.ts           # Edge + decision
│   │   └── regime.ts         # Market regime detection
│   └── indicators/           # TA indicators
│       ├── rsi.ts
│       ├── macd.ts
│       ├── vwap.ts
│       └── heikenAshi.ts
├── web/                      # Frontend
│   ├── src/
│   │   ├── pages/index.astro
│   │   └── components/
│   │       ├── Dashboard.tsx
│   │       ├── Header.tsx
│   │       ├── MarketCard.tsx
│   │       ├── TradeTable.tsx
│   │       └── PaperStatsChart.tsx
│   ├── astro.config.mjs
│   ├── Dockerfile
│   └── package.json
├── logs/                     # Runtime data
│   ├── trades-*.csv
│   ├── signals-*.csv
│   ├── daily-state.json
│   └── paper-stats.json
├── config.json               # Strategy parameters
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Docker Services

```yaml
services:
  bot:
    build: .
    ports: ["9999:9999"]
    volumes:
      - ./logs:/app/logs
      - ./config.json:/app/config.json:ro
    environment:
      - PAPER_MODE=${PAPER_MODE:-true}

  web:
    build: ./web
    ports: ["4321:4321"]
    volumes:
      - ./web/src:/app/src      # Hot reload
    environment:
      - API_URL=http://bot:9999
    depends_on: [bot]
```

## Development

### Type Check

```bash
bun run typecheck
```

### Build Web

```bash
cd web && bun run build
```

### Rebuild Docker

```bash
docker compose down
docker compose up --build
```

## Safety

- Paper trading is enabled by default (`PAPER_MODE=true`)
- Live trading requires explicit `PAPER_MODE=false` + wallet configuration
- Daily loss limit prevents runaway losses
- Maximum open positions limit prevents over-exposure

## Disclaimer

This is not financial advice. Trading involves significant risk. Use at your own risk.

---

