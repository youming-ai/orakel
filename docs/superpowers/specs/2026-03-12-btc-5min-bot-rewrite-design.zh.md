# BTC 5分钟交易机器人重写设计

## 概述

将 `packages/bot` 彻底重写为一个专注于 BTC 5分钟涨跌交易的 Polymarket 机器人。该机器人监控 Chainlink BTC/USD 价格相对于每个窗口的 Price-to-Beat，将模型计算的真实概率与 Polymarket 的市场价格进行比较，当价差足够大时执行交易。交易执行通过官方 Polymarket CLI 以子进程方式完成。

**范围**：仅重写 `packages/bot`。`packages/shared` 会被重写以匹配新的 DTO 合约（除了 bot 和 web 之外没有其他独立使用者）。`packages/web` **不在本计划范围内** —— 它会有意中断（类型检查失败），直到后续计划更新它。单体仓库结构、工具链（Bun、Biome、Vitest、Drizzle）以及部署目标（Docker VPS 用于 bot、Cloudflare Workers 用于 web）保持不变。

## 目标市场

Polymarket 上的 **BTC 5分钟涨跌** 市场。

- **URL 格式**：`btc-updown-5m-{epoch_end_seconds}`（时间戳 = 窗口结束时间）
- **结算方式**：如果 Chainlink BTC/USD 价格在窗口结束时间 >= 窗口开始时间的价格，则结算为"涨"。否则结算为"跌"。使用 `>=` 规则，因此价格持平算作涨。
- **周期**：每天 288 个市场，连续运行，每 5 分钟一次。新市场在其窗口开始前约 5 分钟出现。
- **结算来源**：Polygon PoS 上的 Chainlink BTC/USD 价格源（聚合器合约 `0xc907E116054Ad103354f2D350FD2514433D57F6f`，8 位小数）。机器人通过 WebSocket 订阅 Polygon WSS RPC（主通道）和 HTTP RPC 轮询（备用通道）读取此数据。
- **市场发现**：机器人通过从当前时间计算 slug（`btc-updown-5m-{windowEndEpoch}`）并从 Gamma API 通过 `GET /markets?slug={slug}` 获取来发现当前活跃窗口。不需要 series ID —— 基于 slug 的查找是主要发现机制。`slugPrefix` 配置（`btc-updown-5m-`）仅在列出多个市场时使用（例如用于回测数据获取）。如果 slug 查找没有返回结果（市场尚未创建），机器人将在下一次 tick 重试。

## 数据源

仅使用两个外部数据源：

| 数据源 | 协议 | 用途 |
|--------|----------|---------|
| **Chainlink BTC/USD** | WebSocket (Polygon) + HTTP 备用 | 实时 BTC 价格、Price-to-Beat 参考、结算预言机 |
| **Polymarket** | CLOB WebSocket + Gamma REST API | 市场发现、订单簿（涨跌代币的买卖价）、市场结算状态 |

Binance、Bybit、Coinbase 和所有其他交易所数据适配器将被完全移除。

## 架构

### CLI 优先执行

机器人将所有 Polymarket 交互（订单下单、取消、余额查询、CTF 赎回）委托给官方 Polymarket CLI（`polymarket`）通过 JSON 输出的子进程调用。机器人自身的代码仅处理监控、决策制定和编排。

**为何选择 CLI 而非 SDK**：
- 移除了约 60% 的自定义交易代码（执行服务、钱包服务、订单管理器心跳、nonce 管理）
- CLI 内部处理签名、重试和错误恢复
- approve、redeem、split/merge 都是单个 CLI 命令，而不是多步 SDK + ethers 集成
- 约 50-100ms 的子进程延迟对于 5 分钟窗口来说可以忽略不计

**CLI 先决条件**：
- `polymarket` 二进制文件已安装并在 PATH 中
- 通过 `POLYMARKET_PRIVATE_KEY` 环境变量或 `~/.config/polymarket/config.json` 配置钱包
- 通过 `polymarket approve set` 预先批准 USDC.e

### 目录结构

