# 后端

## 1. 概览

后端运行于 Bun 运行时，单进程同时承载交易逻辑与 API 服务器。

- **运行时**: Bun v1.0+
- **框架**: Hono（HTTP + WebSocket）
- **数据库**: SQLite（WAL 模式）
- **语言**: TypeScript（严格模式，verbatimModuleSyntax）

---

## 2. API 接口参考 (src/api.ts)

### 2.1 认证

- 通过 `API_TOKEN` 环境变量配置 Bearer 令牌
- 变更类端点（PUT/POST）需要认证
- 读取类端点（GET）公开访问
- 请求头格式：`Authorization: Bearer <token>`

### 2.2 速率限制

- 每 IP 每 60 秒 600 个令牌（约 10 请求/秒）
- 本地网络自动绕过（127.0.0.1、::1、172.x、10.x）
- 每 60 秒清理一次过期记录

### 2.3 REST 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /api/health | 否 | 健康检查（uptime、内存） |
| GET | /api/db/diagnostics | 否 | 数据库诊断（路径、权限、大小） |
| GET | /api/state | 否 | 完整仪表板状态 |
| GET | /api/trades?mode=paper\|live&limit=100 | 否 | 近期交易记录 |
| GET | /api/signals?limit=200 | 否 | 近期信号 |
| GET | /api/paper-stats | 否 | 模拟交易统计 |
| PUT | /api/config | 是 | 更新策略配置 |
| POST | /api/paper/start | 是 | 启动模拟交易 |
| POST | /api/paper/stop | 是 | 停止模拟交易 |
| POST | /api/paper/cancel | 是 | 取消挂起操作 |
| POST | /api/paper/clear-stop | 是 | 清除止损标志 |
| POST | /api/live/connect | 是 | 连接钱包（body: {privateKey}） |
| POST | /api/live/disconnect | 是 | 断开钱包 |
| POST | /api/live/start | 是 | 启动实盘交易 |
| POST | /api/live/stop | 是 | 停止实盘交易 |
| POST | /api/live/cancel | 是 | 取消挂起操作 |

### 2.4 WebSocket

- **路径**: GET /api/ws
- **认证**: 可选 Bearer 令牌（请求头或查询参数 `?token=...`）
- **初始化**: 连接后立即推送完整 `StateSnapshotPayload`
- **事件类型**:
  - `state:snapshot`（500ms 节流）— 完整市场状态
  - `signal:new` — 新交易信号
  - `trade:executed` — 交易完成
- **消息格式**: `{ type, data, ts, version }`

### 2.5 响应格式

- 成功：`{ ok: true, data: ... }`
- 失败：`{ ok: false, error: "message" }`

**`/api/state` 响应字段**:

| 字段 | 说明 |
|------|------|
| markets | 各市场状态数组 |
| wallet | 钱包信息 |
| config | 当前策略配置 |
| stats | 汇总统计 |
| running | 运行标志（paper/live） |
| pending | 挂起标志 |
| stopLoss | 止损状态 |
| todayStats | 当日统计 |

**`/api/trades` 响应**（数组，每项字段）:

| 字段 | 说明 |
|------|------|
| timestamp | 时间戳 |
| market | 市场（BTC/ETH/SOL/XRP） |
| side | 方向（UP/DOWN） |
| amount | USDC 金额 |
| price | 入场价 |
| orderId | 订单 ID |
| status | 状态（placed/filled/cancelled） |
| mode | 模式（paper/live） |
| pnl | 盈亏 |
| won | 是否盈利（0/1） |

**`/api/signals` 响应**（数组，共 23 个字段）:

包含时间信息（entry_minute、time_left_min）、市场状态（regime）、概率（vol_implied_up、ta_raw_up、blended_up）、价差（binance_chainlink_delta）、订单簿失衡（orderbook_imbalance）、模型概率（model_up/model_down）、市场价（mkt_up/mkt_down）、边缘（edge_up/edge_down）、推荐动作（recommendation）等字段。

---

## 3. 数据库 (src/db.ts)

### 3.1 SQLite 配置

