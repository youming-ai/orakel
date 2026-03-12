# Integration Testing: BTC 5-Min Bot vs Live Polymarket

Step-by-step checklist for testing the bot against live Polymarket BTC 5-minute up/down markets.

## Prerequisites

### 1. PostgreSQL

```bash
# Local (Docker Compose)
docker compose -f packages/bot/docker-compose.yml up -d postgres

# Verify connection
psql $DATABASE_URL -c "SELECT 1"

# Apply migrations (creates trades_v2, signals_v2, balance_snapshots_v2)
bunx drizzle-kit migrate
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Value |
|----------|----------|-------|
| `PAPER_MODE` | Yes | `true` for paper-only, `false` for live |
| `DATABASE_URL` | Yes | `postgresql://user:pass@localhost:5432/orakel` |
| `API_TOKEN` | Yes | Any string for API auth |
| `POLYMARKET_PRIVATE_KEY` | Live only | `0x...` hex private key with USDC balance |
| `PORT` | No | Default `9999` |
| `LOG_LEVEL` | No | Use `debug` for integration testing |

### 3. config.json

Must conform to `AppConfigSchema`. Key fields to verify:

```jsonc
{
  "infra": {
    "chainlinkHttpUrl": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",  // ← real Alchemy/Infura key
    "chainlinkAggregator": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",  // BTC/USD feed (mainnet)
    "chainlinkDecimals": 8,
    "polymarketGammaUrl": "https://gamma-api.polymarket.com",
    "polymarketClobUrl": "https://clob.polymarket.com",
    "polymarketClobWsUrl": "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    "slugPrefix": "btc-updown-5m",    // Must match actual Polymarket URL pattern
    "windowSeconds": 300,              // 5 minutes
    "pollIntervalMs": 3000             // Chainlink poll interval
  }
}
```

**Critical**: `chainlinkHttpUrl` must be a real Ethereum mainnet RPC endpoint (Alchemy, Infura, etc.) with your API key.

### 4. Polymarket CLI (live trading only)

```bash
# Install (macOS)
curl -sSL -o /usr/local/bin/polymarket \
  "https://github.com/Polymarket/polymarket-cli/releases/download/v0.1.5/polymarket-darwin-amd64"
chmod +x /usr/local/bin/polymarket

# Verify
polymarket --version

# Configure (first time — sets up wallet)
polymarket setup
```

Not needed for paper mode. Docker image includes the CLI binary automatically.

---

## Phase 1: Smoke Test (Paper Mode)

### Start Bot

```bash
LOG_LEVEL=debug PAPER_MODE=true bun run start
```

### Verify Startup Sequence

Watch logs for these messages in order:

```
✓  {"module":"config","msg":"Config loaded"}
✓  {"module":"bootstrap","msg":"Database connected"}       — or will crash
✓  {"module":"chainlink","msg":"Chainlink adapter started (HTTP polling)"}
✓  {"module":"bootstrap","msg":"CLI check","available":...}
✓  {"module":"bootstrap","msg":"API server started","port":9999}
✓  {"module":"main-loop","msg":"Main loop started"}
```

### Verify External Connections

```bash
# 1. API is up
curl -s http://localhost:9999/api/status | jq .
# Expect: { "paperRunning": false, "liveRunning": false, "dbConnected": true, "cliAvailable": ..., "uptimeMs": ... }

# 2. Chainlink is fetching prices (wait ~5s after start)
# Look for price ticks in debug logs:
# {"module":"chainlink","msg":"..."} — no warnings = working

# 3. Config is valid
curl -s http://localhost:9999/api/config | jq .
# Expect: strategy, risk, execution sections
```

### Verify Market Discovery

Watch debug logs for window discovery. A new BTC 5-min window starts every 5 minutes:

```
✓  {"module":"main-loop","msg":"Discovered new window","slug":"btc-updown-5m-XXXXXXXXXX","priceToBeat":...}
```

If you see `"Market not found, will retry"`, check:
- `slugPrefix` matches actual Polymarket URL pattern
- Current time aligns with a 5-min window boundary
- Polymarket Gamma API is reachable: `curl "https://gamma-api.polymarket.com/markets?slug=btc-updown-5m-$(date +%s | awk '{print int($1/300)*300+300}')"` 

### Verify Order Book WebSocket

After window discovery, look for:

```
✓  {"module":"polymarket","msg":"CLOB WS connected","tokens":2}
```

Then verify midpoint prices appear (no `"Orderbook not ready"` after initial warmup):

```
# If you see continuous "Orderbook not ready" messages, check:
# - polymarketClobWsUrl is correct
# - Token IDs were extracted correctly from Gamma API
```

### Start Paper Trading

```bash
# Start paper mode
curl -s -X POST http://localhost:9999/api/control/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"mode":"paper"}'

# Expect: { "ok": true, "message": "paper trading start requested", "state": {...} }
```

### Verify Signal Generation

Watch for signal logs each tick (every `pollIntervalMs`):

```
{"module":"main-loop","msg":"..."} — decision: ENTER_UP / ENTER_DOWN / SKIP
```

And check DB persistence:

```bash
curl -s "http://localhost:9999/api/signals?limit=5" | jq '.[0]'
# Expect: { windowSlug, chainlinkPrice, priceToBeat, deviation, modelProbUp, marketProbUp, ... }
```

### Verify Paper Trades

When edge thresholds are met, look for:

```
✓  {"module":"paper-trader","msg":"Paper trade executed","window":"btc-updown-5m-...","side":"UP/DOWN","price":...,"size":...}
```

Check trades API:

```bash
curl -s "http://localhost:9999/api/trades?mode=paper&limit=5" | jq '.[0]'
# Expect: { mode: "paper", windowSlug, side, price, size, edge, outcome: null, ... }
```