```
packages/bot/src/
├── index.ts                # 入口：bootstrap -> 主循环
├── core/
│   ├── config.ts           # Zod 验证的 config.json + 热重载
│   ├── env.ts              # 环境变量（Zod 验证）
│   ├── logger.ts           # createLogger 工厂（保持原有模式）
│   ├── state.ts            # 模拟/实盘运行状态 + 待启动/停止
│   ├── clock.ts            # 5 分钟窗口时间计算
│   └── types.ts            # 核心类型定义
├── data/
│   ├── chainlink.ts        # Chainlink WS/HTTP 价格源
│   └── polymarket.ts       # Gamma API（市场发现）+ CLOB WS（订单簿）
├── cli/
│   ├── executor.ts         # CLI 子进程包装器（spawn、JSON 解析、超时、重试）
│   ├── commands.ts         # 类型安全的 CLI 命令构建器
│   └── types.ts            # CLI 输出类型定义
├── engine/
│   ├── signal.ts           # 价格对比 PtB 信号：方向 + 置信度
│   ├── edge.ts             # 价差：模型概率 - 市场概率
│   └── decision.ts         # 交易决策：进入/跳过、方向、仓位大小
├── runtime/
│   ├── mainLoop.ts         # 主循环：发现窗口 -> 监控 -> 决策 -> 执行
│   ├── windowManager.ts    # 窗口生命周期（发现 -> 交易 -> 结算 -> 赎回）
│   ├── settlement.ts       # 窗口后结算验证
│   └── redeemer.ts         # 通过 CLI 自动赎回已结算仓位
├── trading/
│   ├── paperTrader.ts      # 模拟交易仿真
│   ├── liveTrader.ts       # 通过 CLI 命令实盘交易
│   ├── account.ts          # 账户统计（盈亏、余额、仓位）
│   └── persistence.ts      # 信号/交易持久化到数据库
├── db/
│   ├── schema.ts           # Drizzle schema（为 BTC 5 分钟简化）
│   └── client.ts           # PostgreSQL 连接
├── app/
│   ├── api/                # Hono API 路由（状态、配置、交易、控制）
│   ├── ws.ts               # 向前端推送 WebSocket
│   └── bootstrap.ts        # 应用启动（数据库、API 服务器、配置监听器）
├── backtest/
│   ├── engine.ts           # 回测引擎（回放历史窗口）
│   └── replay.ts           # 回放的历史数据获取器
└── terminal/
    └── dashboard.ts        # 终端 UI 渲染
```

### 与当前机器人相比的移除项

| 移除项 | 原因 |
|---------|--------|
| `indicators/`（RSI、MACD、VWAP、Heiken Ashi） | 技术分析指标在 5 分钟二进制窗口中毫无意义 |
| `engines/probability.ts`（技术分析评分） | 替换为直接价格对比 PtB 信号 |
| `engines/regime.ts`（趋势/震荡检测） | 5 分钟窗口中没有市场状态概念 |
| `data/binance.ts`、`data/bybit.ts`、`data/bybitWs.ts`、`data/binanceWs.ts` | 仅使用 Chainlink + Polymarket 数据 |
| `data/priceAggregator.ts` | 单一价格来源（Chainlink） |
| `trading/executionService.ts` | 替换为 CLI 执行器 |
| `trading/walletService.ts` | CLI 处理钱包/签名 |
| `trading/heartbeatService.ts` | CLI 处理订单生命周期 |
| `trading/orderManager.ts`（大部分） | CLI 处理订单跟踪 |
| `blockchain/`（合约、赎回器、对账器、账户状态） | 通过 CLI 赎回，无直接链上调用 |
| `contracts/`（ABI） | 使用 CLI 后不需要 |
| `runtime/onchainRuntime.ts` | 无直接链上操作 |
| `runtime/streamFactory.ts` | 替换为更简单的数据层 |
| `pipeline/`（获取、计算、processMarket） | 替换为更简单的 engine/ |

## 策略：实时价格偏差

### 核心逻辑

每个 tick（1 秒轮询间隔），机器人计算：

