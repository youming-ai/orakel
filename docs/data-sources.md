# 数据源

本文档描述 Orakel 集成的所有外部数据源，涵盖 REST API、WebSocket 流、数据结构、连接管理与缓存策略。

---

## 1. 概览

系统依赖三个外部数据源，每个数据源均有 REST 模块与 WebSocket 模块，位于 `src/data/`：

| 数据源 | 用途 | 模块 |
|--------|------|------|
| Binance | 现货价格 + 历史 K 线（技术分析） | `binance.ts` / `binanceWs.ts` |
| Polymarket | 市场发现 + 定价 + 订单簿（交易执行） | `polymarket.ts` / `polymarketLiveWs.ts` / `polymarketClobWs.ts` |
| Chainlink | 链上预言机价格（概率计算参考） | `chainlink.ts` / `chainlinkWs.ts` |

---

## 2. Binance

### 2.1 REST API（`src/data/binance.ts`）

**基础 URL**：`CONFIG.binanceBaseUrl`（默认：`https://api.binance.com`）

**认证**：无（公开 API）

**超时**：8 秒

**交易对**：`BTCUSDT`、`ETHUSDT`、`SOLUSDT`、`XRPUSDT`

#### 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v3/klines` | 1 分钟 K 线，每次请求 240 根 |
| GET | `/api/v3/ticker/price` | 当前现货价格 |

#### 缓存

K 线数据 TTL 为 60 秒，每分钟最多更新一次。

#### 数据结构 — Candle

```
{
  openTime:  number     // 开盘时间（毫秒）
  open:      number | null
  high:      number | null
  low:       number | null
  close:     number | null
  volume:    number | null
  closeTime: number
}
```

### 2.2 WebSocket（`src/data/binanceWs.ts`）

**URL**：
- 单品种：`wss://stream.binance.com:9443/ws/{symbol}@trade`
- 多品种：`wss://stream.binance.com:9443/stream?streams=...`

#### 函数

| 函数 | 说明 |
|------|------|
| `startBinanceTradeStream(symbol, onUpdate)` | 订阅单个品种的逐笔成交流 |
| `startMultiBinanceTradeStream(symbols)` | 订阅多品种合并流 |

#### 数据结构 — PriceTick

```
{
  price:   number | null
  ts:      number | null
  source?: string
}
```

#### 消息格式

```json
{ "p": "68034.50", "s": "BTCUSDT" }
```

#### 连接管理

- 断线重连：指数退避，初始 500ms，最大 10s
- 内存中维护 `lastPrice` 与 `lastTs`
- 连接关闭或出错时自动重连

**用途**：为边缘计算提供实时现货价格。

---

## 3. Polymarket

### 3.1 Gamma API（`src/data/polymarket.ts`）

**基础 URL**：`CONFIG.gammaBaseUrl`（默认：`https://gamma-api.polymarket.com`）

**超时**：5 秒

**缓存**：元数据 TTL 30 秒

#### 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/markets?slug={slug}` | 按 slug 查询市场（30s 缓存） |
| GET | `/markets?seriesSlug={slug}&active=true&closed=false&limit=50` | 查询系列下所有活跃市场 |
| GET | `/events?series_id={id}&active=true&closed=false&limit=20` | 查询活跃事件 |

#### 关键函数

| 函数 | 说明 |
|------|------|
| `pickLatestLiveMarket()` | 按开始/结束时间筛选当前活跃的 15 分钟窗口 |
| `filterBtcUpDown15mMarkets()` | 按 slug 前缀或 seriesSlug 匹配市场 |
| `parseGammaMarket()` | Zod schema 验证 |

#### 数据结构 — GammaMarket

```
{
  slug:          string
  question?:     string
  endDate:       string
  outcomes:      string[]     // ["Up", "Down"]
  outcomePrices: number[]     // [0.66, 0.34]
  clobTokenIds:  string[]     // UP/DOWN 对应的 token ID
  bestBid?:      number
  bestAsk?:      number
  bestSpread?:   number
  seriesSlug?:   string
}
```

### 3.2 CLOB API（`src/data/polymarket.ts`）

**基础 URL**：`CONFIG.clobBaseUrl`（默认：`https://clob.polymarket.com`）

