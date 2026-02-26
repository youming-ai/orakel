# Orakel 系统架构文档

## 1. 系统概览

Orakel 是一个针对 Polymarket 15 分钟加密货币涨跌市场的自动化交易机器人。

**技术栈**

- 后端：Bun 运行时 + TypeScript + Hono + SQLite
- 前端：React 19 + Vite + shadcn/ui + Tailwind v4
- 仓库结构：Monorepo（`src/` 后端 + `web/` 前端）

**核心特性**

- 后端单进程同时承载 API 服务与交易逻辑
- 支持纸面交易（Paper）与实盘交易（Live）两种模式
- 通信层：REST API 处理初始加载与变更操作，WebSocket 推送实时状态快照
- 数据来源：Binance（价格/K线）、Polymarket（市场/订单簿）、Chainlink（链上预言机）

---

## 2. 架构图

```
外部数据源                        后端（Bun 运行时）                        前端（React 19）
┌──────────────────┐     ┌─────────────────────────────────────┐    ┌────────────────────┐
│ Binance REST/WS  │────>│ 数据层 (src/data/)                  │    │ Dashboard          │
│ Polymarket API   │────>│   ├ binance.ts / binanceWs.ts       │    │   ├ Header         │
│ Polymarket WS    │────>│   ├ polymarket.ts / polyLiveWs.ts   │    │   ├ MarketCard[]   │
│ Chainlink RPC    │────>│   └ chainlink.ts / chainlinkWs.ts   │    │   ├ AnalyticsTabs  │
│ Chainlink WS     │     │                                     │    │   └ TradeTable     │
└──────────────────┘     │ 引擎层 (src/engines/)               │    └────────────────────┘
                         │   ├ probability.ts（概率混合）       │              ↑
                         │   ├ regime.ts（市场状态检测）        │              │
                         │   └ edge.ts（决策与边缘计算）        │    ┌──────────┴─────────┐
                         │                                     │    │ REST API (/api/*)   │
                         │ 指标层 (src/indicators/)            │    │ WebSocket (/ws)     │
                         │   ├ rsi.ts      ├ macd.ts          │    └────────────────────┘
                         │   ├ vwap.ts     └ heikenAshi.ts    │              ↑
                         │                                     │              │
                         │ 核心层 (src/)                       │──────────────┘
                         │   ├ index.ts（主循环）              │
                         │   ├ trader.ts（交易执行）           │
                         │   ├ orderManager.ts（订单管理）     │
                         │   ├ state.ts（共享状态）            │
                         │   ├ api.ts（Hono 服务器）           │
                         │   └ db.ts（SQLite）                 │
                         └─────────────────────────────────────┘
```

---

## 3. 核心模块职责

### index.ts — 主事件循环

系统入口，驱动整个交易流程。

启动阶段按顺序执行：初始化 API 服务器 → 初始化 OrderManager → 加载活跃市场 → 初始化 WebSocket 流（Binance、Polymarket、Chainlink、CLOB）。

主循环每秒执行一次（由 `CONFIG.pollIntervalMs` 控制）：检查运行状态 → 检测窗口边界 → 处理挂起的启动/停止转换 → 结算纸面交易 → 并行处理所有市场 → 筛选候选交易（ENTER 决策 + 有效价格 + 时机合适）→ 按边缘值降序、rawSum 升序排序 → 执行交易 → 发送状态快照 → 渲染仪表盘 → 休眠。

连续 3 次全市场失败后进入安全模式，跳过执行直至恢复。

### trader.ts — 交易执行

负责纸面与实盘两种模式的交易执行。

**纸面模式**：验证价格 → 应用限价折扣 → 加入纸面跟踪 → 写入数据库。

**实盘模式**：验证客户端与钱包 → 检查每日亏损限额 → 根据时机与信心选择订单类型（LATE 阶段且高信心 → FOK；EARLY/MID 阶段 → GTD post-only）→ 计算动态过期时间 → 下单 → 注册心跳监控。