- **路径**: `./data/bot.sqlite`
- **Pragmas**:
  - WAL 日志模式
  - NORMAL 同步级别
  - 64MB 缓存
  - 5 秒繁忙超时
  - 外键约束开启
- **语句缓存**: `Map<sql, PreparedStatement>`

### 3.2 数据库表结构

#### trades 表

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增主键 |
| timestamp | TEXT | ISO 8601 时间戳 |
| market | TEXT | BTC/ETH/SOL/XRP |
| side | TEXT | UP/DOWN |
| amount | REAL | USDC 金额 |
| price | REAL | 入场价 |
| order_id | TEXT | 订单 ID |
| status | TEXT | placed/filled/cancelled |
| mode | TEXT | paper/live |
| pnl | REAL | 盈亏（可为空） |
| won | INTEGER | 0/1（可为空） |
| created_at | TEXT | 创建时间 |

索引：`(market, mode)`、`(timestamp DESC)`

#### signals 表

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增主键 |
| timestamp | TEXT | ISO 8601 时间戳 |
| market | TEXT | 市场 |
| regime | TEXT | TREND_UP/TREND_DOWN/RANGE/CHOP |
| signal | TEXT | ENTER/HOLD |
| vol_implied_up | REAL | 波动率隐含概率 |
| ta_raw_up | REAL | TA 原始概率 |
| blended_up | REAL | 融合概率 |
| blend_source | TEXT | blended/ta_only |
| volatility_15m | REAL | 15 分钟波动率 |
| price_to_beat | REAL | 目标价 |
| binance_chainlink_delta | REAL | 价差 |
| orderbook_imbalance | REAL | 订单簿失衡度 |
| model_up | REAL | 模型上涨概率 |
| model_down | REAL | 模型下跌概率 |
| mkt_up | REAL | 市场上涨价 |
| mkt_down | REAL | 市场下跌价 |
| raw_sum | REAL | 市场 YES+NO 之和 |
| arbitrage | INTEGER | 套利标志 |
| edge_up | REAL | 上涨边缘 |
| edge_down | REAL | 下跌边缘 |
| recommendation | TEXT | 推荐动作 |
| entry_minute | REAL | 入场分钟 |
| time_left_min | REAL | 剩余时间（分钟） |
| created_at | TEXT | 创建时间 |

索引：`(market, timestamp DESC)`

#### paper_trades 表

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增主键 |
| market_id | TEXT | 市场 ID |
| window_start_ms | INTEGER | 窗口开始时间戳（毫秒） |
| side | TEXT | UP/DOWN |
| price | REAL | 入场价 |
| size | REAL | 仓位大小 |
| price_to_beat | REAL | 目标价 |
| current_price_at_entry | REAL | 入场时当前价 |
| timestamp | TEXT | 时间戳 |
| resolved | INTEGER | 是否已结算（0/1） |
| won | INTEGER | 是否盈利（0/1，可为空） |
| pnl | REAL | 盈亏（可为空） |
| settle_price | REAL | 结算价（可为空） |

索引：`(resolved, timestamp DESC)`

#### daily_stats 表

| 列 | 类型 | 说明 |
|----|------|------|
| date | TEXT | 日期（YYYY-MM-DD） |
| mode | TEXT | paper/live |
| pnl | REAL | 当日盈亏 |
| trades | INTEGER | 交易次数 |
| wins | INTEGER | 盈利次数 |
| losses | INTEGER | 亏损次数 |

主键：`(date, mode)`

#### paper_state 表

单例记录（id=1），存储模拟交易持久化状态：

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 固定为 1 |
| initial_balance | REAL | 初始余额 |
| current_balance | REAL | 当前余额 |
| max_drawdown | REAL | 最大回撤 |
| wins | INTEGER | 累计盈利次数 |
| losses | INTEGER | 累计亏损次数 |
| total_pnl | REAL | 累计盈亏 |
| stopped_at | TEXT | 止损触发时间（可为空） |
| stop_reason | TEXT | 止损原因（可为空） |
| daily_pnl | TEXT | 每日盈亏 JSON |
| daily_counted_trade_ids | TEXT | 已计入统计的交易 ID JSON |

