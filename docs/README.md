# Orakel Documentation

> **Polymarket Crypto Up/Down 自动交易机器人** - Bun + TypeScript + Hono + PostgreSQL (后端), React 19 + Vite (前端)

## 快速开始

```bash
cd orakel
cp .env.example .env
docker compose up --build
```

- Dashboard: http://localhost:9998
- Bot API: http://localhost:9999

## 项目结构

```
packages/
├── shared/                 # @orakel/shared — 共享类型和合约
│   └── src/contracts/      # TypeScript 接口 + Zod schemas
├── bot/                    # @orakel/bot — 交易机器人后端
│   ├── src/
│   │   ├── app/            # API 服务器、WebSocket、启动/关闭
│   │   ├── runtime/        # 交易运行时 (主循环、结算周期)
│   │   ├── repositories/   # 数据访问层 (Drizzle ORM)
│   │   ├── trading/        # 交易执行、账户统计、订单管理
│   │   ├── pipeline/       # 市场数据处理 (获取 → 计算)
│   │   ├── engines/        # 决策引擎 (边缘计算、概率、市场状态)
│   │   ├── indicators/     # 技术指标 (RSI, MACD, VWAP, Heiken Ashi)
│   │   ├── data/           # 外部数据适配器 (Binance, Polymarket, Chainlink)
│   │   ├── db/             # 数据库配置和 Schema
│   │   └── __tests__/      # 测试文件
│   └── scripts/            # 实用脚本
└── web/                    # @orakel/web — 前端仪表板
    ├── src/
    │   ├── components/     # React 组件 + shadcn/ui
    │   ├── lib/            # API 客户端、状态管理、工具函数
    │   ├── hooks/          # 自定义 React hooks
    │   └── widgets/        # 页面级组件
    └── wrangler.toml       # Cloudflare Workers 配置

docs/                       # 本文档
drizzle/                    # 数据库迁移
config.json                 # 策略配置 (热重载)
```

## 核心架构

### 数据流

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Binance WS  │    │ Chainlink   │    │ Polymarket  │    │  PostgreSQL │
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

1. **技术指标** (`packages/bot/src/indicators/`)
   - VWAP - 量价锚点
   - RSI(14) - 动量强度
   - MACD - 趋势确认
   - Heiken Ashi - 噪声过滤

2. **概率模型** (`packages/bot/src/engines/probability.ts`)
   - 技术评分 + 时间衰减
   - `priceToBeat` 距离/波动率模型
   - 混合概率: 65% PTB + 35% TA

3. **边缘计算** (`packages/bot/src/engines/edge.ts`)
   - `edge = modelProb - marketProb`
   - 微调偏差: 订单簿不平衡 + 现货-预言机价格偏差
   - 三阶段阈值: Early(0.04) / Mid(0.07) / Late(0.10)

4. **执行与风险**
   - Maker/Taker 价格分离 (限价单 vs 最差成交容忍度)
   - 预期 PnL 门槛: 拒绝费后期望值为负的交易
   - 名义流动性门控 (bidNotional/askNotional，非原始份额数)
   - 风险 = 已实现亏损 + 持仓最大潜在亏损
   - 日亏损限制 (`dailyMaxLossUsdc`)
   - Hold-to-settle 策略: 持仓至窗口结算

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
# 从仓库根目录
bun install              # 安装所有工作区依赖
bun run dev              # Bot + Dashboard 并发启动
bun run start            # 仅启动 Bot (port 9999)
bun run typecheck        # TypeScript 检查 (所有包)
bun run lint             # Biome 检查 (所有包)
bun run test             # Vitest 测试 (bot 包)
bun run check:ci         # 完整 CI 检查

# 单独包命令
cd packages/bot && bun run dev        # Bot 开发模式 (带监视)
cd packages/bot && bun run typecheck:ci  # 不含测试的类型检查
cd packages/web && bun run dev        # Web 开发服务器 (port 5173)
cd packages/web && bun run build      # 构建前端生产版本
cd packages/web && bun run deploy     # 部署到 Cloudflare Workers

# 数据库
bunx drizzle-kit generate  # 生成迁移
bunx drizzle-kit migrate   # 应用迁移
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `packages/bot/src/index.ts` | 入口点，主循环，启动流程 |
| `packages/bot/src/pipeline/processMarket.ts` | 市场处理管道 |
| `packages/bot/src/engines/edge.ts` | 边缘计算 + 交易决策 |
| `packages/bot/src/trading/trader.ts` | 交易执行 (Paper/Live) |
| `packages/bot/src/app/api/routes.ts` | API 路由定义 |
| `packages/bot/src/db/schema.ts` | 数据库表结构 |
| `packages/shared/src/contracts/` | 共享 DTO 和类型 |

## 测试

测试集中放在 `packages/bot/src/__tests__/`：

```bash
bun run test                    # 全部测试
bunx vitest run packages/bot/src/__tests__/edge.test.ts   # 单个文件
bunx vitest run -t "computeEdge" --config packages/bot/vitest.config.ts  # 匹配名称
```

当前测试覆盖: **33 个文件, 394 个测试**

## 部署

### Docker (后端 VPS)

```bash
docker compose up --build
```

### Cloudflare Workers (前端)

```bash
cd packages/web
wrangler login              # 首次登录
wrangler secret put API_URL # 设置 API 端点
bun run deploy              # 部署
```

### CI/CD

GitHub Actions 工作流：
1. Lint (`bun run lint`)
2. Typecheck (`bun run typecheck`)
3. Test (`bun run test`)
4. Docker 构建

预提交检查：`bun run check:ci`

## 文档导航

- 根目录 `README.md` - 项目概览和快速开始
- `AGENTS.md` - AI 代理上下文和代码规范
- `docs/ARCHITECTURE_REVIEW.md` - 系统架构详细评估
- `docs/BACKTEST.md` - 回测系统文档
- 本文档 - 技术架构和开发指南