**心跳机制**：每 5 秒检查一次，仅在存在 GTD 订单时激活。连续 3 次失败则停止实盘并启动指数退避重连（最多 5 次尝试）。

### orderManager.ts — 订单轮询生命周期

每 5 秒通过 CLOB API 轮询活跃订单状态。

状态流转：placed → live → matched / filled / cancelled / expired。状态变更时触发回调（驱动心跳跟踪）。自动清理超过 20 分钟的历史订单。

### state.ts — 共享运行时状态

通过模块级单例 + EventEmitter 管理全局状态。

管理内容：运行状态（paper/live）、挂起的启动/停止转换（周期感知）、各市场快照、状态版本号。

发出事件：`state:snapshot`（每次循环）、`signal:new`、`trade:executed`。

周期感知的挂起转换机制确保状态变更不会发生在窗口处理中途，避免数据不一致。

### api.ts — Hono HTTP 服务器

提供 15 个 REST 端点 + WebSocket 接口。

通过 Bearer Token 进行身份验证。速率限制为 600 令牌/60 秒。启用 CORS。提供静态 SPA 文件服务。导出 `AppType` 供前端 RPC 类型推断使用。

### config.ts — 配置管理

通过 Zod 验证 `config.json`。支持 `fs.watch` 自动热重载。写入采用原子操作（临时文件 + 重命名）。支持旧格式迁移。包含 `RiskConfig`（paper/live 各一份）与 `StrategyConfig`。

### db.ts — 数据库层

SQLite，启用 WAL 模式。包含 5 张表：`trades`、`signals`、`paper_trades`、`daily_stats`、`paper_state`。使用预编译语句缓存。包含 2 个迁移脚本。

### markets.ts — 市场定义

定义 BTC、ETH、SOL、XRP 四个市场。每个市场包含：Binance 交易对符号、Polymarket 系列 ID/slug、Chainlink 聚合器合约地址、价格精度。

---

## 4. 数据流管线（每秒执行）

### 第一阶段：数据采集（并行）

| 数据源 | 内容 | 缓存策略 |
|--------|------|----------|
| Binance REST | 240 根 1 分钟 K 线 | 60 秒缓存 |
| Binance WS | 实时成交数据 | 流式推送 |
| Polymarket REST | 市场元数据 | 30 秒缓存 |
| Polymarket REST | 价格与订单簿 | 3 秒缓存 |
| Polymarket WS | Chainlink 价格推送 | 流式推送 |
| Chainlink RPC | 链上价格 | 最小间隔 2 秒 |
| Chainlink WS | AnswerUpdated 事件 | 流式推送 |
| CLOB WS | 最优买卖价、tick size、结算状态 | 流式推送 |

### 第二阶段：技术指标计算

Heiken Ashi 平滑 K 线 → RSI(14) → MACD(12,26,9) → VWAP 及斜率 → 已实现波动率（60 根 K 线 × √15 年化）

### 第三阶段：概率引擎

1. TA 评分：6 个指标聚合为 `rawUp` 原始概率
2. 波动率隐含概率：Φ(z) 正态分布，加入肥尾阻尼修正
3. 时间衰减：S 曲线调整
4. 混合：50% 波动率 + 50% TA
5. 调整：Binance 领先效应 ±2%，订单簿失衡 ±2%

### 第四阶段：市场状态检测

`detectRegime()` 输出四种状态：`TREND_UP` / `TREND_DOWN` / `RANGE` / `CHOP`

### 第五阶段：边缘计算

`edge = 模型概率 - 市场价格`，依次扣除：订单簿滑点、价差惩罚、手续费，最终检查 vig 阈值。

### 第六阶段：信心评分

5 个维度加权评分：

| 维度 | 权重 |
|------|------|
| 指标一致性 | 25% |
| 波动率评分 | 15% |
| 订单簿质量 | 15% |
| 时机评分 | 25% |
| 市场状态 | 20% |

### 第七阶段：交易决策

基于阶段的阈值 → 市场乘数 → 状态乘数 → 过度自信上限 → 最低信心检查 → 输出 `ENTER` 或 `NO_TRADE`。

