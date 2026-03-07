# Orakel Documentation

欢迎来到 Orakel 文档中心。这里包含项目的完整技术文档，从架构设计到部署运维。

## 📚 文档索引

### 核心文档

| 文档 | 描述 | 适合读者 |
|------|------|----------|
| [Core Logic](./core-logic.md) | 交易逻辑、架构设计、数据流、决策引擎 | 想理解交易策略的开发者 |
| [Backend Reference](./backend.md) | 后端模块结构、API 端点、数据库设计、运行时架构 | 后端开发者 |
| [Frontend](./frontend.md) | React 组件架构、状态管理、WebSocket、样式指南 | 前端开发者 |
| [Deployment](./deployment.md) | Docker 部署、CI/CD、环境配置、VPS 自动部署 | 运维/DevOps |
| [Testing](./testing.md) | 测试覆盖、测试组织方式、运行测试指南 | 所有开发者 |

### API 规范

| 文档 | 描述 |
|------|------|
| [API Conventions](./api-conventions.md) | REST API 设计规范、错误处理、响应格式 |

### 项目规划

- [plans/](./plans/) - 历史版本规划和迭代记录

## 🚀 快速导航

### 我是新用户，想快速上手

1. 先看项目根目录的 [README.md](../README.md) - 快速启动指南
2. 阅读 [Deployment](./deployment.md) - 部署你的第一个实例

### 我想理解交易逻辑

1. [Core Logic](./core-logic.md) - 完整的策略架构
2. [Backend Reference](./backend.md) - 模块边界和运行时

### 我想开发/修改功能

1. [API Conventions](./api-conventions.md) - 确保接口一致性
2. [Testing](./testing.md) - 了解测试要求
3. [Backend](./backend.md) 或 [Frontend](./frontend.md) - 根据你的领域

### 我要排查问题

1. [Core Logic](./core-logic.md) - 理解数据流
2. [Backend](./backend.md) - 查看日志位置和调试方法
3. [Testing](./testing.md) - 运行相关测试

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (Frontend)                       │
│  React 19 + Vite + TanStack Query + Zustand + shadcn/ui     │
│  [frontend.md](./frontend.md)                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket / REST
┌─────────────────────────────────────────────────────────────┐
│                        后端 (Backend)                        │
│  Hono API Server                                            │
│  ├─ 交易运行时 (Trading Runtime)                              │
│  ├─ 市场数据处理 (Market Pipeline)                            │
│  ├─ 订单管理 (Order Management)                               │
│  └─ 区块链交互 (Blockchain)                                   │
│  [backend.md](./backend.md)                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据层 (Data Layer)                     │
│  PostgreSQL (Drizzle ORM)                                   │
│  Binance WebSocket + Chainlink + Polymarket CLOB            │
│  [core-logic.md](./core-logic.md)                           │
└─────────────────────────────────────────────────────────────┘
```

## 📝 文档贡献指南

- 所有技术决策都应该在 [Core Logic](./core-logic.md) 中记录设计理由
- API 变更必须同步更新 [Backend](./backend.md) 和 [API Conventions](./api-conventions.md)
- 新功能需要添加对应的测试文档到 [Testing](./testing.md)

## 🔗 外部链接

- [Polymarket 文档](https://docs.polymarket.com/)
- [Binance API 文档](https://binance-docs.github.io/apidocs/)
- [Chainlink 数据源](https://data.chain.link/)

---

最后更新：2025年3月