```
currentPrice     = Chainlink BTC/USD 实时价格
priceToBeat      = 窗口开始时的 Chainlink BTC/USD 价格（来自 Polymarket 市场数据）
priceDeviation   = (currentPrice - priceToBeat) / priceToBeat
direction        = currentPrice >= priceToBeat ? "UP" : "DOWN"

modelProbUp      = f(priceDeviation, timeLeft, volatility)
marketProbUp     = Polymarket 涨代币中间价 ((bestBid + bestAsk) / 2)

edgeUp           = modelProbUp - marketProbUp
edgeDown         = (1 - modelProbUp) - (1 - marketProbUp)  // = marketProbUp - modelProbUp

bestEdge         = max(edgeUp, edgeDown)
bestSide         = edgeUp > edgeDown ? "UP" : "DOWN"
```

### 模型概率函数

模型概率（`modelProbUp`）将当前价格偏差映射到窗口收盘为涨的概率。这是一个类 sigmoid 函数：

```typescript
function modelProbability(
  priceDeviation: number,    // (current - ptb) / ptb, 例如 +0.001 = +0.1%
  timeLeftSeconds: number,   // 窗口剩余秒数
  recentVolatility: number,  // Chainlink 价格 tick 的滚动标准差
): number {
  // 偏差越大 = 方向置信度越高
  // 剩余时间越少 = 置信度越高（反转时间越少）
  // 波动率越高 = 置信度越低（不确定性更大）
  const timeDecay = timeLeftSeconds / 300; // 开始为 1.0，结束为 0.0
  const volAdjust = Math.max(recentVolatility, MIN_VOLATILITY);
  const z = priceDeviation / (volAdjust * Math.sqrt(timeDecay + EPSILON));
  return sigmoid(z * SIGMOID_SCALE);
}
```

**关键可调参数**（在 config.json 中）：
- `SIGMOID_SCALE` — 概率对价格偏差的敏感度
- `MIN_VOLATILITY` — 波动率估计的下限，避免除以接近零的数
- `EPSILON` — 当 timeLeft 接近 0 时防止除以零

### 基于阶段的价格差阈值

窗口内的时间决定了需要多少价差：

| 阶段 | 剩余时间 | 价差阈值 | 原理 |
|-------|-----------|----------------|-----------|
| 早期 | > 3 分钟 | 高（例如 0.08） | 价格可能反转，需要大价差 |
| 中期 | 1-3 分钟 | 中等（例如 0.05） | 信号更强，门槛适中 |
| 晚期 | < 1 分钟 | 低（例如 0.03） | 信号强烈，门槛降低 |

这些阈值在 config.json 中按阶段可配置。

### 交易决策流程

```
1. 模拟/实盘是否运行中？→ 否：跳过
2. 是否有活跃窗口？→ 否：跳过
3. 获取 Chainlink 价格 + Polymarket 订单簿
4. 计算模型概率 + 价差
5. 检查基于阶段的价格差阈值
6. 检查风险限制（最大仓位、日亏损等）
7. 如果价差足够 → 执行交易（模拟或通过 CLI 实盘）
8. 如果已有仓位 → 监控（每个窗口不重复入场）
```

### 波动率估计

由于我们只有 Chainlink 数据，波动率从近期价格 tick 估计：

```typescript
// Chainlink 价格 tick 的滚动窗口（最近 N 秒）
// 计算对数收益率的标准差
const logReturns = ticks.map((t, i) => i > 0 ? Math.log(t.price / ticks[i-1].price) : 0);
const volatility = stddev(logReturns.slice(1));
```

这使用当前窗口（以及可选的前一个窗口用于预热）期间累积的 Chainlink WS 源 tick。

## CLI 集成层

### 执行器设计

```typescript
// cli/executor.ts
interface CliResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}

async function execCli<T>(args: string[], opts?: {
  timeoutMs?: number;    // 默认 10_000
  retries?: number;      // 默认 1
  parseJson?: boolean;   // 默认 true
}): Promise<CliResult<T>>;
```

