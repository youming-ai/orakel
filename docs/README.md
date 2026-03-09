# Orakel Documentation

> **Polymarket Crypto Up/Down 自动交易机器人** - Bun + TypeScript + Hono + PostgreSQL (后端), React 19 + Vite (前端)

## 快速开始

```bash
git clone https://github.com/youming-ai/orakel.git
cd orakel
cp .env.example .env
docker compose up --build
```

- Dashboard: http://localhost:9998
- Bot API: http://localhost:9999

## 项目结构

```
src/
├── app/                    # API 服务器、WebSocket、启动/关闭
├── runtime/                # 交易运行时 (主循环、结算周期)
├── repositories/           # 数据访问层 (Drizzle ORM)
├── trading/                # 交易执行、账户统计、订单管理
├── pipeline/               # 市场数据处理 (获取 → 计算)
├── engines/                # 决策引擎 (边缘计算、概率、市场状态)
├── indicators/             # 技术指标 (RSI, MACD, VWAP, Heiken Ashi)
├── data/                   # 外部数据适配器 (Binance, Polymarket, Chainlink)
├── db/                     # 数据库配置和 Schema
└── __tests__/              # 测试文件

web/                        # 前端 (React 19 + Vite + shadcn/ui)
docs/                       # 本文档
drizzle/                    # 数据库迁移
```

## 核心架构

### 数据流

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Binance WS │    │ Chainlink   │    │ Polymarket  │    │  PostgreSQL │
│  价格/蜡烛图 │    │ 预言机价格   │    │  赔率/CLOB  │    │  持久化存储  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │                  │
       └──────────────────┴──────────────────┴──────────────────┘
                          │
                          ▼
               ┌─────────────────────┐
               │   processMarket()   │  ← 1秒周期
               │  - 获取市场数据      │
               │  - 计算指标 (VWAP,RSI,MACD)
               │  - 概率评分 + 边缘计算
               │  - 交易决策          │
               └──────────┬──────────┘
                          │
           ┌──────────────┴──────────────┐
           │                             │
           ▼                             ▼
    ┌─────────────┐              ┌─────────────┐
    │ Paper 交易   │              │ Live 交易    │
    │ (模拟执行)   │              │ (CLOB订单)   │
    └─────────────┘              └─────────────┘
```

### 交易决策流程

1. **技术指标** (`indicators/`)
   - VWAP - 量价锚点
   - RSI(14) - 动量强度
   - MACD - 趋势确认
   - Heiken Ashi - 噪声过滤

2. **概率模型** (`engines/probability.ts`)
   - 技术评分 + 时间衰减
   - `priceToBeat` 距离/波动率模型
   - 混合概率: 65% PTB + 35% TA

3. **边缘计算** (`engines/edge.ts`)
   - `edge = modelProb - marketProb`
   - 订单簿滑点调整
   - 三阶段阈值: Early(0.06) / Mid(0.08) / Late(0.10)

4. **风险管理**
   - 日亏损限制 (`dailyMaxLossUsdc`)
   - 最大回撤 (50%)
   - 市场状态过滤 (TREND/RANGE/CHOP)

## 配置

### 环境变量 (.env)

| 变量 | 说明 |
|------|------|
| `PAPER_MODE` | 启动时启用模拟交易 |
| `API_TOKEN` | API 认证令牌 |
| `PRIVATE_KEY` | 钱包私钥 (实盘交易) |
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `ACTIVE_MARKETS` | 启用市场 (如 `BTC-15m,ETH-15m`) |

### 策略配置 (config.json)

热重载支持，无需重启：

```json
{
  "strategy": {
    "edgeThresholdEarly": 0.06,
    "edgeThresholdMid": 0.08,
    "edgeThresholdLate": 0.10,
    "minConfidence": 0.5
  },
  "risk": {
    "dailyMaxLossUsdc": 100,
    "maxOpenPositions": 5
  }
}
```

## 开发命令

```bash
# 后端
bun install
bun run dev              # Bot + Dashboard 并发启动
bun run start            # 仅启动 Bot (port 9999)
bun run typecheck        # TypeScript 检查
bun run lint             # Biome 检查
bun run test             # Vitest 测试

# 前端
cd web && bun install
bun run dev              # Vite dev server (port 5173)

# 数据库
bunx drizzle-kit generate  # 生成迁移
bunx drizzle-kit migrate   # 应用迁移
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/index.ts` | 入口点，主循环，启动流程 |
| `src/pipeline/processMarket.ts` | 市场处理管道 |
| `src/engines/edge.ts` | 边缘计算 + 交易决策 |
| `src/trading/trader.ts` | 交易执行 (Paper/Live) |
| `src/app/api/routes.ts` | API 路由定义 |
| `src/db/schema.ts` | 数据库表结构 |

## 测试

测试集中放在 `src/__tests__/`：

```bash
bun run test                    # 全部测试
bunx vitest run src/__tests__/edge.test.ts   # 单个文件
bunx vitest run -t "computeEdge"             # 匹配名称
```

当前测试覆盖: **17 个文件, 313 个测试**

## 部署

### Docker (推荐)

```bash
docker compose up --build
```

### CI/CD

GitHub Actions 工作流：
1. Lint (`bunx biome lint`)
2. Typecheck (`bunx tsc --noEmit`)
3. Test (`bun run test`)
4. Docker 构建

预提交检查：`bun run lint && bun run typecheck && bun run test`

## 文档导航

- 根目录 `README.md` - 项目概览和快速开始
- `AGENTS.md` - AI 代理上下文和代码规范
- 本文档 - 技术架构和开发指南

## 许可证

MIT