### Verify Settlement

When a window ends and a new one starts, the previous window's trades should settle:

```
✓  Paper trade settled — side, won/lost, P&L
```

Check stats:

```bash
curl -s http://localhost:9999/api/stats | jq '.paper'
# Expect: { totalTrades: N, wins: N, pnl: N.NN }
```

### Verify Terminal Dashboard

The terminal should display a refreshing dashboard:

```
=== BTC 5-Min Bot ===
Window: btc-updown-5m-1773298200 | State: ACTIVE | Phase: MID
Time Left: 180s
Chainlink: $95432.12 | PtB: $95400.00 | Dev: 0.034%
Model P(Up): 52.1% | Market: 49.8%
Edge: 2.30%
Paper P&L: $0.00
=====================
```

### Verify WebSocket (Dashboard)

```bash
# Connect to WS
websocat ws://localhost:9999/ws
# Expect: state:snapshot messages every tick with currentWindow, paperStats, liveStats
```

---

## Phase 2: Live Trading Test (Small Size)

**Only proceed after Phase 1 is fully green.**

### Pre-Flight

1. Ensure wallet has USDC on Polygon: `polymarket clob balance --asset-type collateral`
2. Set conservative risk limits in config.json:
   ```json
   "risk": { "live": { "maxTradeSizeUsdc": 1, "dailyMaxLossUsdc": 5, "maxOpenPositions": 1, "maxTradesPerWindow": 1 } }
   ```
3. Verify CLI works: `polymarket --version`
4. Set `POLYMARKET_PRIVATE_KEY=0x...` in `.env`
5. Set `PAPER_MODE=false` (or leave `true` to run both modes simultaneously)

### Start Live Trading

```bash
curl -s -X POST http://localhost:9999/api/control/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"mode":"live"}'
```

### Verify Live Order Execution

Watch for:

```
✓  {"module":"live-trader","msg":"Live trade executed",...,"orderId":"0x..."}
```

Verify on Polymarket:

```bash
polymarket clob get-order --order-id <orderId> -o json
# Or check positions
polymarket positions -o json
```

### Verify Redemption

After a window settles, auto-redemption should trigger:

```
✓  {"module":"redeemer","msg":"Redemption executed"}
```

### Emergency Stop

```bash
# Stop live trading immediately
curl -s -X POST http://localhost:9999/api/control/stop \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"mode":"live"}'

# Cancel all open orders
polymarket clob cancel-all -o json
```

---

## Phase 3: Web Dashboard Test

### Start Dev Server

```bash
# Terminal 1: Bot
bun run dev:bot

# Terminal 2: Web
VITE_API_BASE=http://localhost:9999/api bun run dev:web
# Open http://localhost:5173
```

### Verify Dashboard

- [ ] Dashboard loads without errors
- [ ] Market card shows current BTC 5-min window
- [ ] Real-time price, model prob, market prob, edge updating
- [ ] Phase indicator (EARLY/MID/LATE) correct
- [ ] Paper start/stop toggle works
- [ ] Trade history table populates after trades
- [ ] Stats (win rate, P&L) update after settlement

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"Config is not valid JSON"` | config.json malformed or missing | Validate with `jq . config.json` |
| `"Invalid config: ..."` | config.json doesn't match AppConfigSchema | Check all required fields (strategy, risk, execution, infra, maintenance) |
| `"Invalid environment: ..."` | Missing env vars | Check DATABASE_URL, API_TOKEN are set |
| `"Market not found, will retry"` | Wrong slugPrefix or no active market | Verify slug pattern at polymarket.com, check timing |
| `"Stale price, skipping tick"` | Chainlink RPC slow or down | Check chainlinkHttpUrl, try different RPC |
| `"CLOB WS disconnected"` | WS connection dropped | Will auto-reconnect in 3s, check URL |
| `"Polymarket CLI not available"` | `polymarket` not in PATH | Install CLI or use Docker |
| `"HTTP price fetch failed"` | Bad RPC URL or rate limited | Check Alchemy/Infura key and plan limits |
| No trades after 5+ windows | Edge thresholds too high | Lower `edgeThresholdEarly` to 0.02 for testing |
| Dashboard blank | Wrong VITE_API_BASE or CORS | Set `VITE_API_BASE=http://localhost:9999/api` |

---

## Quick Validation Script

```bash
#!/bin/bash
# quick-check.sh — Run after bot starts
set -e
BASE=${API_BASE:-http://localhost:9999}
TOKEN=${API_TOKEN:-your-secret-token}

echo "=== Orakel Integration Check ==="

echo -n "API reachable... "
curl -sf "$BASE/api/status" > /dev/null && echo "OK" || echo "FAIL"

echo -n "DB connected... "
curl -sf "$BASE/api/status" | jq -e '.dbConnected == true' > /dev/null && echo "OK" || echo "FAIL"

echo -n "CLI available... "
curl -sf "$BASE/api/status" | jq -e '.cliAvailable' > /dev/null && echo "OK ($(curl -sf "$BASE/api/status" | jq -r '.cliAvailable'))" || echo "FAIL"

echo -n "Config valid... "
curl -sf "$BASE/api/config" | jq -e '.strategy' > /dev/null && echo "OK" || echo "FAIL"

echo -n "Trades endpoint... "
curl -sf "$BASE/api/trades?limit=1" > /dev/null && echo "OK" || echo "FAIL"

echo -n "Signals endpoint... "
curl -sf "$BASE/api/signals?limit=1" > /dev/null && echo "OK" || echo "FAIL"

echo -n "Stats endpoint... "
curl -sf "$BASE/api/stats" > /dev/null && echo "OK" || echo "FAIL"

echo "=== Done ==="
```