### 3.3 迁移

- **迁移 v1**：创建 `trades`、`signals`、`paper_trades`、`daily_stats` 表
- **迁移 v2**：创建 `paper_state`、`kv_store` 表

---

## 4. 配置系统 (src/config.ts)

### 4.1 配置文件 (config.json)

配置文件经 Zod 验证，分为 `paper`（模拟）、`live`（实盘）风险配置和 `strategy`（策略）配置。

**风险配置（RiskConfig）— paper 与 live 各一份**:

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| maxTradeSizeUsdc | number | 1 | 单笔最大交易金额（USDC） |
| limitDiscount | number | 0.05 | 限价折扣 |
| dailyMaxLossUsdc | number | 10 | 每日最大亏损（USDC） |
| maxOpenPositions | number | 2 | 最大同时持仓数 |
| minLiquidity | number | 15000 | 最小流动性要求 |
| maxTradesPerWindow | number | 1 | 每窗口最大交易次数 |

**策略配置（StrategyConfig）**:

| 字段 | 类型 | 说明 |
|------|------|------|
| edgeThresholds.min | number | 最小边缘阈值 |
| edgeThresholds.strong | number | 强边缘阈值 |
| minProbs.blended | number | 融合概率最小值 |
| minProbs.model | number | 模型概率最小值 |
| minProbs.market | number | 市场概率最小值 |
| blendWeights.ta | number | TA 权重 |
| blendWeights.vol | number | 波动率权重 |
| regimeMultipliers.TREND_UP | number | 趋势上涨乘数 |
| regimeMultipliers.TREND_DOWN | number | 趋势下跌乘数 |
| regimeMultipliers.RANGE | number | 震荡区间乘数 |
| regimeMultipliers.CHOP | number | 混沌乘数 |
| skipMarkets | string[] | 跳过的市场列表 |
| minConfidence | number | 最小置信度 |
| maxGlobalTradesPerWindow | number | 全局每窗口最大交易数 |
| marketPerformance | object | 各市场历史表现权重 |

### 4.2 热重载

- 使用 `fs.watch` 监听 `config.json` 文件变更
- `reloadConfig()` 重新解析并通过 Zod 验证
- 监听器注册：`onConfigReload()` / `offConfigReload()`
- 原子写入：先写临时文件再重命名，防止写入损坏

### 4.3 迁移

- 旧格式 `{risk, strategy}` 自动迁移为新格式 `{paper: {risk}, live: {risk}, strategy}`
- 迁移前自动创建 `config.json.bak` 备份

---

## 5. 环境变量 (src/env.ts)

所有变量通过 Zod 验证，从 `.env` 文件加载。

| 变量 | 类型 | 默认值 | 必需 | 说明 |
|------|------|--------|------|------|
| PAPER_MODE | boolean | false | 否 | 启用模拟交易模式 |
| API_PORT | number | 9999 | 否 | API 服务端口 |
| ACTIVE_MARKETS | string[] | [] | 否 | 启用的市场列表（逗号分隔） |
| API_TOKEN | string | "" | 否 | API 认证令牌 |
| PERSIST_BACKEND | enum | sqlite | 否 | 写入后端（sqlite/csv） |
| READ_BACKEND | enum | sqlite | 否 | 读取后端（sqlite/csv） |
| LOG_LEVEL | enum | info | 否 | 日志级别（debug/info/warn/error/silent） |
| POLYMARKET_API_KEY | string | — | 否 | Polymarket API 密钥 |
| POLYMARKET_API_SECRET | string | — | 否 | Polymarket API 密钥 |
| POLYMARKET_API_PASSPHRASE | string | — | 否 | Polymarket API 密码 |
| POLYMARKET_PRIVATE_KEY | string | — | 否 | 钱包私钥 |
| POLYMARKET_PROXY_ADDRESS | string | — | 否 | 代理合约地址 |
| BINANCE_API_KEY | string | — | 否 | Binance API 密钥 |
| BINANCE_API_SECRET | string | — | 否 | Binance API 密钥 |
| RPC_URL | string | — | 否 | EVM RPC 节点 URL |
| CHAINLINK_RPC_URL | string | — | 否 | Chainlink 专用 RPC URL |
| DATA_DIR | string | ./data | 否 | 数据目录路径 |
| NODE_ENV | enum | development | 否 | 运行环境（development/production） |