所有 CLI 调用都通过这个单一执行器处理：
- 使用 `-o json` 标志生成 `polymarket`
- 超时（可配置，默认 10s）
- JSON 输出解析
- 瞬态失败时重试（网络错误、5xx）
- 结构化错误日志

### 命令映射

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

### 错误处理

CLI 失败分类如下：
- **瞬态**（网络超时、5xx）→ 带退避重试
- **永久**（余额不足、无效代币）→ 记录并跳过
- **致命**（CLI 未找到、认证失败）→ 停止机器人并发出警报

## 窗口生命周期

### WindowManager 状态机

每个 5 分钟窗口经历以下状态：

```
PENDING → ACTIVE → CLOSING → SETTLED → REDEEMED
```

| 状态 | 描述 | 操作 |
|-------|-------------|---------|
| PENDING | 已发现窗口，尚未开始 | 获取市场元数据，解析代币 ID |
| ACTIVE | 窗口进行中（0-5 分钟） | 监控价格、计算价差、执行交易 |
| CLOSING | 窗口结束，等待结算 | 停止交易，等待 Polymarket 结算 |
| SETTLED | 结算已确认 | 记录结果，更新盈亏 |
| REDEEMED | 仓位已赎回（仅限实盘） | CLI 赎回调用，更新余额 |

### 窗口发现

```typescript
// 每个 tick，计算当前和下一个窗口
const WINDOW_SEC = 300;
const nowSec = Math.floor(Date.now() / 1000);
const currentWindowEnd = Math.ceil(nowSec / WINDOW_SEC) * WINDOW_SEC;
const currentWindowStart = currentWindowEnd - WINDOW_SEC;
const slug = `btc-updown-5m-${currentWindowEnd}`;

// 从 Gamma API 获取市场（缓存 30s）
const market = await fetchMarketBySlug(slug);
```

### 滚动窗口重叠和仓位计数

机器人同时跟踪两个窗口：
1. **当前窗口** — 积极交易
2. **前一个窗口** — 结算/赎回中

这确保前一个窗口的结算在当前窗口活跃时发生。

**仓位计数规则**：`maxOpenPositions` 仅计算**当前活跃窗口中未结算的仓位**。处于 CLOSING/SETTLED/REDEEMED 状态的前一个窗口的仓位不计入限制，因为已无法操作且结果已确定。这意味着即使前一个窗口仍在结算中，机器人也总能在新窗口中入场交易。风险是有界的，因为每个窗口最多有 `maxTradesPerWindow` 次入场（默认 1 次），且每次交易的最大亏损为 `maxTradeSizeUsdc`。

## 数据流

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

### Tick 处理（每 1 秒循环迭代）

1. 从 WS 缓冲区读取最新 Chainlink 价格
2. 从 WS 缓冲区读取最新 Polymarket 订单簿
3. 确定当前窗口状态（PENDING/ACTIVE/CLOSING/SETTLED）
4. 如果为 ACTIVE：
   a. 计算信号（价格对比 PtB）
   b. 计算价差（模型概率对比市场概率）
   c. 做出决策（阶段、阈值、风险限制）
   d. 如有必要执行交易
5. 如果为 CLOSING/SETTLED：运行结算逻辑
6. 发布状态快照（API + WS 到前端）
7. 渲染终端仪表板

## 配置

### config.json 结构（简化版）

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

所有字段在启动时 Zod 验证。`strategy` 和 `risk` 部分支持热重载。

### 环境变量

```
PAPER_MODE=true              # 以模拟模式启动
POLYMARKET_PRIVATE_KEY=0x... # 钱包私钥（CLI 使用；单一数据源）
DATABASE_URL=postgres://...  # PostgreSQL
API_TOKEN=...                # Hono 端点的 API 认证
PORT=9999                    # API 服务器端口
LOG_LEVEL=info               # 日志级别
```

**注意**：仅使用 `POLYMARKET_PRIVATE_KEY`。机器人不管理单独的钱包 —— CLI 直接读取此环境变量用于所有签名操作。

## 数据库 Schema

从当前 schema 简化。仅 BTC 5 分钟需要的表：

