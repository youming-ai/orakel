# Auto-Redeem Feature

## Overview

The auto-redeem feature automatically redeems settled trading positions on Polymarket, eliminating the need to manually claim winnings.

## How It Works

1. **Periodic Checking**: The bot checks for redeemable positions at a configured interval (default: 30 minutes)
2. **Automatic Redemption**: When redeemable positions are found, the bot automatically submits redemption transactions to the blockchain
3. **Transaction Monitoring**: Each redemption transaction is monitored until confirmation (~60 seconds per transaction)
4. **Logging**: All redemption attempts are logged with success/failure status and total value redeemed

## Configuration

Add the following environment variables to your `.env` file:

```bash
# Enable auto-redeem (requires PRIVATE_KEY to be set)
AUTO_REDEEM_ENABLED=true

# Check interval in milliseconds (optional, default: 1800000 = 30 minutes)
AUTO_REDEEM_INTERVAL_MS=1800000
```

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AUTO_REDEEM_ENABLED` | boolean | `false` | Enable/disable auto-redeem |
| `AUTO_REDEEM_INTERVAL_MS` | number | `1800000` | Check interval in milliseconds (min: 60000) |

## Usage

### 1. Enable Auto-Redeem

```bash
# In your .env file
AUTO_REDEEM_ENABLED=true
PRIVATE_KEY=your_64_char_hex_private_key
```

### 2. Start the Bot

```bash
bun run start
```

You should see log messages like:

```
[bot] Auto-connected wallet: 0x...
[bot] Auto-redeem enabled: checking every 30 minutes
```

### 3. Monitor Logs

When redeemable positions are found:

```
[bot] Auto-redeem: found 2 position(s) worth $10.00, redeeming...
[bot] Auto-redeem success: 2/2 redeemed, total value: $10.00
```

If no positions are redeemable:

```
[bot] Auto-redeem: no redeemable positions found
```

## Startup Check

On bot startup, a one-time check is performed after 5 seconds to redeem any pending positions:

```
[bot] Startup auto-redeem check: 1 position(s) worth $5.00
```

## Manual Redemption

Auto-redeem runs alongside manual redemption options:

- **API**: `POST /api/live/redeem`
- **Script**: `bun run scripts/redeem.ts`

Both methods work independently and can be used even when auto-redeem is enabled.

## Transaction Details

- **Gas Settings**:
  - maxPriorityFeePerGas: 30 gwei
  - maxFeePerGas: 200 gwei

- **Confirmation Timeout**: 60 seconds per transaction

- **Retry Logic**: Failed redemptions are logged but don't prevent future attempts

## Monitoring

### Check Current Status

```bash
# Check redeemable positions
curl http://localhost:9999/api/live/redeemable

# View bot logs
tail -f data/bot.log | grep auto-redeem
```

### Log Examples

**Success**:
```
[bot] Auto-redeem: found 3 position(s) worth $15.00, redeeming...
[bot] Auto-redeem success: 3/3 redeemed, total value: $15.00
```

**Partial Failure**:
```
[bot] Auto-redeem: found 2 position(s) worth $10.00, redeeming...
[bot] Redeem failed for 0x1234...: insufficient_gas
[bot] Auto-redeem success: 1/2 redeemed, total value: $5.00
```

**No Positions**:
```
[bot] Auto-redeem: no redeemable positions found
```

## Safety Features

1. **Wallet Check**: Verifies wallet is connected before attempting redemption
2. **Deduplication**: Tracks redeemed positions to prevent duplicate transactions
3. **Error Handling**: Failed redemptions are logged but don't crash the bot
4. **Graceful Shutdown**: Timer is properly closed on bot shutdown

## Troubleshooting

### Auto-redeem not running

**Check**:
- `AUTO_REDEEM_ENABLED=true` is set in `.env`
- `PRIVATE_KEY` is configured and valid
- Bot is running and wallet is connected

**Solution**:
```bash
# Verify environment variables
grep AUTO_REDEEM .env
grep PRIVATE_KEY .env

# Check logs for connection errors
tail -f data/bot.log | grep -i wallet
```

### Positions not being redeemed

**Check**:
- Positions are actually settled and redeemable
- Sufficient gas funds in wallet
- Network connectivity to Polygon RPC

**Solution**:
```bash
# Manual redemption test
curl -X POST http://localhost:9999/api/live/redeem

# Check redeemable positions
curl http://localhost:9999/api/live/redeemable
```

### Transaction failures

**Common causes**:
- Insufficient gas fees
- Network congestion
- RPC endpoint issues

**Solution**:
- Ensure wallet has MATIC for gas
- Check Polygon network status
- Try manual redemption to diagnose specific errors

## Configuration Examples

### Development (Frequent Checks)

```bash
AUTO_REDEEM_ENABLED=true
AUTO_REDEEM_INTERVAL_MS=300000  # 5 minutes
```

### Production (Standard)

```bash
AUTO_REDEEM_ENABLED=true
AUTO_REDEEM_INTERVAL_MS=1800000  # 30 minutes
```

### Conservative (Less Frequent)

```bash
AUTO_REDEEM_ENABLED=true
AUTO_REDEEM_INTERVAL_MS=3600000  # 1 hour
```

## Best Practices

1. **Start Small**: Test with a short interval (5 minutes) initially, then increase
2. **Monitor Gas**: Ensure wallet has sufficient MATIC for gas fees
3. **Check Logs**: Review logs regularly to ensure redemptions are succeeding
4. **Manual Backup**: Keep manual redemption as a backup option
5. **Network Status**: Monitor Polygon network status during high congestion

## Related Files

- Implementation: [`src/index.ts`](../src/index.ts)
- Redeem Logic: [`src/blockchain/redeemer.ts`](../src/blockchain/redeemer.ts)
- Environment Config: [`src/core/env.ts`](../src/core/env.ts)
- API Endpoints: [`src/api.ts`](../src/api.ts)
