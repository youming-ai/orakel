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

### 🚀 开发指南

| 文档 | 说明 | 更新时间 |
|------|------|----------|
| [开发路线图](./ROADMAP.md) | 4阶段开发计划，目标胜率58-65%，PnL提升60-120% | 2026-02-26 |
| [任务清单](./TASKS.md) | 60+详细任务，按Phase和Sprint组织 | 2026-02-26 |
| [当前开发计划](./DEVELOPMENT_PLAN.md) | 基于代码审查的9天Sprint计划 | 2026-02-26 |

### 📊 分析报告

| 文档 | 说明 | 更新时间 |
|------|------|----------|
| [深度审查报告](./DEEP_REVIEW.md) | 性能、胜率、利润全面分析+优化方案 | 2026-02-26 |
| [代码审查报告](./CODE_REVIEW.md) | 32项问题按P0-P3分级，含修复方案 | 2026-02-26 |

### 📚 架构文档

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

---

## 🎯 当前开发重点

### Phase 1: 性能优化 (1-2周) 🔴

**目标**: 10×性能提升

- 增量计算系统（RSI、波动率）
- LRU缓存优化
- 代码重构（index.ts瘦身）

**预期收益**:
- 主循环耗时: 200ms → 20ms
- 网络请求: 减少80-90%

### Phase 2: 胜率提升 (2-3周) 🔴

**目标**: 胜率从48.6%提升至58-65%

- 动态阈值系统
- 信号质量模型（KNN）
- 增强状态检测

**预期收益**:
- 胜率: +10-16%
- XRP/SOL保持54%+，BTC/ETH改善

### Phase 3: 利润最大化 (2-3周) 🟡

**目标**: PnL提升60-120%

- 凯利公式仓位管理
- 智能费用优化
- 动态止损/止盈

**预期收益**:
- PnL: $156 → $250-350
- 最大回撤: <15%

### Phase 4: UI/UX优化 (1-2周) 🟢

**目标**: 优秀用户体验

- 实时价格图表
- 信号强度可视化
- 告警系统

**预期收益**:
- 图表更新延迟: <500ms
- Lighthouse分数: >90

---

## 📈 性能指标

### 当前状态

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| 总体胜率 | 48.6% | 58-65% |
| 总PnL | $156.60 | $250-350 |
| 主循环耗时 | ~200ms/秒 | ~20ms/秒 |
| 网络请求 | ~20次/秒 | 2-4次/秒 |

### 市场表现（回测）

| 市场 | 胜率 | 状态 |
|------|------|------|
| XRP | 54.2% | ✅ 最佳 |
| SOL | 51.0% | ✅ 良好 |
| ETH | 46.9% | ⚠️ 需改善 |
| BTC | 42.1% | ❌ 需优化 |

---

## 🔗 相关链接

- [GitHub Repository](https://github.com/yourusername/orakel)
- [Issues](https://github.com/yourusername/orakel/issues)
- [Discussions](https://github.com/yourusername/orakel/discussions)

---

**文档更新**: 2026-02-26