**缓存**：价格与订单簿 TTL 均为 3 秒

#### 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/price?token_id={id}&side={side}` | 当前价格（3s 缓存） |
| GET | `/book?token_id={id}` | 完整订单簿（3s 缓存） |

#### 数据结构 — OrderBookSummary

```
{
  bestBid:      number | null
  bestAsk:      number | null
  spread:       number | null
  bidLiquidity: number | null  // 买盘前 5 档总量
  askLiquidity: number | null  // 卖盘前 5 档总量
}
```

### 3.3 Chainlink 价格 WebSocket（`src/data/polymarketLiveWs.ts`）

**URL**：`wss://ws-live-data.polymarket.com`（可配置）

#### 订阅消息

```json
{
  "action": "subscribe",
  "subscriptions": [{ "topic": "crypto_prices_chainlink", "type": "*" }]
}
```

#### 函数

| 函数 | 说明 |
|------|------|
| `startPolymarketChainlinkPriceStream(wsUrl, symbolIncludes, onUpdate)` | 订阅单品种 Chainlink 价格流 |
| `startMultiPolymarketPriceStream(symbols, wsUrl)` | 订阅多品种价格流 |

#### 消息格式

```json
{
  "topic": "crypto_prices_chainlink",
  "payload": {
    "symbol":    "BTC",
    "pair":      "BTC/USD",
    "value":     68034.50,
    "timestamp": "...",
    "updatedAt": "..."
  }
}
```

#### 连接管理

- 指数退避：初始 500ms，最大 10s
- 握手超时：10 秒

### 3.4 CLOB 市场事件 WebSocket（`src/data/polymarketClobWs.ts`）

**URL**：`wss://ws-subscriptions-clob.polymarket.com/ws/market`

#### 订阅消息

```json
{
  "type":                   "market",
  "assets_ids":             ["0x123..."],
  "custom_feature_enabled": true
}
```

#### 事件类型

| 事件 | 说明 |
|------|------|
| `best_bid_ask` | 实时买卖盘更新 |
| `tick_size_change` | 最小价格增量变化 |
| `market_resolved` | 市场结算（含胜方 asset ID） |
| `last_trade_price` | 最近成交价 |
| `book` | 完整订单簿快照 |
| `price_change` | 价格变动 |

#### 函数

| 函数 | 说明 |
|------|------|
| `subscribe()` | 订阅 token ID 列表 |
| `unsubscribe()` | 取消订阅 |
| `getBestBidAsk()` | 获取当前最优买卖价 |
| `getTickSize()` | 获取最小价格增量 |
| `isResolved()` | 查询市场是否已结算 |
| `getWinningAssetId()` | 获取胜方 asset ID |
| `close()` | 关闭连接 |

**动态订阅**：支持运行时增减 token ID。

**状态缓存**：使用 Map 缓存买卖价、tick size 及已结算市场。

**用途**：实时订单簿失衡评分 + 市场结算检测。

---

## 4. Chainlink

### 4.1 链上 RPC（`src/data/chainlink.ts`）

#### 合约调用

| 方法 | 说明 |
|------|------|
| `latestRoundData()` | 获取最新价格轮次（answer、updatedAt） |
| `decimals()` | 获取价格精度（按聚合器缓存） |

#### RPC 端点（故障转移链）

- 主节点：`CONFIG.chainlink.polygonRpcUrl`
- 备用节点：`CONFIG.chainlink.polygonRpcUrls`
- 默认节点：`polygon-rpc.com`、`rpc.ankr.com/polygon`、`polygon.llamarpc.com`

#### 函数

| 函数 | 说明 |
|------|------|
| `fetchChainlinkPrice(aggregator, decimals)` | 从合约读取价格 |
| `fetchChainlinkBtcUsd()` | BTC/USD 价格快捷方法 |

#### 缓存与超时

- 每个聚合器最小抓取间隔：2 秒
- 精度（decimals）永久缓存（按聚合器）
- 每次 RPC 调用超时：1.5 秒
- RPC 故障转移：按顺序尝试，记住上次可用节点

#### 聚合器地址（Polygon 主网）

