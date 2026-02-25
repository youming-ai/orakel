# Orakel

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/youming-ai/orakel)](https://github.com/youming-ai/orakel/stargazers)
[![Docker Pulls](https://img.shields.io/docker/pulls/orakel/bot)](https://hub.docker.com/r/orakel/bot)

一个针对 Polymarket **15分钟涨跌** 加密货币市场的生产级自动化交易机器人，支持模拟交易、Web 仪表板和 Docker 部署。

## 支持的市场

| 市场 | Binance 交易对 | Chainlink 聚合器 |
|------|---------------|------------------|
| BTC | BTCUSDT | 0xc907E116054Ad103354f2D350FD2514433D57F6f |
| ETH | ETHUSDT | 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612 |
| SOL | SOLUSDT | 0x5d4316B4fddEe94c1D9DA3a8a3c48bD6DA966047 |
| XRP | XRPUSDT | 0x8F62BF41D0B0Ec112D6953973B1Db26240129c37 |

## 功能特性

- **模拟交易模式** — 使用实时市场数据模拟交易，不使用真实资金
- **实时数据** — Binance WebSocket + Polymarket Chainlink 喂价 + 链上备选
- **技术分析** — Heiken Ashi、RSI、MACD、VWAP、已实现波动率
- **概率模型** — 波动率隐含概率与 TA 评分融合
- **市场状态检测** — Trend/RANGE/CHOP 市场状态识别与动态阈值
- **Web 仪表板** — React + shadcn/ui + recharts 监控与可视化
- **Docker 部署** — 一键部署 via docker-compose

## 系统架构

```
                         Docker Compose
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌─────────────────────┐    ┌──────────────────────────┐ │
│  │  web (port 9998)    │    │  bot (port 9999)         │ │
│  │  Vite Dev Server    │───▶│  Bun Runtime             │ │
│  │                     │/api│                          │ │
│  │  React 19           │    │  Hono API Server         │ │
│  │  shadcn/ui          │    │  ├ GET /api/state        │ │
│  │  recharts           │    │  ├ GET /api/trades       │ │
│  │  Tailwind v4        │    │  ├ GET /api/signals      │ │
│  │  Hot Reload         │    │  └ GET /api/paper-stats  │ │
│  │  wagmi + viem       │    │                          │ │
│  └─────────────────────┘    │  Trading Engine           │ │
│                              │  ├ Data Collection        │ │
│                              │  ├ TA Indicators         │ │
│                              │  ├ Probability Blend     │ │
│                              │  ├ Edge Computation      │ │
│                              │  └ Paper/Live Execution │ │
│                              └──────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## 快速开始

### 前置要求

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) + Docker Compose（容器化部署）
- [OrbStack](https://orbstack.dev/)（macOS 推荐）

### 使用 Docker 运行（推荐）

```bash
# 克隆仓库
git clone https://github.com/youming-ai/orakel.git
cd orakel

# 复制环境变量配置
cp .env.example .env

# 启动服务
docker compose up --build

# Bot API:    http://localhost:9999
# Web 前端:   http://localhost:9998
```

### 本地运行（开发）

```bash
# 安装依赖
bun install

# 安装 Web 依赖
cd web && bun install && cd ..

# 复制环境变量配置
cp .env.example .env

# 终端 1: 运行 bot
bun run start

# 终端 2: 运行 Web 开发服务器
cd web && bun run dev
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PAPER_MODE` | `true` | 模拟交易模式（不花真钱）|
| `API_PORT` | `9999` | API 服务端口 |
| `API_TOKEN` | - | API 认证令牌（保护变更接口）|
| `ACTIVE_MARKETS` | - | 启用的市场（逗号分隔，如 `BTC,ETH,SOL,XRP`）|
| `LOG_LEVEL` | `info` | 日志级别（debug/info/warn/error/silent）|
| `PERSIST_BACKEND` | `sqlite` | 存储后端（sqlite/csv/dual）|
| `READ_BACKEND` | `sqlite` | 读取后端（sqlite/csv）|
| `POLYMARKET_SLUG` | - | Polymarket 市场 slug |
| `POLYMARKET_AUTO_SELECT_LATEST` | `true` | 自动选择最新市场 |
| `POLYMARKET_LIVE_WS_URL` | `wss://ws-live-data.polymarket.com` | Polymarket 实时数据 WS |
| `POLYMARKET_UP_LABEL` | `Up` | UP 结果标签 |
| `POLYMARKET_DOWN_LABEL` | `Down` | DOWN 结果标签 |
| `POLYGON_RPC_URL` | `https://polygon-rpc.com` | Polygon RPC 端点 |
| `POLYGON_RPC_URLS` | - | Polygon RPC 端点列表（逗号分隔）|
| `POLYGON_WSS_URL` | - | Polygon WebSocket RPC |
| `POLYGON_WSS_URLS` | - | Polygon WebSocket URL 列表（逗号分隔）|
| `CHAINLINK_BTC_USD_AGGREGATOR` | - | Chainlink BTC/USD 聚合器地址 |
| `HTTPS_PROXY` | - | HTTP 代理 |

> **注意**: 实盘交易需要通过 Web 界面连接钱包（不再支持 `PRIVATE_KEY` 环境变量）

### 策略配置 (`config.json`)

```json
{
  "paper": {
    "risk": {
      "maxTradeSizeUsdc": 5,
      "limitDiscount": 0.05,
      "dailyMaxLossUsdc": 100,
      "maxOpenPositions": 2,
      "minLiquidity": 15000,
      "maxTradesPerWindow": 1
    },
    "initialBalance": 1000
  },
  "live": {
    "risk": {
      "maxTradeSizeUsdc": 5,
      "limitDiscount": 0.05,
      "dailyMaxLossUsdc": 100,
      "maxOpenPositions": 2,
      "minLiquidity": 15000,
      "maxTradesPerWindow": 1
    }
  },
  "strategy": {
    "edgeThresholdEarly": 0.06,
    "edgeThresholdMid": 0.08,
    "edgeThresholdLate": 0.10,
    "minProbEarly": 0.52,
    "minProbMid": 0.55,
    "minProbLate": 0.60,
    "blendWeights": { "vol": 0.50, "ta": 0.50 },
    "regimeMultipliers": {
      "CHOP": 1.3,
      "RANGE": 1.0,
      "TREND_ALIGNED": 0.8,
      "TREND_OPPOSED": 1.2
    },
    "maxGlobalTradesPerWindow": 1,
    "minConfidence": 0.50,
    "skipMarkets": []
  }
}
```

#### 风险参数

| 参数 | 说明 |
|------|------|
| `maxTradeSizeUsdc` | 单笔交易最大金额 (USDC) |
| `limitDiscount` | 限价单折扣（低于市场价）|
| `dailyMaxLossUsdc` | 每日最大亏损限制 |
| `maxOpenPositions` | 最大同时持仓数 |
| `minLiquidity` | 最小市场流动性要求 |
| `maxTradesPerWindow` | 每个15分钟窗口最大交易数 |

#### 策略参数

| 参数 | 说明 |
|------|------|
| `edgeThresholdEarly/Mid/Late` | 各阶段最小边缘要求（>10分钟、5-10分钟、<5分钟）|
| `minProbEarly/Mid/Late` | 各阶段最小模型概率 |
| `blendWeights.vol/ta` | 波动率概率 vs TA 概率权重（默认 50/50）|
| `regimeMultipliers` | 市场状态乘数（CHOP=1.3 表示需要 30% 更多边缘）|
| `minConfidence` | 最小信心评分阈值（0-1）|
| `skipMarkets` | 跳过的市场列表 |
| `maxGlobalTradesPerWindow` | 所有市场每个窗口最大交易数 |

#### 市场特定调整

基于回测表现，对不同市场应用额外边缘乘数（硬编码在 [src/engines/edge.ts](src/engines/edge.ts)）：

| 市场 | 历史胜率 | 边缘乘数 | 特殊规则 |
|------|----------|----------|----------|
| BTC | 42.1% | 1.5x（需 50% 更多边缘）| 跳过 CHOP 状态，最低概率 0.58，最低信心 0.60 |
| ETH | 46.9% | 1.2x（需 20% 更多边缘）| 跳过 CHOP 状态 |
| SOL | 51.0% | 1.0x（标准）| 无 |
| XRP | 54.2% | 1.0x（标准）| 无 |


## 交易逻辑

### 数据流（每秒）

```
1. 数据采集（并行）
   ├─ Binance REST: 240 × 1分钟K线
   ├─ Binance WS: 实时成交价
   ├─ Polymarket WS: Chainlink 当前价
   └─ Polymarket REST: 市场数据 + UP/DOWN 价格 + 订单簿

2. 技术指标
   ├─ Heiken Ashi: K线颜色 + 连续计数
   ├─ RSI(14): 相对强弱 + 斜率
   ├─ MACD(12,26,9): 柱状图 + 柱状图变化量
   ├─ VWAP: 成交量加权平均价 + 斜率
   └─ 波动率: 60K线已实现波动率 × √15

3. 方向评分
   ├─ 价格 vs VWAP: +2 分同方向
   ├─ VWAP 斜率: +2 分同方向
   ├─ RSI + 斜率: 对齐则 +2 分
   ├─ MACD 柱状图: 扩张则 +2 分
   └─ Heiken Ashi: 连续2+则 +1 分
   → rawUp = upScore / (upScore + downScore)

4. 概率融合
   ├─ 波动率隐含: Φ(ln(P/PTB) / (vol × √(t/15)))
   ├─ TA 原始: 步骤3的 rawUp
   └─ 融合: (0.5×vol + 0.5×ta) + 调整

5. 状态检测
   ├─ TREND_UP: 价格>VWAP, VWAP↑, 成交量>均值
   ├─ TREND_DOWN: 价格<VWAP, VWAP↓, 成交量>均值
   ├─ CHOP: 20K线内 VWAP 穿越 >3 次
   └─ RANGE: 默认

6. 边缘计算
   ├─ rawSum = marketYes + marketNo
   ├─ rawSum < 0.98 → 套利机会
   ├─ rawSum > 1.04 → vig 太高，跳过
   └─ edgeUp = modelUp - marketUp

7. 信心评分（5因子加权）
   ├─ 指标对齐 (25%)
   ├─ 波动率分数 (15%)
   ├─ 订单簿分数 (15%)
   ├─ 时机分数 (25%)
   └─ 状态分数 (20%)

8. 交易决策
   ├─ 阶段: EARLY(>10分钟), MID(5-10分钟), LATE(<5分钟)
   ├─ 应用状态乘数到阈值
   ├─ 应用市场特定乘数（BTC 1.5x, ETH 1.2x）
   ├─ 检查过度自信保护（软帽 0.22，硬帽 0.3）
   └─ 满足边缘 ≥ 阈值 AND 概率 ≥ minProb AND 信心 ≥ minConfidence → 入场
```

### 模拟交易结算

15分钟窗口结束时:
- `finalPrice > PTB` → UP 获胜
- `finalPrice < PTB` → DOWN 获胜
- `finalPrice = PTB` → DOWN 获胜（Polymarket 规则）

盈亏计算:
- 盈利: `+size × (1 - buyPrice)`
- 亏损: `-size × buyPrice`

## API 接口

### REST API

| 接口 | 说明 |
|------|------|
| `GET /api/health` | 健康检查（运行时间、内存使用）|
| `GET /api/state` | 完整仪表板状态（市场、钱包、配置、模拟统计）|
| `GET /api/trades?mode=paper&limit=100` | 近期交易记录（支持 paper/live 模式筛选）|
| `GET /api/signals?market=BTC&limit=200` | 近期信号（用于回测分析）|
| `GET /api/paper-stats` | 模拟交易统计 + 交易详情 |
| `PUT /api/config` | 更新策略配置（需要认证）|
| `POST /api/paper/start` | 启动模拟交易 |
| `POST /api/paper/stop` | 停止模拟交易（周期结束后）|
| `POST /api/paper/cancel` | 取消挂起的启动/停止操作 |
| `POST /api/paper/clear-stop` | 清除止损标志 |
| `POST /api/live/connect` | 连接钱包（需要认证）|
| `POST /api/live/disconnect` | 断开钱包连接 |
| `POST /api/live/start` | 启动实盘交易（需先连接钱包）|
| `POST /api/live/stop` | 停止实盘交易 |
| `POST /api/live/cancel` | 取消挂起的启动/停止操作 |

> **注意**: 变更接口（`/api/paper/*`, `/api/live/*`, `/api/config`）需要配置 `API_TOKEN` 环境变量进行保护

### WebSocket

`GET /api/ws` - 实时事件推送（可选认证）

| 事件 | 触发条件 |
|------|----------|
| `state:snapshot` | 每秒市场状态更新（500ms 节流）|
| `signal:new` | 新交易信号生成 |
| `trade:executed` | 交易执行完成 |

### 示例响应: `/api/state`

```json
{
  "markets": [{
    "id": "BTC",
    "label": "BTC",
    "ok": true,
    "spotPrice": 68034,
    "currentPrice": 68034,
    "priceToBeat": 68010,
    "marketUp": 0.66,
    "marketDown": 0.33,
    "rawSum": 0.99,
    "arbitrage": false,
    "predictLong": 0.55,
    "predictShort": 0.45,
    "predictDirection": "LONG",
    "haColor": "green",
    "haConsecutive": 3,
    "rsi": 51.8,
    "macd": {"macd": 12.5, "signal": 10.2, "hist": 2.3, "histDelta": 0.05},
    "vwapSlope": 0.12,
    "timeLeftMin": 8.5,
    "phase": "MID",
    "action": "ENTER",
    "side": "UP",
    "edge": 0.082,
    "strength": "GOOD",
    "reason": null,
    "volatility15m": 0.0045,
    "blendSource": "blended",
    "volImpliedUp": 0.52,
    "binanceChainlinkDelta": 0.001,
    "orderbookImbalance": 0.1,
    "confidence": {
      "score": 0.65,
      "level": "MEDIUM",
      "factors": {
        "indicatorAlignment": 0.75,
        "volatilityScore": 1.0,
        "orderbookScore": 0.6,
        "timingScore": 0.6,
        "regimeScore": 0.7
      }
    }
  }],
  "updatedAt": "2026-02-26T00:00:00.000Z",
  "wallet": {"address": "0x123...", "connected": false},
  "paperDaily": {"date": "2026-02-26", "pnl": 5.2, "trades": 3},
  "liveDaily": {"date": "2026-02-26", "pnl": 0, "trades": 0},
  "config": {
    "strategy": { "edgeThresholdEarly": 0.06, ... },
    "paperRisk": { "maxTradeSizeUsdc": 5, ... },
    "liveRisk": { "maxTradeSizeUsdc": 5, ... }
  },
  "paperRunning": true,
  "liveRunning": false,
  "paperStats": {
    "totalTrades": 5,
    "wins": 3,
    "losses": 2,
    "pending": 0,
    "winRate": 0.6,
    "totalPnl": 1.45
  },
  "paperBalance": {
    "initialBalance": 1000,
    "currentBalance": 1001.45,
    "maxDrawdown": 5.2
  },
  "liveWallet": {
    "address": null,
    "connected": false,
    "clientReady": false
  },
  "paperPendingStart": false,
  "paperPendingStop": false,
  "livePendingStart": false,
  "livePendingStop": false,
  "stopLoss": null,
  "todayStats": {
    "paper": {"date": "2026-02-26", "pnl": 5.2, "trades": 3},
    "live": {"date": "2026-02-26", "pnl": 0, "trades": 0}
  }
}
```

## Web 仪表板

### 功能

- **顶部导航栏**: 模式徽章（模拟/实盘）、钱包连接、实盘交易控制
- **统计卡片**: 交易数、胜率、累计盈亏、最大回撤、今日表现
- **分析标签页**: 累计 P&L 面积图、市场分类柱状图、交易详细记录
- **市场卡片**: 实时价格、预测方向、8个技术指标、交易决策、信心评分
- **交易表格**: 近期交易记录（含模式标识、盈亏状态）
- **实时更新**: WebSocket 连接自动刷新状态

### 技术栈

- [Vite](https://vitejs.dev/) v7 — 构建工具 + 开发服务器
- [React](https://react.dev/) v19 — UI 组件
- [shadcn/ui](https://ui.shadcn.com/) — 组件库
- [recharts](https://recharts.org/) — 图表可视化
- [Tailwind CSS](https://tailwindcss.com/) v4 — 样式
- [wagmi](https://wagmi.sh/) + [viem](https://viem.sh/) — Web3 钱包连接
- [Zustand](https://zustand-demo.pmnd.rs/) — 状态管理
- [TanStack Query](https://tanstack.com/query) — 数据获取

```
├── src/                      # Bot 源代码
│   ├── index.ts              # 主循环, processMarket()
│   ├── trader.ts             # executeTrade(), 钱包连接
│   ├── paperStats.ts         # 模拟交易跟踪 + 结算
│   ├── api.ts                # Hono API 服务器
│   ├── state.ts              # 共享状态管理
│   ├── config.ts             # 配置加载器
│   ├── env.ts                # 环境变量验证（Zod）
│   ├── types.ts              # TypeScript 接口
│   ├── markets.ts            # 市场定义
│   ├── orderManager.ts       # 订单生命周期管理
│   ├── redeemer.ts           # 链上赎回
│   ├── logger.ts             # 结构化日志
│   ├── db.ts                 # SQLite 数据库
│   ├── strategyRefinement.ts # 回测洞察
│   ├── backtest.ts           # 回测分析工具
│   ├── data/                 # 数据源
│   │   ├── binance.ts        # REST API
│   │   ├── binanceWs.ts      # WebSocket
│   │   ├── polymarket.ts     # Gamma + CLOB API
│   │   ├── polymarketLiveWs.ts
│   │   ├── chainlink.ts      # 链上 RPC
│   │   └── chainlinkWs.ts
│   ├── engines/              # 交易逻辑
│   │   ├── probability.ts    # 评分 + 融合
│   │   ├── edge.ts           # 边缘 + 决策 + 信心评分
│   │   └── regime.ts         # 市场状态检测
│   └── indicators/           # TA 指标
│       ├── rsi.ts
│       ├── macd.ts
│       ├── vwap.ts
│       └── heikenAshi.ts
├── web/                      # 前端
│   ├── src/
│   │   ├── main.tsx          # 入口
│   │   ├── components/       # UI 组件
│   │   │   ├── Dashboard.tsx       # 主仪表板
│   │   │   ├── Header.tsx          # 顶部导航栏
│   │   │   ├── MarketCard.tsx      # 单市场卡片
│   │   │   ├── TradeTable.tsx      # 交易记录表格
│   │   │   ├── AnalyticsTabs.tsx   # 分析标签页
│   │   │   ├── StatCard.tsx        # 统计卡片
│   │   │   ├── ConnectWallet.tsx   # 钱包连接
│   │   │   ├── LiveConnect.tsx     # 实盘交易控制
│   │   │   ├── Web3Provider.tsx    # Web3 Provider
│   │   │   └── ChartErrorBoundary.tsx # 图表错误边界
│   │   └── lib/              # 工具函数 + stores
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── data/                     # 运行时数据（SQLite + JSON）
├── config.json               # 策略参数
├── docker-compose.yml
├── Dockerfile
├── package.json
├── .env                      # 环境变量（不提交）
└── .env.example              # 环境变量示例
```

```yaml
services:
  bot:
    build: .
    ports: ["9999:9999"]
    volumes:
      - ./data:/app/data
      - ./config.json:/app/config.json:ro
    environment:
      - PAPER_MODE=${PAPER_MODE:-true}

  web:
    build: ./web
    ports: ["9998:4321"]
    volumes:
      - ./web/src:/app/src      # 热重载
    environment:
      - API_URL=http://bot:9999
    depends_on: [bot]
```

## 开发

### 类型检查

```bash
bun run typecheck      # TypeScript 类型检查
bun run typecheck:ci   # CI 模式类型检查
```

### 测试

```bash
bun run test           # 运行测试
bun run test:watch     # 监听模式运行测试
```

### 代码风格

```bash
bun run lint           # 检查代码风格
bun run lint:fix       # 自动修复代码风格问题
bun run format         # 格式化代码
```

### 构建 Web

```bash
cd web && bun run build
```

### 重建 Docker

```bash
docker compose down
docker compose up --build
```

## 安全

- 默认启用模拟交易（`PAPER_MODE=true`）
- 实盘交易需要 `PAPER_MODE=false` 并通过 Web 界面连接钱包
- 每日亏损限制防止连续亏损
- 最大持仓限制防止过度暴露

## 免责声明

本项目不构成金融建议。交易涉及重大风险。请自行承担风险。

---

## 相关文档

- [Polymarket 官方文档笔记](./docs/POLYMARKET_OFFICIAL_DOCS.md)
