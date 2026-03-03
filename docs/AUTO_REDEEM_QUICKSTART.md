# Auto-Redeem Quick Start

## Enable in 2 Steps

### 1. Update `.env` file

```bash
# Enable auto-redeem
AUTO_REDEEM_ENABLED=true

# Optional: customize check interval (default: 30 minutes)
# AUTO_REDEEM_INTERVAL_MS=1800000
```

### 2. Restart the bot

```bash
bun run start
```

That's it! The bot will now automatically redeem settled positions.

## What to Expect

**On startup** (after 5 seconds):
```
[bot] Auto-connected wallet: 0x...
[bot] Auto-redeem enabled: checking every 30 minutes
[bot] Startup auto-redeem check: 2 position(s) worth $10.00
```

**During normal operation** (every 30 minutes):
```
[bot] Auto-redeem: found 1 position(s) worth $5.00, redeeming...
[bot] Auto-redeem success: 1/1 redeemed, total value: $5.00
```

**When no positions are redeemable**:
```
[bot] Auto-redeem: no redeemable positions found
```

## Requirements

- `PRIVATE_KEY` must be set in `.env`
- Wallet must have MATIC for gas fees
- Bot must be running

## Check Status

```bash
# View redeemable positions
curl http://localhost:9999/api/live/redeemable

# Manual redemption (still works!)
curl -X POST http://localhost:9999/api/live/redeem
```

## Disable

```bash
# In .env file
AUTO_REDEEM_ENABLED=false
```

Then restart the bot.

## Full Documentation

See [AUTO_REDEEM.md](./AUTO_REDEEM.md) for detailed information.
