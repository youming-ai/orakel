# Orakel 项目文档

## 项目概览

Orakel 是一个针对 Polymarket 15 分钟加密货币涨跌市场的自动化交易机器人，支持 BTC、ETH、SOL、XRP 四个市场。

| 层级 | 技术栈 |
|------|--------|
| 后端 | Bun + TypeScript + Hono + SQLite |
| 前端 | React 19 + Vite + shadcn/ui + Tailwind v4 |

核心能力：模拟交易、实盘交易、实时 Web 仪表板、Docker 部署。

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [系统架构](./architecture.md) | 整体架构、模块关系、数据流 |
| [交易策略](./trading-strategy.md) | 概率模型、边缘计算、信心评分、决策逻辑 |
| [后端](./backend.md) | API 接口、数据库、配置系统、状态管理 |
| [前端](./frontend.md) | 组件架构、状态管理、WebSocket 实时更新 |
| [数据源](./data-sources.md) | Binance、Polymarket、Chainlink 集成 |
| [技术指标](./indicators.md) | RSI、MACD、VWAP、Heiken Ashi |
| [部署指南](./deployment.md) | Docker、CI/CD、环境配置 |
| [Polymarket 官方文档笔记](./POLYMARKET_OFFICIAL_DOCS.md) | Polymarket API 学习笔记 |

---

## 快速开始

详细说明见 [部署指南](./deployment.md)。

**Docker 运行（推荐）**

```bash
docker compose up --build
```

**本地运行**

```bash
# 后端
bun install
bun run start

# 前端（新终端）
cd web && bun install && bun run dev
```

**访问地址**

- Bot API：http://localhost:9999
- Web 前端：http://localhost:9998

---

## 开发命令

| 命令 | 说明 |
|------|------|
| `bun run lint` | Biome 代码检查与格式验证 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run test` | 运行全部单元测试 |
