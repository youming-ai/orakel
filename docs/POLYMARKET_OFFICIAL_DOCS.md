# Polymarket 官方文档学习笔记

> 来源: https://docs.polymarket.com/
> 抓取时间: 2026-02-23

---

## 📚 文档索引

完整索引: https://docs.polymarket.com/llms.txt

---

## 1. 价格与订单簿 (Prices & Orderbook)

### 价格即概率
- 每股价格在 `$0.00` 到 `$1.00` 之间
- 价格直接代表市场对结果的概率预期

### 订单簿结构
| Side | Description |
|------|-------------|
| Bids | 买单 - 交易者愿意支付的最高价格 |
| Asks | 卖单 - 交易者愿意接受的最低价格 |

**Spread** = 最高 bid 和最低 ask 之间的差距

### 显示价格
- 如果 spread < $0.10，显示 **midpoint** = (best_bid + best_ask) / 2
- 如果 spread >= $0.10，显示 **last traded price**

### 订单类型
| Type | Behavior | Use Case |
|------|----------|----------|
| GTC | Good-Til-Cancelled | 默认限价单 |
| GTD | Good-Til-Date | 在指定时间自动过期 |
| FOK | Fill-Or-Kill | 全部成交或取消 |
| FAK | Fill-And-Kill | 立即成交可成交部分，取消剩余 |

### 价格发现
- 新市场没有初始价格
- 当 `Yes价格 + No价格 = $1.00` 时订单匹配
- 匹配时，$1.00 转换为 1 Yes token + 1 No token

---

## 2. Negative Risk Markets（多结果市场）

### 概念
- 用于 **多结果事件**（3+ 结果），只有一个结果会赢
- **资本效率**：No(A) 可以转换为 Yes(所有其他结果)

### 转换示例
```
事件: "谁会赢得2024总统大选？"

你的持仓:
- Trump: —
- Harris: —
- Other: 1 No

转换后:
- Trump: 1 Yes
- Harris: 1 Yes
- Other: —
```

### 识别 Neg Risk 市场
```json
{
  "id": "123",
  "title": "Who will win the 2024 Presidential Election?",
  "negRisk": true,
  "markets": [...]
}
```

### 下单时需要指定
```typescript
const response = await client.createAndPostOrder(
  { tokenID, price: 0.5, size: 100, side: Side.BUY },
  { tickSize: "0.01", negRisk: true }  // Required for neg risk markets
);
```

### Augmented Negative Risk
- 支持动态添加新结果
- 字段: `enableNegRisk: true` + `negRiskAugmented: true`
- 有 placeholder outcomes 和 "Other" outcome

---

## 3. 费用结构 (Fees) ⚠️ 对套利至关重要

### 有费用的市场
- **15分钟加密市场**
- **5分钟加密市场**
- **NCAAB (大学篮球)** - 从 2026年2月18日开始
- **Serie A** - 从 2026年2月18日开始

### 费用公式
```
fee = C × feeRate × (p × (1 - p))^exponent
```
- C = 交易股数
- p = 股票价格
- **15分钟/5分钟加密**: feeRate = 0.25, exponent = 2
- **体育**: feeRate = 0.0175, exponent = 1

### 费用表 (15分钟加密)
| 价格 | 交易额 | 费用 | 有效费率 |
|------|--------|------|----------|
| $0.50 | $50 | $0.78 | **1.56%** (最高) |
| $0.40/$0.60 | $40/$60 | $0.58/$0.86 | 1.44% |
| $0.30/$0.70 | $30/$70 | $0.33/$0.77 | 1.10% |
| $0.20/$0.80 | $20/$80 | $0.13/$0.51 | 0.64% |
| $0.10/$0.90 | $10/$90 | $0.02/$0.18 | 0.20% |
| $0.05/$0.95 | $5/$95 | $0.003/$0.05 | 0.06% |

**关键洞察**: 50% 概率时费用最高，两边极端时费用趋近于 0

### Maker Rebate
- 15分钟市场: 20% 的费用返还给 maker
- 体育市场: 25% 的费用返还给 maker

---

## 4. 订单簿 API

### 获取订单簿
```typescript
const book = await client.getOrderBook("TOKEN_ID");
// Response:
{
  "market": "0xbd31dc8a...",
  "asset_id": "52114319501245...",
  "bids": [{ "price": "0.48", "size": "1000" }],
  "asks": [{ "price": "0.52", "size": "800" }],
  "tick_size": "0.01",
  "min_order_size": "5",
  "neg_risk": false,
  "hash": "0xabc123..."
}
```

### 批量请求（最多 500 个 token）
| Single | Batch |
|--------|-------|
| `getOrderBook()` | `getOrderBooks()` |
| `getPrice()` | `getPrices()` |
| `getMidpoint()` | `getMidpoints()` |
| `getSpread()` | `getSpreads()` |

### 估算成交价格
```typescript
const price = await client.calculateMarketPrice(
  "TOKEN_ID",
  Side.BUY,
  500, // dollar amount
  OrderType.FOK
);
```

---

## 5. WebSocket 实时数据

### 连接
```typescript
const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "market",
    assets_ids: ["TOKEN_ID"],
    custom_feature_enabled: true, // 启用 best_bid_ask, new_market, market_resolved
  }));
};
```

### 事件类型
| Event | Trigger | Key Fields |
|-------|---------|------------|
| `book` | 订阅时 + 交易影响订单簿 | `bids[]`, `asks[]`, `hash` |
| `price_change` | 新订单或取消订单 | `price_changes[]` |
| `last_trade_price` | 交易执行 | `price`, `side`, `size`, `fee_rate_bps` |
| `tick_size_change` | 价格触及 >0.96 或 <0.04 | `old_tick_size`, `new_tick_size` |
| `best_bid_ask` | Top-of-book 变化 | `best_bid`, `best_ask`, `spread` |
| `market_resolved` | 市场结算 | `winning_asset_id` |