详细策略参数见 `docs/trading-strategy.md`。

### 第八阶段：执行

- **纸面模式**：记录交易，窗口结束时按结算价结算
- **实盘模式**：通过 CLOB API 提交 FOK 或 GTD 订单

---

## 5. 15 分钟窗口生命周期

### 窗口对齐

窗口严格对齐到整点刻度：0:00、0:15、0:30、0:45。通过 `prevWindowStartMs` 追踪上一窗口起始时间来检测边界。

### 阶段划分

| 阶段 | 剩余时间 | 特征 |
|------|----------|------|
| EARLY | > 10 分钟 | 不确定性高，使用 GTD post-only 订单 |
| MID | 5–10 分钟 | 中等确定性，使用 GTD post-only 订单 |
| LATE | < 5 分钟 | 高确定性，高信心时使用 FOK 订单 |

### 边界处理流程

检测到新窗口时，按顺序执行：

1. 处理挂起的启动/停止转换
2. 结算上一窗口的纸面交易
3. 赎回实盘持仓
4. 重置各市场跟踪器

### 周期感知转换

挂起的模式切换（paper ↔ live）被推迟到窗口边界执行，防止在窗口处理中途发生状态变更导致数据不一致。

---

## 6. 状态管理模式

**模块级单例**：无依赖注入框架，直接使用模块顶层变量作为共享状态。适合单进程机器人，简单且无额外开销。

**EventEmitter（botEvents）**：跨模块通信的核心机制。主要事件：

- `state:snapshot` — 每次主循环结束后发出，携带完整状态快照，WebSocket 广播给前端
- `signal:new` — 新信号产生时发出
- `trade:executed` — 交易执行完成时发出

**状态版本号**：每次快照递增，前端用于检测乱序消息。

**周期感知挂起转换**：`pendingStart` / `pendingStop` 标志位在窗口边界才被消费，确保状态切换的原子性。

---

## 7. 错误处理策略

**市场级隔离**：每个市场独立处理，单个市场失败不阻塞其他市场的执行。

**安全模式**：连续 3 次或以上全市场失败后进入安全模式，跳过交易执行，直至至少一个市场成功处理。

**心跳韧性**：实盘 GTD 订单通过心跳监控。连续失败后启动指数退避重连，最多尝试 5 次。

**RPC 故障转移**：Chainlink 配置多个 RPC 端点，自动记住上次成功的首选端点，失败时轮换。

**WebSocket 自动重连**：所有 WebSocket 连接（Binance、Polymarket、Chainlink、CLOB）在断开后自动重连，退避时间从 500ms 指数增长至最大 10 秒。

**优雅降级**：数据获取失败时使用缓存数据继续运行，记录警告日志但不中断主循环。

---

## 8. 设计决策

### 为什么选择 Bun

Bun 提供快速启动时间、原生 TypeScript 支持（无需额外编译步骤）以及内置 SQLite 驱动，减少了外部依赖数量，适合单进程交易机器人场景。

### 为什么选择 Hono

Hono 轻量、无运行时依赖，支持链式路由定义并导出 `AppType`，前端可通过 `hc<AppType>()` 获得完整的端到端类型推断，消除 API 契约漂移风险。

### 为什么使用模块级单例而非依赖注入

Orakel 是单进程应用，不需要多实例或测试隔离。模块级单例代码更简洁，无框架开销，符合 YAGNI 原则。

### 为什么需要周期感知转换

15 分钟窗口内的状态切换（如从纸面切换到实盘）可能导致同一窗口内部分交易以纸面模式记录、部分以实盘模式执行，造成统计数据不一致。将转换推迟到窗口边界确保每个窗口内模式统一。

### 为什么同时使用 REST 和 WebSocket

REST API 用于初始页面加载（获取历史数据、配置、交易记录）和变更操作（修改配置、启停机器人），语义清晰且易于调试。WebSocket 用于推送实时状态快照（每秒一次），避免前端频繁轮询，降低延迟。两者职责分离，互不干扰。