### trades

| 列 | 类型 | 说明 |
|--------|------|-------------|
| id | serial PK | |
| mode | text | "paper" 或 "live" |
| windowSlug | text | 例如 "btc-updown-5m-1773298200" |
| windowStartMs | bigint | 窗口开始时间戳（毫秒） |
| windowEndMs | bigint | 窗口结束时间戳（毫秒） |
| side | text | "UP" 或 "DOWN" |
| price | numeric | 入场价格 |
| size | numeric | USDC 金额 |
| priceToBeat | numeric | 窗口开始时的 BTC 价格 |
| entryBtcPrice | numeric | 交易入场时的 BTC 价格 |
| edge | numeric | 入场时计算的价差 |
| modelProb | numeric | 入场时模型概率 |
| marketProb | numeric | 入场时市场概率 |
| phase | text | "EARLY"、"MID"、"LATE" |
| orderId | text | CLI 订单 ID（模拟为 null） |
| outcome | text | "WIN"、"LOSS"、null（待结算） |
| settleBtcPrice | numeric | 窗口结束时的 BTC 价格（结算前为 null） |
| pnlUsdc | numeric | 盈亏（结算前为 null） |
| createdAt | timestamp | |
| settledAt | timestamp | |

### signals

| 列 | 类型 | 说明 |
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
| decision | text | "ENTER_UP"、"ENTER_DOWN"、"SKIP" |
| reason | text | 适用时的跳过原因 |

### balanceSnapshots

| 列 | 类型 | 说明 |
|--------|------|-------------|
| id | serial PK | |
| mode | text | |
| balanceUsdc | numeric | |
| totalPnl | numeric | |
| winCount | integer | |
| lossCount | integer | |
| snapshotAt | timestamp | |

## 错误处理

### 分层策略

| 层级 | 错误类型 | 响应 |
|-------|-----------|----------|
| **数据** | Chainlink WS 断开 | 带退避重连；使用 HTTP 备用；价格更新前跳过交易 |
| **数据** | Polymarket WS 断开 | 重连；使用 REST 备用获取订单簿；如果市场价格过时则跳过交易 |
| **数据** | Gamma API 失败 | 带退保重试；使用缓存的市场数据（30s TTL） |
| **CLI** | 瞬态失败（超时、5xx） | 重试一次；记录警告 |
| **CLI** | 永久失败（认证、余额） | 记录错误；停止实盘交易；继续模拟 |
| **CLI** | CLI 二进制文件未找到 | 启动时致命错误 |
| **引擎** | 价格过时（> 5s） | 跳过本次 tick 交易 |
| **引擎** | 缺少 PriceToBeat | 完全跳过该窗口 |
| **运行时** | 所有 tick 失败持续 60s+ | 进入安全模式；停止交易；发出警报 |
| **数据库** | 连接失败 | 降级：继续交易但不持久化；后台重连 |

### 安全模式

如果机器人检测到 N 次连续 tick 失败（可配置，默认 10），它进入安全模式：
- 停止下新订单
- 继续监控和结算
- 通过 API/WS 发布警报
- 当 tick 再次成功时自动恢复

## 测试策略

### 单元测试（纯函数）

- `clock.ts` — 窗口时间计算、slug 生成、阶段检测
- `engine/signal.ts` — 已知输入/输出的模型概率函数
- `engine/edge.ts` — 价差计算正确性
- `engine/decision.ts` — 各种价差/阶段/风险组合的决策逻辑
- `cli/executor.ts` — JSON 解析、超时行为、重试逻辑（模拟子进程）
- `trading/paperTrader.ts` — 模拟成交仿真
- `trading/account.ts` — 盈亏计算、余额更新

### 集成测试

- CLI 命令 — 验证针对真实 CLI 的 JSON 输出解析（可选，需要 CLI 已安装）
- Chainlink 数据 — 验证 WS 消息中的价格解析
- Polymarket 数据 — 验证 CLOB WS 消息中的订单簿解析
- 数据库 — 通过测试数据库验证 schema 和查询正确性

### 回测验证