### 动态订阅/取消订阅
```typescript
ws.send(JSON.stringify({
  assets_ids: ["NEW_TOKEN_ID"],
  operation: "subscribe", // or "unsubscribe"
}));
```

---

## 6. 代币与仓位 (Positions & Tokens)

### Outcome Tokens
- 每个市场有两个 outcome token: **Yes** 和 **No**
- ERC1155 资产在 Polygon 上
- **完全抵押**: 每个 Yes/No 对由 $1 USDC.e 支持

### 操作
| 操作 | 描述 |
|------|------|
| **Split** | $1 USDC.e → 1 Yes + 1 No |
| **Merge** | 1 Yes + 1 No → $1 USDC.e |
| **Trade** | 在订单簿上买卖 |
| **Redeem** | 市场结算后，赢家用 $1/token 兑换 USDC.e |

### 持仓奖励
- **4.00% 年化** 持仓奖励
- 每小时随机采样持仓价值
- 每日分配

---

## 7. 下单 (Create Order)

### 限价单
```typescript
const response = await client.createAndPostOrder(
  {
    tokenID: "TOKEN_ID",
    price: 0.5,
    size: 10,
    side: Side.BUY,
  },
  {
    tickSize: "0.01",
    negRisk: false,
  },
  OrderType.GTC
);
```

### 市价单
```typescript
// FOK BUY: 花费 $100 或全部取消
const buyOrder = await client.createMarketOrder(
  {
    tokenID: "TOKEN_ID",
    side: Side.BUY,
    amount: 100, // dollar amount
    price: 0.5, // worst-price limit (slippage protection)
  },
  { tickSize: "0.01", negRisk: false }
);
await client.postOrder(buyOrder, OrderType.FOK);
```

### GTD 订单（自动过期）
```typescript
// 1小时后过期 (+ 60s 安全阈值)
const expiration = Math.floor(Date.now() / 1000) + 60 + 3600;
```

### Post-Only 订单
```typescript
const response = await client.postOrder(signedOrder, OrderType.GTC, true);
// 如果会立即成交则被拒绝，保证总是 maker
```

### 批量订单（最多 15 个）
```typescript
const response = await client.postOrders([
  { order: signedOrder1, orderType: OrderType.GTC },
  { order: signedOrder2, orderType: OrderType.GTC },
]);
```

### Tick Sizes
| Tick Size | Precision | Example |
|-----------|-----------|---------|
| `0.1` | 1 decimal | 0.1, 0.2, 0.5 |
| `0.01` | 2 decimals | 0.01, 0.50, 0.99 |
| `0.001` | 3 decimals | 0.001, 0.500 |
| `0.0001` | 4 decimals | 0.0001, 0.5000 |

---

## 8. Heartbeat（心跳）

- 如果 **10 秒** 内没有收到有效心跳（有 5 秒缓冲），**所有未完成订单被取消**
- 每 5 秒发送一次心跳

```typescript
let heartbeatId = "";
setInterval(async () => {
  const resp = await client.postHeartbeat(heartbeatId);
  heartbeatId = resp.heartbeat_id;
}, 5000);
```

---

## 9. 赎回 (Redeem)

- 市场结算后，赢家代币可兑换 $1 USDC.e
- 无截止时间，随时可赎回
- 输家代币价值为 $0

---

## 💡 套利策略要点

### 1. Spread 套利
- 当 `marketYes + marketNo < 0.98` 时存在套利机会
- 同时买入 Yes 和 No，成本 < $1，合并后得到 $1

### 2. 费用影响
- 15分钟市场在 50% 概率时费用最高 (1.56%)
- 套利利润需要 > 费用
- 极端价格时费用很低，更适合套利

### 3. Negative Risk 套利
- 多结果市场中，No(A) 可转换为 Yes(所有其他)
- 如果 No(A) 价格 + Yes(A) 价格 < $1，存在套利

### 4. Split/Merge 套利
- 如果 Yes价格 + No价格 < $1：
  - Split $1 → 1 Yes + 1 No
  - 卖出两者获得 > $1
- 如果 Yes价格 + No价格 > $1：
  - 买入两者花费 < $1
  - Merge 得到 $1

### 5. Maker vs Taker
- 作为 Maker 可以获得 20% 费用返还
- 尽量使用 post-only 订单
- 避免市价单（支付全额 taker 费用）

### 6. Tick Size 监控
- WebSocket 的 `tick_size_change` 事件很重要
- 如果 tick size 变化，旧价格的订单会被拒绝

---

## 📎 有用的 API 端点

```
# 获取订单簿
GET https://clob.polymarket.com/book?token_id={token_id}

# 获取价格
GET https://clob.polymarket.com/price?token_id={token_id}&side=BUY

# 获取费用率
GET https://clob.polymarket.com/fee-rate?token_id={token_id}

# 获取 tick size
GET https://clob.polymarket.com/tick-size?token_id={token_id}

# WebSocket
wss://ws-subscriptions-clob.polymarket.com/ws/market
```

---

## 🔗 相关链接

- [官方文档](https://docs.polymarket.com/)
- [TypeScript SDK](https://github.com/Polymarket/clob-client)
- [Python SDK](https://github.com/Polymarket/py-clob-client)
- [Rust SDK](https://github.com/Polymarket/rs-clob-client)
- [Contract Addresses](https://docs.polymarket.com/resources/contract-addresses)
- [Builder Program](https://builders.polymarket.com)
