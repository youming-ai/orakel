# Orakel 文档索引

> 最后更新：2026-02-26

## 📑 文档分类

### 🆕 新增文档 (2026-02-26)

| 文档 | 说明 | 优先级 |
|------|------|--------|
| [README.md](./README.md) | 项目概览 + 快速开始 | ⭐⭐⭐ |
| [ROADMAP.md](./ROADMAP.md) | 4阶段开发路线图 | ⭐⭐⭐ |
| [TASKS.md](./TASKS.md) | 60+详细任务清单 | ⭐⭐⭐ |
| [DEEP_REVIEW.md](./DEEP_REVIEW.md) | 深度技术审查报告 | ⭐⭐⭐ |

### 📊 分析报告

| 文档 | 说明 | 用途 |
|------|------|------|
| [CODE_REVIEW.md](./CODE_REVIEW.md) | 32项问题分级审查 | 安全修复优先级 |
| [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) | 9天Sprint开发计划 | 当前开发参考 |

### 🏗️ 架构文档

| 文档 | 说明 | 目标读者 |
|------|------|----------|
| [architecture.md](./architecture.md) | 系统架构 + 数据流 | 开发者 |
| [trading-strategy.md](./trading-strategy.md) | 交易策略详解 | 策略研究员 |
| [backend.md](./backend.md) | 后端API + 数据库 | 后端开发者 |
| [frontend.md](./frontend.md) | 前端组件 + 状态管理 | 前端开发者 |

### 🔧 技术文档

| 文档 | 说明 | 目标读者 |
|------|------|----------|
| [data-sources.md](./data-sources.md) | Binance/Polymarket/Chainlink集成 | 数据工程师 |
| [indicators.md](./indicators.md) | 技术指标实现 | 量化开发者 |
| [deployment.md](./deployment.md) | Docker部署指南 | 运维工程师 |
| [POLYMARKET_OFFICIAL_DOCS.md](./POLYMARKET_OFFICIAL_DOCS.md) | Polymarket API笔记 | 集成开发者 |

---

## 🚀 快速导航

### 我想了解...

#### 项目概况
👉 先看 [README.md](./README.md)

#### 如何开始开发
👉 看 [ROADMAP.md](./ROADMAP.md) + [TASKS.md](./TASKS.md)

#### 当前有哪些问题需要修复
👉 看 [CODE_REVIEW.md](./CODE_REVIEW.md) 的P0部分

#### 性能优化方案
👉 看 [DEEP_REVIEW.md](./DEEP_REVIEW.md) 的性能优化分析部分

#### 如何提升胜率
👉 看 [DEEP_REVIEW.md](./DEEP_REVIEW.md) 的胜率提升策略部分

#### 如何增加利润
👉 看 [DEEP_REVIEW.md](./DEEP_REVIEW.md) 的利润最大化方案部分

#### 交易策略原理
👉 看 [trading-strategy.md](./trading-strategy.md)

#### 系统架构
👉 看 [architecture.md](./architecture.md)

#### 如何部署
👉 看 [deployment.md](./deployment.md)

---

## 📋 按角色分类的文档推荐

### 🎯 项目经理/产品负责人
- [README.md](./README.md) - 项目概览
- [ROADMAP.md](./ROADMAP.md) - 开发路线图
- [TASKS.md](./TASKS.md) - 任务清单

### 👨‍💻 后端开发者
- [architecture.md](./architecture.md) - 系统架构
- [backend.md](./backend.md) - 后端详细文档
- [data-sources.md](./data-sources.md) - 数据源集成
- [CODE_REVIEW.md](./CODE_REVIEW.md) - 代码问题

### 👩‍💻 前端开发者
- [frontend.md](./frontend.md) - 前端详细文档
- [README.md](./README.md) - 快速开始

### 📊 量化策略研究员
- [trading-strategy.md](./trading-strategy.md) - 交易策略
- [indicators.md](./indicators.md) - 技术指标
- [DEEP_REVIEW.md](./DEEP_REVIEW.md) - 优化方案

### 🛠️ 运维工程师
- [deployment.md](./deployment.md) - 部署指南
- [README.md](./README.md) - 快速开始

---

## 🔍 文档搜索技巧

### 按关键词搜索

| 关键词 | 相关文档 |
|--------|----------|
| 性能 | ROADMAP.md, DEEP_REVIEW.md, CODE_REVIEW.md |
| 胜率 | ROADMAP.md, DEEP_REVIEW.md, trading-strategy.md |
| 利润 | ROADMAP.md, DEEP_REVIEW.md |
| 任务 | TASKS.md, DEVELOPMENT_PLAN.md |
| 架构 | architecture.md, backend.md, frontend.md |
| 部署 | deployment.md, README.md |
| 策略 | trading-strategy.md, indicators.md |
| 数据 | data-sources.md |

---

## 📝 文档维护

### 更新频率

| 文档类型 | 更新频率 |
|----------|----------|
| ROADMAP.md | 每Phase结束 |
| TASKS.md | 每周更新进度 |
| DEEP_REVIEW.md | 重大变更时 |
| README.md | 每月 |
| 技术文档 | 按需更新 |

### 贡献指南

1. 更新文档时更新文档顶部的时间戳
2. 保持文档格式一致
3. 代码示例使用实际代码
4. 添加相关文档的交叉引用

---

## 🗂️ 文件结构

```
docs/
├── README.md                          # 项目概览（从这里开始）
├── INDEX.md                           # 本文档（文档索引）
├── ROADMAP.md                         # 开发路线图
├── TASKS.md                           # 任务清单
├── DEEP_REVIEW.md                     # 深度审查报告
├── CODE_REVIEW.md                     # 代码审查报告
├── DEVELOPMENT_PLAN.md                # 当前开发计划
├── architecture.md                    # 系统架构
├── trading-strategy.md                # 交易策略
├── backend.md                         # 后端文档
├── frontend.md                        # 前端文档
├── data-sources.md                    # 数据源
├── indicators.md                      # 技术指标
├── deployment.md                      # 部署指南
├── POLYMARKET_OFFICIAL_DOCS.md        # Polymarket笔记
└── archive/                           # 归档文档
```

---

**有问题？** 查看 [README.md](./README.md) 或提 issue
