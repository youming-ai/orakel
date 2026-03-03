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

- **模拟交易** — 实时数据模拟，不使用真实资金
- **实时数据** — Binance WS + Polymarket Chainlink + 链上备选
- **技术分析** — Heiken Ashi、RSI、MACD、VWAP、已实现波动率
- **概率模型** — 波动率隐含概率与 TA 评分融合
- **市场状态** — TREND/RANGE/CHOP 识别与动态阈值
- **Web 仪表板** — React 19 + shadcn/ui + recharts
- **Docker 部署** — docker-compose 一键启动

## 快速开始

### Docker（推荐）

```bash
git clone https://github.com/youming-ai/orakel.git
cd orakel
cp .env.example .env
docker compose up --build
```

### 本地开发

```bash
bun install && cd web && bun install && cd ..
cp .env.example .env

# 终端 1: Bot
bun run start

# 终端 2: Web
cd web && bun run dev
```

- Bot API：http://localhost:9999
- Web 前端：`cd web && bun run dev`（Vite 默认端口）

## 开发

| 命令 | 说明 |
|------|------|
| `bun run lint` | Biome 检查（lint + format）|
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run test` | Vitest 单元测试 |
| `bun run lint:fix` | 自动修复 |
| `cd web && bun run dev` | 前端开发服务器 |

推送前运行：`bun run lint && bun run typecheck && bun run test`

## 配置

- **环境变量**（`.env`）：API 端口、市场选择、RPC 节点等 → 详见 [部署指南](./docs/deployment.md#3-环境变量)
- **策略参数**（`config.json`）：边缘阈值、概率权重、风控规则 → 详见 [交易策略](./docs/trading-strategy.md)
- 默认模拟交易模式（`PAPER_MODE=true`），实盘需在 `.env` 配置 `PRIVATE_KEY`（启动时自动连接钱包）

## 安全

- 默认启用模拟交易（`PAPER_MODE=true`）
- 实盘交易需在 `.env` 配置 `PRIVATE_KEY`（64 位 hex，启动时自动连接）
- 每日亏损限制 + 最大持仓限制

## 文档

| 文档 | 说明 |
|------|------|
| [系统架构](./docs/architecture.md) | 整体架构、模块关系、数据流、设计决策 |
| [交易策略](./docs/trading-strategy.md) | 概率模型、边缘计算、信心评分、决策逻辑 |
| [部署指南](./docs/deployment.md) | Docker、CI/CD、环境配置、VPS 自动部署 |
| [开发与部署](./docs/development-and-deployment.md) | 本地开发、Docker 部署、生产环境完整流程 |
| [Cloudflare Pages 部署](./docs/cloudflare-pages-deployment.md) | 前端部署到 Cloudflare Pages 详细指南 |

## 免责声明

本项目不构成金融建议。交易涉及重大风险。请自行承担风险。