| 市场 | 合约地址 |
|------|----------|
| BTC/USD | `0xc907E116054Ad103354f2D350FD2514433D57F6f` |
| ETH/USD | `0xF9680D99D6C9589e2a93a78A04A279e509205945` |
| SOL/USD | `0x10C8264C0935b3B9870013e4003f3875af17dE23` |
| XRP/USD | `0x785ba89291f676b5386652eB12b30cF361020694` |

#### 精度换算

```
price = answer / 10^decimals
```

所有聚合器精度均为 8 位。

### 4.2 事件订阅 WebSocket（`src/data/chainlinkWs.ts`）

**WSS 端点**：`CONFIG.chainlink.polygonWssUrl`（支持备用列表）

#### 订阅方式

使用 `eth_subscribe` 订阅日志过滤器，监听 `AnswerUpdated` 事件。

- Topic[0]：`0x0559884fd3a460f71df1384d438bdf1a5ceef8bd81c4d9c4f0a40c5d4b1f0f0a`

#### 事件解析

| 字段 | 来源 | 说明 |
|------|------|------|
| 价格 answer | Topic[1] | 有符号整数（hex → BigInt） |
| 时间戳 | Data | hex 解码 |
| 最终价格 | 换算 | `answer / 10^decimals` |

#### 连接管理

- RPC 故障转移：跨 WSS URL 列表
- 指数退避：初始 500ms，最大 10s

---

## 5. 数据流集成

### 5.1 初始化（`src/index.ts`）

启动时初始化所有 WebSocket 流：

```
binanceStream    = startMultiBinanceTradeStream(symbols)
polymarketStream = startMultiPolymarketPriceStream(symbols)
chainlinkStream  = startChainlinkPriceStream(aggregator, decimals)
clobStream       = startClobMarketWs({ initialTokenIds })
```

### 5.2 每秒处理循环

**REST 数据拉取**（受各自缓存 TTL 控制）：

1. `fetchKlines` — Binance K 线（60s 缓存）
2. `fetchLastPrice` — Binance 现货价格
3. `fetchMarketBySlug` — Polymarket 市场元数据（30s 缓存）
4. `fetchClobPrice` — CLOB 当前价格（3s 缓存）
5. `fetchOrderBook` — CLOB 订单簿（3s 缓存）
6. `fetchChainlinkPrice` — 链上价格（2s 最小间隔）

**WebSocket 数据读取**（内存中最新值）：

1. `binanceStream.getLast()` — Binance 实时价格
2. `polymarketStream.getLast()` — Polymarket Chainlink 价格
3. `chainlinkStream.getLast()` — Chainlink 链上价格
4. `clobStream.getBestBidAsk()` — CLOB 最优买卖价

**数据流向**：技术指标 → 概率引擎 → 市场状态 → 边缘计算 → 交易决策

---

## 6. 缓存策略

| 数据 | TTL | 来源 |
|------|-----|------|
| Binance K 线 | 60s | REST |
| Polymarket 市场元数据 | 30s | Gamma API |
| Polymarket 价格 | 3s | CLOB API |
| Polymarket 订单簿 | 3s | CLOB API |
| Chainlink 价格 | 2s（最小间隔） | RPC |
| Chainlink 精度 | 永久 | RPC（按聚合器） |

---

## 7. 错误处理与韧性

| 层级 | 策略 |
|------|------|
| REST | 超时（5–8s），出错时回退缓存值 |
| WebSocket | 自动重连，指数退避（500ms → 10s） |
| RPC 故障转移 | 依次尝试主节点 → 备用列表 → 默认节点，记住上次可用节点 |
| 数据源隔离 | 单个数据源失败不阻塞其他数据源 |

---

## 8. 认证与限流

| 数据源 | 认证 | 限流 |
|--------|------|------|
| Binance REST | 无 | 1200 req/min |
| Binance WS | 无 | 无限制 |
| Polymarket Gamma | 无 | 隐式（5s 超时） |
| Polymarket CLOB | 无 | 隐式（3s 缓存） |
| Polymarket WS | 无 | 订阅制 |
| Chainlink RPC | 无 | 提供商依赖（1.5s 超时） |
| Chainlink WS | 无 | 事件驱动 |