---

## 6. 日志系统 (src/logger.ts)

- **工厂函数**: `createLogger(tag)` 返回 `{ debug, info, warn, error }`
- **日志级别**（数值越大越严格）:
  - `debug` (0)
  - `info` (1)
  - `warn` (2)
  - `error` (3)
  - `silent` (4)
- **模块标签**: 每条日志携带模块标识，如 `[api]`、`[db]`、`[trader]` 等
- **阈值过滤**: 通过 `LOG_LEVEL` 环境变量控制输出级别，低于阈值的日志不输出

---

## 7. 工具函数 (src/utils.ts)

| 函数签名 | 说明 |
|----------|------|
| `clamp(value, min, max): number` | 将数值限制在 [min, max] 范围内 |
| `normalCDF(x): number` | 标准正态分布累积分布函数 |
| `sleep(ms): Promise<void>` | 异步等待指定毫秒数 |
| `formatNumber(n, decimals?): string` | 格式化数字为字符串（指定小数位） |
| `formatPct(n, decimals?): string` | 格式化为百分比字符串 |
| `getCandleWindowTiming(now?): CandleWindowTiming` | 计算当前 15 分钟蜡烛窗口的时间信息（开始时间、剩余时间、入场分钟） |
| `ensureDir(path): void` | 确保目录存在，不存在则创建 |
| `appendCsvRow(path, row): Promise<void>` | 追加一行数据到 CSV 文件 |
| `estimatePolymarketFee(amount, price): number` | 估算 Polymarket 交易手续费 |

---

## 8. 模拟交易 (src/paperStats.ts)

### 状态管理

`PersistedPaperState` 单例，持久化存储模拟交易的完整状态。

### 持久化

- 主存储：SQLite（`paper_state` + `paper_trades` 表）
- 降级方案：JSON 文件（SQLite 不可用时）

### 核心函数

| 函数 | 说明 |
|------|------|
| `initPaperStats()` | 初始化或恢复模拟交易状态 |
| `addPaperTrade(trade)` | 记录新的模拟交易 |
| `resolvePaperTrades()` | 结算到期的模拟交易 |
| `getPaperStats()` | 获取当前统计数据 |
| `getPaperBalance()` | 获取当前模拟余额 |

### 结算逻辑

- 比较最终价格（finalPrice）与目标价（priceToBeat）
- 根据方向（UP/DOWN）判断胜负
- 计算盈亏：胜出按市场赔率结算，失败扣除本金

### 止损机制

- **每日亏损限制**：当日亏损超过 `dailyMaxLossUsdc` 时触发止损
- **最大回撤限制**：回撤超过初始余额 50% 时触发止损
- 触发后记录 `stopped_at` 时间和 `stop_reason` 原因

### 每日盈亏追踪

- 按日期键存储每日盈亏
- 使用 Set 去重，保留最近 500 条交易 ID，防止重复计入

---

## 9. 市场定义 (src/markets.ts)

| 市场 | Binance 交易对 | Chainlink 聚合器地址 | Series ID | 价格精度（小数位） |
|------|---------------|---------------------|-----------|-------------------|
| BTC | BTCUSDT | 0xc907E1B8b4Eb4564... | 10192 | 0 |
| ETH | ETHUSDT | 0xF968B4248E9b1b... | 10191 | 1 |
| SOL | SOLUSDT | 0x10C8C279a8b384... | 10423 | 2 |
| XRP | XRPUSDT | 0x785b9B6a9B4e... | 10422 | 4 |

### 工具函数

| 函数 | 说明 |
|------|------|
| `getMarketById(id)` | 根据 ID 获取市场配置 |
| `getActiveMarkets()` | 获取当前启用的市场列表（由 `ACTIVE_MARKETS` 环境变量过滤） |

---

> 交易策略详情（边缘计算、概率融合、市场状态检测等）请参阅 [trading-strategy.md](./trading-strategy.md)。