回测引擎回放历史 5 分钟窗口。有两个不同的数据需求：

**A. BTC/USD 价格（Chainlink 预言机 — 用于信号计算）**：
- **主数据源（高保真）**：机器人自己的 `signals` 表，在实盘/模拟操作期间存储每个 1 秒 tick 的 `chainlinkPrice`。仅在机器人开始运行后的窗口可用。
- **备用（低保真）**：对于机器人存在之前的窗口，使用 Polygon RPC 通过 Chainlink 链上历史数据（聚合器合约上的 `getRoundData`）。这提供约每个心跳一次更新（BTC/USD 约 20s）。或者从第三方 Chainlink 数据存档获取。
- **注意**：Polymarket CLOB `/prices-history` 端点返回的是**代币价格历史**（涨跌结果价格），不是 BTC/USD 预言机价格。这是不同的数据。

**B. Polymarket 市场价格（用于价差计算）**：
- **主数据源（高保真）**：机器人的 `signals` 表在每个 tick 存储 `marketProbUp`。
- **备用（低保真）**：CLOB `/prices-history?market={upTokenId}` 端点以 1 分钟保真度提供历史涨代币价格。这代表了涨的市场隐含概率。

**C. Price-to-Beat 和结果**：对于每个历史窗口，通过 `GET /markets?slug={slug}` 获取市场。市场的 `eventStartTime` 标识窗口开始；结算结果（涨/跌）可从市场的已结算状态获得。

**回放流程**：
1. 对于日期范围，生成所有窗口 slug（每个 5 分钟边界的 `btc-updown-5m-{t}`）
2. 对于每个窗口，获取：(a) BTC/USD 价格序列，(b) 涨代币价格序列，(c) PriceToBeat，(d) 实际结果
3. 逐 tick 模拟策略（来自 signals 表的 1 秒，或从低保真来源插值）
4. 记录模拟决策并与实际结果比较
5. 报告：胜率、盈亏、夏普比率、最大回撤、价差分布、校准曲线

**实际含义**：回测对于机器人运行并记录 tick 的窗口最准确。对于机器人存在前的窗口，回测保真度较低（市场价格 1 分钟，BTC/USD 约 20s），结果应按此警告解读。

## API 端点（Hono）

从当前机器人简化，专注于 BTC 5 分钟：

| 方法 | 路径 | 用途 |
|--------|------|---------|
| GET | `/api/status` | 机器人状态（模式、运行状态、当前窗口、余额） |
| GET | `/api/trades` | 带分页的交易历史 |
| GET | `/api/signals` | 最近信号日志 |
| GET | `/api/config` | 当前配置快照 |
| PATCH | `/api/config` | 更新策略/风险配置（热重载） |
| POST | `/api/control/start` | 启动模拟/实盘交易 |
| POST | `/api/control/stop` | 停止交易 |
| GET | `/api/stats` | 聚合统计（胜率、盈亏等） |
| WS | `/ws` | 向前端实时推送状态快照 |

## API 与 WebSocket 合约

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
  dailyMaxLoss: number;      // 来自配置
  balanceUsdc: number;       // 当前余额
}
```

### PATCH /api/config — 请求体

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
// 查询参数：?mode=paper|live&limit=50&offset=0&from=2026-03-01&to=2026-03-12
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
  createdAt: string;        // ISO 时间戳
  settledAt: string | null;
}
```

### GET /api/signals → SignalRecordDto[]

```typescript
// 查询参数：?windowSlug=btc-updown-5m-1773298200&limit=100&offset=0
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

### POST /api/control/start 和 /api/control/stop

```typescript
// 请求体
interface ControlRequestDto {
  mode: "paper" | "live";
}

