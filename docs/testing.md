# 测试文档

本文档梳理 Orakel 项目的测试覆盖范围和测试文件组织。

---

## 目录

1. [测试概览](#1-测试概览)
2. [核心交易引擎](#2-核心交易引擎)
3. [技术指标](#3-技术指标)
4. [数据处理](#4-数据处理)
5. [区块链集成](#5-区块链集成)
6. [运行测试](#6-运行测试)

---

## 1. 测试概览

### 测试文件统计

| 类别 | 测试文件数 | 测试数量 |
|------|-----------|---------|
| 核心交易引擎 | 3 | 106 |
| 技术指标 | 4 | 91 |
| 数据处理 | 3 | 71 |
| 区块链集成 | 3 | 30 |
| **总计** | **13** | **298** |

### 测试组织结构

```
src/
├── __tests__/
│   ├── engines/          # 核心交易引擎测试
│   ├── indicators/       # 技术指标测试
│   ├── data/             # 数据源测试
│   └── blockchain/       # 区块链集成测试
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

**测试数量：** 36

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

**测试数量：** 49

### 2.3 套利检测 ([arbitrage.test.ts](../src/__tests__/arbitrage.test.ts))

**测试函数：**
- `detectArbitrage()` - UP/DOWN 价格套利检测

**覆盖场景：**
- 有效套利机会（sum < 0.98）
- 无套利（sum >= 0.98）
- 零价保护
- 置信度计算
- 时间戳生成

**测试数量：** 21

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

**测试数量：** 36

### 3.2 MACD 指标 ([macd.test.ts](../src/__tests__/macd.test.ts))

**测试函数：**
- `computeMacd()` - MACD(12,26,9)

**覆盖场景：**
- 完整 MACD 计算
- 零柱状图保护

**测试数量：** 13

### 3.3 Heiken Ashi ([heikenAshi.test.ts](../src/__tests__/heikenAshi.test.ts))

**测试函数：**
- `computeHeikenAshi()` - HA 蜡烛计算
- `countConsecutive()` - 连续计数

**覆盖场景：**
- HA 蜡烛颜色（红/绿）
- 连续计数逻辑

**测试数量：** 25

### 3.4 VWAP 指标 ([vwap.test.ts](../src/__tests__/vwap.test.ts))

**测试函数：**
- `computeSessionVwap()` - 会话 VWAP
- `computeVwapSeries()` - VWAP 系列

**覆盖场景：**
- 会话 VWAP 计算
- VWAP 系列斜率
- 斜率方向分类

**测试数量：** 17

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

**测试数量：** 51

### 4.2 Chainlink 数据 ([chainlinkWs.test.ts](../src/__tests__/chainlinkWs.test.ts))

**测试函数：**
- `hexToSignedBigInt()` - 十六进制转有符号整数

**覆盖场景：**
- 正数转换
- 负数转换（最高位为 1）
- 零值

**测试数量：** 15

### 4.3 缓存 ([cache.test.ts](../src/__tests__/cache.test.ts))

**测试函数：**
- `createTtlCache()` - TTL 缓存

**覆盖场景：**
- 基础 get/set/delete
- TTL 过期
- 命中率追踪

**测试数量：** 5

---

## 5. 区块链集成

### 5.1 账户状态 ([accountState.test.ts](../src/__tests__/accountState.test.ts))

**测试函数：**
- `initAccountState()` - 初始化账户状态
- `updateFromSnapshot()` - 从快照更新
- `applyEvent()` - 应用链上事件
- `enrichPosition()` - 仓位信息丰富
- `resetAccountState()` - 重置状态

**覆盖场景：**
- USDC 余额更新
- CTF 代币仓位追踪
- 链上事件应用（转账、单次转账）
- 仓位信息丰富
- 账户摘要获取

**测试数量：** 9

### 5.2 对账逻辑 ([reconciler.test.ts](../src/__tests__/reconciler.test.ts))

**测试函数：**
- `statusFromConfidence()` - 置信度转对账状态
- `rawToUsdc()` - 代币原始值转 USDC
- `isEventRow()` - 事件行类型检查
- `isKnownTokenRow()` - 已知代币行类型检查
- `isTradeRow()` - 交易行类型检查

**覆盖场景：**
- 对账状态分类（已确认/待处理/未对账/有争议）
- 代币金额转换（不同小数位数）
- 数据库行类型验证

**测试数量：** 16

### 5.3 合约常量 ([contracts.test.ts](../src/__tests__/contracts.test.ts))

**测试函数：**
- 合约地址验证
- 代币精度常量

**覆盖场景：**
- CTF 合约地址格式
- USDC-E 合约地址格式
- USDC 精度（6 位小数）

**测试数量：** 5

---

## 6. 运行测试

### 6.1 运行所有测试

```bash
bun run test
```

**当前结果：**
```
✓ 13 passed (298 tests)
Duration: ~1.7s
```

### 6.2 监听模式

```bash
bun run test:watch
```

### 6.3 运行单个测试文件

```bash
bunx vitest run src/__tests__/edge.test.ts
```

### 6.4 运行匹配的测试

```bash
bunx vitest run -t "computeEdge"
```

### 6.5 测试覆盖率

```bash
bunx vitest run --coverage
```

---

## 7. 测试文件清单

| 文件 | 类别 | 测试数 | 说明 |
|------|------|--------|------|
| `probability.test.ts` | 核心引擎 | 36 | 概率模型、方向评分、时间衰减 |
| `edge.test.ts` | 核心引擎 | 49 | 边缘计算、置信度、交易决策 |
| `arbitrage.test.ts` | 核心引擎 | 21 | 套利检测 |
| `rsi.test.ts` | 技术指标 | 36 | RSI、SMA、斜率 |
| `macd.test.ts` | 技术指标 | 13 | MACD 计算 |
| `heikenAshi.test.ts` | 技术指标 | 25 | HA 蜡烛、连续计数 |
| `vwap.test.ts` | 技术指标 | 17 | VWAP 系列、斜率 |
| `polymarket.test.ts` | 数据处理 | 51 | Polymarket 数据解析 |
| `chainlinkWs.test.ts` | 数据处理 | 15 | Chainlink 价格转换 |
| `cache.test.ts` | 数据处理 | 5 | TTL 缓存 |
| `accountState.test.ts` | 区块链 | 9 | 账户状态管理 |
| `reconciler.test.ts` | 区块链 | 16 | 对账逻辑、类型检查 |
| `contracts.test.ts` | 区块链 | 5 | 合约地址、常量 |

---

## 8. 测试最佳实践

### 8.1 测试组织

测试文件与源文件同目录（如有），或统一放在 `__tests__` 目录。

### 8.2 测试命名

- 使用 `describe` 分组相关测试
- 测试命名：`should [预期] when [条件]`
- 使用 `describe` 嵌套分组复杂场景

### 8.3 断言风格

```typescript
// 推荐：具体断言
expect(result).toBe(0.06);
expect(result).toBeCloseTo(0.5, 1);

// 避免：通用断言
expect(result).toBeTruthy();
```

### 8.4 测试数据

- 使用固定的时间戳（如 `BASE_NOW_MS`）确保可重复性
- 测试边界值（0、null、极值）
- 测试正常路径和错误路径

### 8.5 区块链测试注意事项

- **避免数据库依赖**：将纯工具函数提取到独立模块（如 `reconciler-utils.ts`）
- **使用 snake_case**：数据库行类型使用 snake_case 属性名
- **类型守卫**：类型守卫只检查最小必需字段，不做完整验证
- **测试隔离**：使用 `beforeEach`/`afterEach` 确保测试间状态独立

---

## 9. 相关文档

- [开发与部署指南](./development-and-deployment.md) — 测试命令
- [系统架构](./architecture.md) — 模块关系
- [交易策略](./trading-strategy.md) — 策略逻辑
