# 交易策略

本文档详细描述 Orakel 自动交易机器人的完整交易策略，涵盖概率估算、边缘计算、市场状态检测、信心评分及决策逻辑的所有公式与阈值。

---

## 1. 策略概览

系统采用三引擎架构，每秒对每个市场执行一次完整的决策循环，针对 Polymarket 15 分钟加密货币涨跌市场进行交易。

**三引擎架构：**

- **概率引擎** (`src/engines/probability.ts`)：融合技术分析评分与波动率隐含概率，输出模型对 UP/DOWN 的概率估算
- **市场状态引擎** (`src/engines/regime.ts`)：检测当前市场所处状态（趋势/震荡/混沌），调整决策阈值
- **边缘引擎** (`src/engines/edge.ts`)：计算模型概率与市场报价之间的差值（边缘），结合信心评分输出最终交易决策

**执行周期：** 每 1 秒 / 每市场，基于 15 分钟窗口数据

---

## 2. 概率引擎 (src/engines/probability.ts)

### 2.1 技术分析评分 (scoreDirection)

对 UP 和 DOWN 方向分别从 6 个指标累积得分，最终计算原始方向概率。

| 指标 | UP 条件 | DOWN 条件 | 分数 |
|------|---------|-----------|------|
| 价格 vs VWAP | price > vwap | price < vwap | +2 |
| VWAP 斜率 | slope > 0 | slope < 0 | +2 |
| RSI + 斜率 | RSI > 55 且 slope > 0 | RSI < 45 且 slope < 0 | +2 |
| MACD 柱状图 | hist > 0 且 delta > 0（扩张） | hist < 0 且 delta < 0 | +2 |
| MACD 水平 | macd > 0 | macd < 0 | +1 |
| Heiken Ashi | 连续绿 >= 2 | 连续红 >= 2 | +1 |
| VWAP 失败回收 | — | 价格未能回到 VWAP | +3 |

**原始概率公式：**

```
rawUp = upScore / (upScore + downScore)
```

### 2.2 波动率隐含概率 (computeVolatilityImpliedProb)

采用类 Black-Scholes 框架，基于当前价格与目标价格（priceToBeat）的关系，结合剩余时间和波动率，计算价格在窗口结束时超越目标的概率。

**核心公式：**

```
d = ln(currentPrice / priceToBeat)
z = d / (volatility15m * sqrt(timeLeftMin / 15))
rawProb = Phi(z)   // 标准正态累积分布函数
```

**肥尾阻尼（加密货币调整）：**

加密货币市场存在比正态分布更厚的尾部，需对极端 z 值进行压制：

- `|z| > 3`：阻尼因子 0.7，概率上限 85%
- `|z| > 2`：阻尼因子 0.8，概率上限 90%
- `|z| <= 2`：使用原始概率，不做调整

### 2.3 时间衰减 (S 曲线衰减)

随着窗口剩余时间减少，技术信号的预测力下降，需对原始概率向 0.5 收缩。衰减函数分三个区间：

**线性衰减基准：**

```
linearDecay = timeLeftMin / 15
```

**S 曲线分区：**

| 区间 | 条件 | 剩余时间 | 时间衰减值 |
|------|------|----------|-----------|
| EARLY | linearDecay > 0.6 | >10 分钟 | 95%–100%（保留信号） |
| MID | 0.3 < linearDecay <= 0.6 | 5–10 分钟 | smoothstep 平滑插值 50%–95% |
| LATE | linearDecay <= 0.3 | <5 分钟 | 激进二次衰减 0%–50% |

**应用公式：**

```
adjustedUp = 0.5 + (rawUp - 0.5) * timeDecay
```

**自适应波动率调整：**

高波动率环境下价格运动更快，等效于拥有更多时间；低波动率则相反：

- `volPct > 0.8%`：`effectiveRemaining * 1.2`（高波动 = 等效更多时间）
- `volPct < 0.3%`：`effectiveRemaining * 0.8`（低波动 = 等效更少时间）

