# 通用策略与多周期回测

## 概述

本系统提供了通用策略设计和多周期回测功能，支持对 BTC-15m 和 ETH-15m 进行策略优化。

## 新增组件

### 1. 策略优化器 (`src/backtest/strategyOptimizer.ts`)

提供参数空间定义、随机参数生成和策略评分功能。

```typescript
// 创建默认参数空间
const space = createDefaultParameterSpace();

// 生成随机参数组合
const configs = generateRandomParameters(space, 100);

// 计算策略得分
const score = calculateStrategyScore(summary, periodDays);
```

### 2. 多周期回测引擎 (`src/backtest/multiPeriodBacktest.ts`)

支持7天、30天、180天的多周期回测。

```typescript
const results = await runMultiPeriodBacktest({
  marketIds: ["BTC-15m", "ETH-15m"],
  periods: [
    { name: "7d", days: 7 },
    { name: "30d", days: 30 },
    { name: "180d", days: 180 }
  ],
  strategy: strategyConfig,
  fillOptions: {
    fillMode: "fixed",
    quoteMode: "fixed",
    quoteScope: "all",
    stakeUsdc: 1,
    slippageBps: 10
  }
});
```

### 3. 策略优化CLI (`src/backtest/optimize.ts`)

自动优化策略参数，找出最优配置。

```bash
# 优化所有市场，100次迭代
bun run optimize --iterations 100

# 优化特定市场
bun run optimize --markets BTC-15m,ETH-15m --iterations 200

# 使用历史数据截止到7天前
bun run optimize --daysAgo 7 --iterations 50

# 保存结果到文件
bun run optimize --output results.json
```

### 4. 多周期回测CLI (`src/backtest/backtest.ts`)

运行单个策略的多周期回测。

```bash
# 使用默认策略回测所有市场
bun run backtest:multi

# 使用特定策略配置
bun run backtest:multi --strategy BTC-15m

# 回测特定市场和周期
bun run backtest:multi --markets BTC-15m --periods 7,30,180

# 使用历史价格数据
bun run backtest:multi --fillMode historical --quoteMode historical
```

## 通用策略配置

已在 `config.json` 中添加 `universal` 策略配置：

```json
{
  "strategy": {
    "universal": {
      "edgeThresholdEarly": 0.04,
      "edgeThresholdMid": 0.065,
      "edgeThresholdLate": 0.09,
      "minProbEarly": 0.55,
      "minProbMid": 0.58,
      "minProbLate": 0.62,
      "minTimeLeftMin": 3,
      "maxTimeLeftMin": 11.5,
      "minVolatility15m": 0.00175,
      "maxVolatility15m": 0.03,
      "candleAggregationMinutes": 2,
      "minPriceToBeatMovePct": 0.001,
      "edgeDownBias": 0.02,
      "minExpectedEdge": 0.05,
      "maxEntryPrice": 0.58
    }
  }
}
```

该配置是BTC-15m和ETH-15m现有参数的加权平均值，适用于两个市场。

## 使用示例

### 示例1：快速回测验证

```bash
# 使用universal策略回测最近7天
bun run backtest:multi --markets BTC-15m,ETH-15m --periods 7 --strategy universal
```

### 示例2：策略优化

```bash
# 优化BTC-15m策略参数
bun run optimize --markets BTC-15m --iterations 100 --output btc_optimized.json

# 优化ETH-15m策略参数
bun run optimize --markets ETH-15m --iterations 100 --output eth_optimized.json
```

### 示例3：生成通用策略

```bash
# 同时优化BTC和ETH，自动生成通用策略
bun run optimize --markets BTC-15m,ETH-15m --iterations 200 --output universal_strategy.json
```

输出将包含：
- 每个市场的最优参数
- 基于两个市场平均的通用策略配置
- 通用策略的回测验证结果

## 参数说明

### 策略参数

| 参数 | 描述 | 默认值 |
|------|------|--------|
| edgeThresholdEarly | 早期阶段Edge阈值 | 0.04 |
| edgeThresholdMid | 中期阶段Edge阈值 | 0.065 |
| edgeThresholdLate | 晚期阶段Edge阈值 | 0.09 |
| minProbEarly | 早期最小概率 | 0.55 |
| minProbMid | 中期最小概率 | 0.58 |
| minProbLate | 晚期最小概率 | 0.62 |
| minTimeLeftMin | 最小剩余时间(分钟) | 3 |
| maxTimeLeftMin | 最大剩余时间(分钟) | 11.5 |
| minVolatility15m | 最小15分钟波动率 | 0.00175 |
| maxVolatility15m | 最大15分钟波动率 | 0.03 |
| candleAggregationMinutes | 蜡烛聚合分钟数 | 2 |
| minPriceToBeatMovePct | 最小价格变动百分比 | 0.001 |
| minExpectedEdge | 最小预期Edge | 0.05 |
| maxEntryPrice | 最大入场价格 | 0.58 |
| edgeDownBias | Edge下行偏置 | 0.02 |

### 回测参数

| 参数 | 描述 | 可选值 |
|------|------|--------|
| fillMode | 成交价格模式 | fixed, historical |
| quoteMode | 报价模式 | fixed, historical |
| quoteScope | 报价范围 | all, traded |
| stakeUsdc | 每笔交易金额 | > 0 |
| slippageBps | 滑点(BPS) | >= 0 |

## 评分算法

策略评分综合考虑以下因素：

1. **胜率权重**: winRate * 100
2. **盈亏调整**: avgPnl * 10
3. **交易频率**: 适中频率奖励 +5
4. **胜率惩罚**: 胜率 < 45% 惩罚 -30
5. **负盈亏惩罚**: 总盈亏 < 0 惩罚 -20

多周期评分权重：
- 7天: 30%
- 30天: 40%
- 180天: 30%

## 数据源

- **Binance**: 历史K线数据 (BTCUSDT, ETHUSDT)
- **Bybit**: 多交易所价格验证 (集成中)

## 注意事项

1. 回测使用Binance历史数据，假设Polymarket价格固定为0.5（简化模型）
2. 优化过程可能需要较长时间（100次迭代约需10-30分钟）
3. 建议定期重新优化策略以适应市场变化
4. 通用策略是BTC和ETH参数的折中，可能不是单个市场的最优解

## 后续改进

1. 集成历史Polymarket价格数据提高回测准确性
2. 添加更多技术指标和策略变体
3. 实现遗传算法优化
4. 支持更多时间周期（1h, 4h, 1d）
5. 添加风险指标（最大回撤、夏普比率等）