// 响应
interface ControlResponseDto {
  ok: boolean;
  message: string;       // 例如 "Paper trading started" 或 "Already running"
  state: {
    paperRunning: boolean;
    liveRunning: boolean;
  };
}
```

### WS state:snapshot → StateSnapshotPayload

```typescript
interface StateSnapshotPayload {
  updatedAt: string;         // ISO 时间戳
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

### WS 事件类型

```typescript
type WsEventType = "state:snapshot" | "signal:new" | "trade:executed";

interface WsMessage<T = unknown> {
  type: WsEventType;
  data: T;
  ts: number;
}

// signal:new 负载
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

// trade:executed 负载
interface TradeExecutedPayload {
  mode: "paper" | "live";
  windowSlug: string;
  side: "UP" | "DOWN";
  price: number;
  size: number;
  edge: number;
  orderId: string | null;  // 模拟为 null
  timestamp: string;
}
```

## 前端影响（范围外）

`packages/web` 更新**不是本实现计划的一部分**。它们将在 bot 重写完成并稳定后作为单独的 spec 和计划进行。上面定义的 bot API 和 WS 合约是接口边界 —— 前端将消费它们。

作为参考，最终需要的前端变更：
- 移除多市场 UI（现在只有 BTC 5 分钟）
- 更新状态类型以匹配新的快照/DTO 形状
- 简化仪表板组件（没有 RSI/MACD/VWAP 图表）
- 新增：当前窗口计时器、Chainlink 价格对比 PtB 可视化、价差仪表盘

## Shared 包影响

`packages/shared/src/contracts/` 被重写以导出上面"API 与 WebSocket 合约"部分中定义的 DTO。现有文件（`config.ts`、`state.ts`、`http.ts`）被替换：

- **config.ts**：导出 `StrategyConfig`、`RiskConfigDto`、`ConfigUpdateDto`（配置部分的新形状）
- **state.ts**：导出 `StateSnapshotPayload`、`SignalNewPayload`、`TradeExecutedPayload`、`AccountStatsDto`、`WsEventType`、`WsMessage`（WS 合约部分的新形状）
- **http.ts**：导出 `StatusDto`、`StatsDto`、`TradeRecordDto`、`SignalRecordDto`、`ConfigSnapshotDto`、`ConfigUpdateDto`、`ControlRequestDto`、`ControlResponseDto`、`RiskConfigDto`（所有 API 请求/响应形状）
- **schemas.ts**：上述类型的 Zod schema 用于运行时验证（被 bot 和 web 使用）

所有旧类型（`MarketSnapshot`、`ConfidenceDto`、`PaperStats`、`DashboardStateDto` 等）都被移除。

## 部署

保持不变：
- Bot：VPS 上的 Docker（`packages/bot/Dockerfile`）
- 前端：Cloudflare Workers

新要求：
- Docker 镜像必须包含 `polymarket` CLI 二进制文件（固定到 v0.1.5 或更高版本）
- Dockerfile 从 GitHub releases 下载预构建二进制文件：`https://github.com/Polymarket/polymarket-cli/releases/download/v0.1.5/polymarket-linux-amd64`
- 在 `POLYMARKET_CLI_VERSION` 构建参数中固定版本以确保可复现性

## 迁移路径

1. 在 `packages/bot/src/` 中创建新的 bot 代码（替换现有文件）
2. 新的 Drizzle schema → 生成迁移
3. 更新 `packages/shared` 合约以匹配新的 DTO
4. 在实盘 5 分钟市场上用模拟交易测试
5. 部署 bot
6. （单独计划）更新 `packages/web` 以匹配新 API

## 已解决的设计决策

1. **市场发现**：使用基于 slug 的查找（`GET /markets?slug=btc-updown-5m-{epochEnd}`），而不是 series ID。不需要 series ID。
2. **Docker 中的 CLI**：在 Dockerfile 中从 GitHub releases 下载预构建二进制文件（更快，不需要 Rust 工具链）。在构建期间使用 `curl` 获取 linux-amd64 的最新 release。备用方案：用户可以通过 Docker volume 挂载主机编译的二进制文件。
3. **回测数据源**：机器人自己的 `signals` 表（1 秒保真度）是主要的、高保真数据源，仅在机器人开始运行后的窗口可用。对于机器人存在前的历史窗口，BTC/USD 使用链上 Chainlink 数据，市场价格使用 CLOB price-history API（低保真）。详见回测验证部分。