### 2.4 概率融合 (blendProbabilities)

将波动率隐含概率与技术分析评分以等权重融合：

**默认融合公式（各 50%）：**

```
blendedUp = 0.5 * volImpliedUp + 0.5 * taRawUp
```

**调整项：**

- **Binance 领先信号**：若 Binance 价格领先 Polymarket 超过 0.1%，则对应方向 ±2%
- **订单簿失衡**：若 `|imbalance| > 0.2`，则对应方向 ±2%

**最终截断：**

```
finalUp = clamp(blendedUp + adjustments, 0.01, 0.99)
```

---

## 3. 市场状态引擎 (src/engines/regime.ts)

### 3.1 状态分类决策树

```
IF 数据缺失 → CHOP
IF lowVolume AND |price - vwap| / vwap < 0.1% → CHOP
IF price > vwap AND vwapSlope > 0 → TREND_UP
IF price < vwap AND vwapSlope < 0 → TREND_DOWN
IF vwapCrossCount >= 3（20 根 K 线窗口内） → CHOP
DEFAULT → RANGE
```

**成交量检查：**

```
lowVolume = volumeRecent < 0.6 * volumeAvg
```

### 3.2 四种市场状态

| 状态 | 特征 | 交易含义 |
|------|------|----------|
| TREND_UP | 价格 > VWAP，VWAP 斜率向上 | 倾向 UP 交易，顺势降低阈值 |
| TREND_DOWN | 价格 < VWAP，VWAP 斜率向下 | 倾向 DOWN 交易，顺势降低阈值 |
| RANGE | 价格围绕 VWAP 震荡，无明显趋势 | 中性，使用标准阈值 |
| CHOP | 频繁穿越 VWAP，或低成交量 | 高风险，提高阈值或禁止交易 |

---

## 4. 边缘引擎 (src/engines/edge.ts)

### 4.1 边缘计算 (computeEdge)

边缘（Edge）衡量模型概率与市场报价之间的差距，是交易是否具有正期望值的核心指标。

**基础边缘：**

```
edgeUp   = modelUp   - marketUp
edgeDown = modelDown - marketDown
```

**订单簿滑点调整：**

- `|imbalance| > 0.2`：`penalty = |imbalance| * 0.02`
- `spread > 0.02`：`penalty = (spread - 0.02) * 0.5`

**手续费扣除：**

从边缘中扣除 Polymarket 预估 taker 手续费：

```
fee = 0.25 * (p * (1 - p))^2 * (1 - makerRebate)
```

**套利/Vig 检测：**

- `rawSum < 0.98`：存在套利机会（UP + DOWN 报价之和低于 1）
- `rawSum > 1.04`：Vig 过高，跳过此市场

### 4.2 过度自信保护

当模型概率过高时，可能意味着模型存在过拟合或数据异常，需要额外保护：

- **软上限 0.22**：要求阈值提高 40%（`threshold * 1.4`）
- **硬上限 0.30**：直接拒绝交易（模型可能严重失准）

---

## 5. 信心评分 (computeConfidence)

信心评分综合 5 个因子，加权计算 [0, 1] 区间内的综合信心值。

| 因子 | 权重 | 计算方式 |
|------|------|----------|
| 指标对齐度 | 25% | 支持方向的指标数 / 可用指标总数 |
| 波动率评分 | 15% | 0.3%–0.8% 最优 → 1.0；0.2%–0.3% 或 0.8%–1.0% → 0.7；< 0.2% → 0.3；> 1.0% → 0.4 |
| 订单簿评分 | 15% | 支持方向 → 0.8–1.0；反对方向 → 0.3；中性 → 0.5 |
| 时机评分 | 25% | modelProb >= 0.7 → 1.0；0.6–0.7 → 0.8；0.55–0.6 → 0.6；其他 → 0.4 |
| 状态评分 | 20% | 顺势趋势 → 1.0；RANGE → 0.7；CHOP → 0.2；逆势 → 0.3 |

