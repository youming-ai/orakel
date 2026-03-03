# 测试文档

本文档梳理 Orakel 项目的测试覆盖范围和测试文件组织。

---

## 目录

1. [测试概览](#1-测试概览)
2. [核心交易引擎](#2-核心交易引擎)
3. [技术指标](#3-技术指标)
4. [数据处理](#4-数据处理)
5. [区块链集成](#5-区块链集成)
6. [工具函数](#6-工具函数)
7. [运行测试](#7-运行测试)

---

## 1. 测试概览

### 测试文件统计

| 类别 | 测试文件数 | 覆盖范围 |
|------|-----------|---------|
| 核心交易引擎 | 5 | 概率、边缘、仓位、套利、费率优化 |
| 技术指标 | 4 | RSI、MACD、Heiken Ashi、VWAP |
| 数据处理 | 3 | Polymarket、Chainlink、缓存 |
| 区块链集成 | 2 | 账户状态、对账、合约 |
| 工具函数 | 2 | 通用工具、策略优化 |
| 市场状态 | 1 | 市场制度检测 |
| **总计** | **17** | |

### 测试组织结构

```
src/
├── __tests__/
│   ├── engines/          # 核心交易引擎测试
│   ├── indicators/       # 技术指标测试
│   ├── data/             # 数据源测试
│   ├── blockchain/       # 区块链集成测试
│   ├── trading/          # 交易逻辑测试
│   └── core/             # 核心工具测试
```

---

## 2. 核心交易引擎

### 2.1 概率引擎 ([probability.test.ts](../src/__tests__/probability.test.ts))

**测试函数：**
- `scoreDirection()` - 技术方向评分
- `computeVolatilityImpliedProb()` - 波动率隐含概率
- `blendProbabilities()` - 概率融合
- `applyAdaptiveTimeDecay()` - 时间衰减

**覆盖场景：**
- VWAP 关系（上/下/中性）
- VWAP 斜率（上升/下降/平坦）
- RSI 极值（超买/超卖/中性）
- MACD 柱状图（正/负/零）
- Heiken Ashi 颜色和连续计数
- 失败 VWAP 收回检测

### 2.2 边缘引擎 ([edge.test.ts](../src/__tests__/edge.test.ts))

**测试函数：**
- `computeConfidence()` - 置信度计算（5因子）
- `computeEdge()` - 边缘计算
- `decide()` - 交易决策逻辑

**覆盖场景：**
- 置信度各因子权重验证
- 订单簿不平衡调整
- 套利检测（sum < 0.98）
- 高 vig 检测（sum > 1.04）
- 市场制度乘数应用

### 2.3 仓位计算 ([positionSizing.test.ts](../src/__tests__/positionSizing.test.ts))

**测试函数：**
- `calculateKellyPositionSize()` - Kelly 公式仓位

**覆盖场景：**
- 有效输入范围
- 胜率 < 50%（做空）
- 胜率 > 50%（做多）
- 概率 = 50%（无信号）
- 胜率 + 赔率 = 1（中性）
- 零除保护

### 2.4 套利检测 ([arbitrage.test.ts](../src/__tests__/arbitrage.test.ts))

**测试函数：**
- `detectArbitrage()` - UP/DOWN 价格套利检测

**覆盖场景：**
- 有效套利机会（sum < 0.98）
- 无套利（sum >= 0.98）
- 零价保护
- 置信度计算
- 时间戳生成

### 2.5 费率优化 ([feeOptimization.test.ts](../src/__tests__/feeOptimization.test.ts))

**测试函数：**
- `selectOrderStrategy()` - 订单策略选择
- `optimizeBuyPrice()` - 买入价优化

**覆盖场景：**
- 阶段基于策略（EARLY/MID/LATE）
- 流动性阈值检查
- 买入价计算

---

## 3. 技术指标

### 3.1 RSI 指标 ([rsi.test.ts](../src/__tests__/rsi.test.ts))

**测试函数：**
- `sma()` - 简单移动平均
- `slopeLast()` - 斜率计算
- `computeRsi()` - RSI(14)

**覆盖场景：**
- SMA 基础计算
- 斜率方向
- RSI 极值（超买/超卖）
- RSI 中性区间

### 3.2 MACD 指标 ([macd.test.ts](../src/__tests__/macd.test.ts))

**测试函数：**
- `computeMacd()` - MACD(12,26,9)

**覆盖场景：**
- 完整 MACD 计算
- 零柱状图保护

### 3.3 Heiken Ashi ([heikenAshi.test.ts](../src/__tests__/heikenAshi.test.ts))

**测试函数：**
- `computeHeikenAshi()` - HA 蜡烛计算
- `countConsecutive()` - 连续计数

**覆盖场景：**
- HA 蜡烛颜色（红/绿）
- 连续计数逻辑

### 3.4 VWAP 指标 ([vwap.test.ts](../src/__tests__/vwap.test.ts))

**测试函数：**
- `computeSessionVwap()` - 会话 VWAP
- `computeVwapSeries()` - VWAP 系列

**覆盖场景：**
- 会话 VWAP 计算
- VWAP 系列斜率
- 斜率方向分类

---

## 4. 数据处理

### 4.1 Polymarket 数据 ([polymarket.test.ts](../src/__tests__/polymarket.test.ts))

**测试函数：**
- `pickLatestLiveMarket()` - 选择最新市场
- `flattenEventMarkets()` - 扁平化事件市场
- `getPriceToBeat()` - 获取价格基准

**覆盖场景：**
- 多市场选择
- 事件市场扁平化
- 价格基准获取

### 4.2 Chainlink 数据 ([chainlinkWs.test.ts](../src/__tests__/chainlinkWs.test.ts))

**测试函数：**
- `hexToSignedBigInt()` - 十六进制转有符号整数

**覆盖场景：**
- 正数转换
- 负数转换（最高位为 1）
- 零值

### 4.3 缓存 ([cache.test.ts](../src/__tests__/cache.test.ts))

**测试函数：**
- `createTtlCache()` - TTL 缓存

**覆盖场景：**
- 基础 get/set/delete
- TTL 过期
- 命中率追踪

---

## 5. 区块链集成

### 5.1 账户状态 ([accountState.test.ts](../src/__tests__/accountState.test.ts))

**测试函数：**
- `updateFromSnapshot()` - 快照更新
- `applyEvent()` - 事件应用

**覆盖场景：**
- 余额快照更新
- 铸造事件
- 赎回事件
- CTF 代币位置追踪

### 5.2 对账 ([reconciler.test.ts](../src/__tests__/reconciler.test.ts))

**测试函数：**
- `statusFromConfidence()` - 置信度转状态
- `rawToUsdc()` - 原始值转 USDC
- `isEventRow()` - 事件行验证
- `isKnownTokenRow()` - 已知代币行验证
- `isTradeRow()` - 交易行验证

**覆盖场景：**
- 置信度阈值（unreconciled/pending/confirmed/disputed）
- Token 数量转 USDC
- 行类型验证

### 5.3 合约 ([contracts.test.ts](../src/__tests__/contracts.test.ts))

**测试函数：**
- ConditionalToken 合约接口
- CTFToken 合约接口

**覆盖场景：**
- 合约地址常量
- ABI 接口

---

## 6. 工具函数

### 6.1 通用工具 ([utils.test.ts](../src/__tests__/utils.test.ts))

**测试函数：**
- `clamp()` - 数值限制
- `getCandleWindowTiming()` - 窗口时间计算

**覆盖场景：**
- 范围限制
- 边界值
- 窗口边界计算

### 6.2 策略优化 ([strategyRefinement.test.ts](../src/__tests__/strategyRefinement.test.ts))

**测试常量：**
- `MARKET_ADJUSTMENTS` - 市场特定调整
- `BACKTEST_INSIGHTS` - 回测洞察

**测试函数：**
- `shouldTakeTrade()` - 交易决策

**覆盖场景：**
- 市场调整系数
- 回测洞察数据
- 交易过滤逻辑

---

## 7. 市场状态

### 7.1 制度检测 ([regime.test.ts](../src/__tests__/regime.test.ts))

**测试函数：**
- `detectRegime()` - 市场制度检测

**覆盖场景：**
- TREND_UP（价格 > VWAP，VWAP 上升）
- TREND_DOWN（价格 < VWAP，VWAP 下降）
- CHOP（VWAP 频繁交叉）
- RANGE（默认状态）

---

## 8. 运行测试

### 8.1 运行所有测试

```bash
bun run test
```

### 8.2 监听模式

```bash
bun run test:watch
```

### 8.3 运行单个测试文件

```bash
bunx vitest run src/__tests__/edge.test.ts
```

### 8.4 运行匹配的测试

```bash
bunx vitest run -t "computeEdge"
```

### 8.5 测试覆盖率

```bash
bunx vitest run --coverage
```

---

## 9. 测试最佳实践

### 9.1 测试组织

```
src/
├── engines/
│   ├── edge.ts
│   └── edge.test.ts          # 与源文件同目录
├── indicators/
│   ├── rsi.ts
│   └── rsi.test.ts
```

### 9.2 测试命名

- 使用 `describe` 分组相关测试
- 测试命名：`should [预期] when [条件]`
- 使用 `describe` 嵌套分组复杂场景

### 9.3 断言风格

```typescript
// 推荐：具体断言
expect(result).toBe(0.06);
expect(result).toBeCloseTo(0.5, 1);

// 避免：通用断言
expect(result).toBeTruthy();
```

### 9.4 测试数据

- 使用固定的时间戳（如 `BASE_NOW_MS`）确保可重复性
- 测试边界值（0、null、极值）
- 测试正常路径和错误路径

---

## 10. 待改进

### 10.1 测试覆盖率缺口

| 模块 | 覆盖率 | 建议 |
|------|--------|------|
| `src/pipeline/` | 低 | 添加集成测试 |
| `src/trading/trader.ts` | 低 | 添加执行流程测试 |
| `src/api.ts` | 无 | 添加 API 端点测试 |
| 前端组件 | 无 | 添加 React 组件测试 |

### 10.2 测试质量

- 移除 `!` 非空断言（linter 警告）
- 增加边界条件测试
- 添加错误场景测试

---

## 11. 相关文档

- [开发与部署指南](./development-and-deployment.md) — 测试命令
- [系统架构](./architecture.md) — 模块关系
- [交易策略](./trading-strategy.md) — 策略逻辑