**信心等级：**

| 等级 | 条件 |
|------|------|
| HIGH | score >= 0.7 |
| MEDIUM | 0.5 <= score < 0.7 |
| LOW | score < 0.5 |

---

## 6. 交易决策 (decide)

### 6.1 阶段阈值

根据窗口剩余时间划分三个阶段，越接近结算时间要求越高的边缘和概率：

| 阶段 | 剩余时间 | 边缘阈值 | 最小概率 |
|------|----------|----------|----------|
| EARLY | > 10 分钟 | 0.06 | 0.52 |
| MID | 5–10 分钟 | 0.08 | 0.55 |
| LATE | < 5 分钟 | 0.10 | 0.60 |

### 6.2 市场特定乘数

基于历史回测胜率，对不同市场应用不同的边缘乘数和最低要求：

| 市场 | 历史胜率 | 边缘乘数 | 特殊规则 |
|------|----------|----------|----------|
| BTC | 42.1% | 1.5x | 跳过 CHOP，minProb >= 0.58，minConfidence >= 0.60 |
| ETH | 46.9% | 1.2x | 跳过 CHOP |
| SOL | 51.0% | 1.0x | 标准 |
| XRP | 54.2% | 1.0x | 标准 |

### 6.3 状态乘数

市场状态影响有效边缘阈值，顺势交易降低要求，逆势交易提高要求：

| 状态 | 方向 | 乘数 | 说明 |
|------|------|------|------|
| TREND_UP + UP | 顺势 | 0.8 | 需要更少边缘 |
| TREND_UP + DOWN | 逆势 | 1.2 | 需要更多边缘 |
| TREND_DOWN + DOWN | 顺势 | 0.8 | 需要更少边缘 |
| TREND_DOWN + UP | 逆势 | 1.2 | 需要更多边缘 |
| RANGE | 任意 | 1.0 | 标准阈值 |
| CHOP | 任意 | 1.3 | 提高阈值；胜率 < 45% 的市场使用 REGIME_DISABLED=999 |

### 6.4 完整决策流程

决策函数按顺序执行以下 17 个检查门控：

1. **NaN/Infinity 模型概率守卫**：若 modelUp 或 modelDown 为 NaN/Infinity → NO_TRADE
2. **NaN/Infinity 边缘守卫**：若 edgeUp 或 edgeDown 为 NaN/Infinity → NO_TRADE
3. **市场数据可用性检查**：若市场数据为 null → NO_TRADE
4. **skipMarkets 配置检查**：若当前市场在跳过列表中 → NO_TRADE
5. **确定最优方向**：比较 edgeUp 与 edgeDown，选择有效边缘更大的方向（UP 或 DOWN）
6. **应用市场特定乘数**：`effectiveThreshold = baseThreshold * marketMultiplier`
7. **应用状态乘数**：`effectiveThreshold = effectiveThreshold * regimeMultiplier`
8. **状态禁用检查**：若状态乘数 >= 999（REGIME_DISABLED）→ NO_TRADE
9. **边缘阈值检查**：若 `bestEdge < effectiveThreshold` → NO_TRADE
10. **最小概率检查**：若 `modelProb < minProb` → NO_TRADE
11. **BTC 特定最小概率检查**：若市场为 BTC 且 `modelProb < 0.58` → NO_TRADE
12. **过度自信硬上限检查**：若 `bestEdge > 0.30` → NO_TRADE（模型可能严重失准）
13. **过度自信软上限检查**：若 `bestEdge > 0.22` → 使用惩罚阈值（`threshold * 1.4`）重新检查
14. **计算信心评分**：调用 computeConfidence，综合 5 因子加权评分
15. **信心阈值检查**：若 `confidence < minConfidence` → NO_TRADE
16. **确定交易强度**：
    - STRONG：`confidence >= 0.75` 且 `edge >= 0.15`
    - GOOD：`confidence >= 0.5` 且 `edge >= 0.08`
    - OPTIONAL：其他情况
17. **返回 ENTER**：携带方向（side）、强度（strength）、边缘值（edge）、信心分（confidence）

---

## 7. 订单执行

### Paper 模式

1. 应用限价折扣：`price = max(0.01, marketPrice - limitDiscount)`
2. 验证价格范围：`[0.02, 0.98]`
3. 记录到数据库，触发事件

### Live 模式

**订单类型选择：**

- **LATE 阶段 + HIGH 信心**：使用 FOK（Fill-or-Kill，立即全部成交或取消）
- **EARLY / MID 阶段**：使用 GTD（Good-Till-Date）Post-Only 限价单
  - 动态过期时间：最短 10 秒，最长为剩余窗口时间的 50%
  - Post-Only 保证以 maker 身份成交，享受 20% 手续费返还

### 结算（Paper 模式）

| 结算条件 | 结果 | 盈亏计算 |
|----------|------|----------|
| finalPrice > PTB | UP 获胜 | 盈利：`+size * (1 - buyPrice)` |
| finalPrice < PTB | DOWN 获胜 | 盈利：`+size * (1 - buyPrice)` |
| finalPrice = PTB | DOWN 获胜（Polymarket 规则） | 亏损：`-size * buyPrice` |
| 持有方向失败 | 亏损 | `-size * buyPrice` |

---

## 8. 风险管理

| 风控规则 | 说明 |
|----------|------|
| 每日亏损上限 | 若 `todayPnl < -dailyMaxLossUsdc`，停止当日所有交易 |
| 最大回撤 | 若回撤 >= 初始余额的 50%，停止交易 |
| 最大持仓数 | 每种模式（paper/live）的最大同时持仓数：`maxOpenPositions` |
| 每窗口最大交易数 | 单市场每个 15 分钟窗口内的最大交易次数：`maxTradesPerWindow` |
| 全局每窗口最大交易数 | 所有市场合计每窗口最大交易次数：`maxGlobalTradesPerWindow` |
| 限速窗口 | Live 订单使用 16 分钟修剪窗口进行频率限制 |

---

## 9. 示例交易决策

以下通过一个具体案例演示完整决策流程。

**场景：** BTC 市场，MID 阶段（剩余 7 分钟），TREND_UP 状态

**步骤 1：技术分析评分**

```
upScore = 10, downScore = 1
rawUp = 10 / (10 + 1) = 0.909
```

**步骤 2：波动率隐含概率**

```
d = ln(currentPrice / priceToBeat) ≈ -0.055
z = -0.055 / (volatility15m * sqrt(7/15)) ≈ -0.055
volImpliedUp = Phi(-0.055) ≈ 0.48
```

**步骤 3：时间衰减**

```
linearDecay = 7/15 = 0.467（MID 区间）
timeDecay = smoothstep ≈ 0.72
adjustedUp = 0.5 + (0.909 - 0.5) * 0.72 = 0.795
```

**步骤 4：概率融合**

```
blendedUp = 0.5 * 0.48 + 0.5 * 0.795 = 0.6375
```

**步骤 5：边缘计算**

```
marketUp = 0.55（Polymarket 报价）
edgeUp = 0.6375 - 0.55 = 0.0875
```

**步骤 6：阈值计算**

```
baseThreshold = 0.08（MID 阶段）
marketMultiplier = 1.5（BTC）
regimeMultiplier = 0.8（TREND_UP + UP 顺势）
effectiveThreshold = 0.08 * 1.5 * 0.8 = 0.096
```

**步骤 7：决策**

```
edgeUp (0.0875) < effectiveThreshold (0.096)
→ NO_TRADE
```

**结论：** 尽管技术指标强烈看涨，但 BTC 的高乘数要求使得当前边缘不足以触发交易。若 BTC 胜率提升或边缘扩大至 0.096 以上，则可进入交易。
