# 技术指标

## 1. 概览

所有技术指标均基于 Binance 1 分钟 K 线数据计算，每个市场每个周期使用 240 根 K 线。所有指标均为纯函数——无副作用、无状态。源码位于 `src/indicators/`。

## 2. RSI — 相对强弱指标 (`src/indicators/rsi.ts`)

### 2.1 `computeRsi(closes, period)`

- **输入**：`closes`（`(number | null)[]`）— 收盘价数组；`period`（`number`）— 回溯周期
- **输出**：`number | null`（范围 0–100，数据不足时返回 `null`）
- **默认周期**：14
- **最低数据量**：`closes.length >= period + 1`

**算法**：

1. 取最后 `period` 根 K 线，逐根计算涨跌幅
2. `avgGain = 所有涨幅之和 / period`
3. `avgLoss = 所有跌幅之和 / period`
4. 若 `avgLoss = 0`，直接返回 100（全部上涨）
5. `RS = avgGain / avgLoss`
6. `RSI = 100 - 100 / (1 + RS)`
7. 结果截断至 `[0, 100]`

**在策略中的作用**：

- `RSI > 55` 且斜率 `> 0` → UP 方向 +2 分
- `RSI < 45` 且斜率 `< 0` → DOWN 方向 +2 分
- `RSI 50–80` 与 UP 方向对齐 → 置信度对齐加分
- `RSI 20–50` 与 DOWN 方向对齐 → 置信度对齐加分

---

### 2.2 `sma(values, period)`

- **功能**：对最后 `period` 个值计算简单移动平均
- **输入**：`values`（`number[]`）、`period`（`number`）
- **输出**：`number | null`

---

### 2.3 `slopeLast(values, points)`

- **功能**：计算最后 N 个点的线性斜率
- **公式**：`(最后一个值 - 第一个值) / (points - 1)`
- **输入**：`values`（`number[]`）、`points`（`number`）
- **输出**：`number | null`
- **用途**：计算 RSI 斜率以判断动量方向

---

## 3. MACD — 移动平均收敛散度 (`src/indicators/macd.ts`)

### 3.1 `computeMacd(closes, fast, slow, signal)`

- **输入**：`closes`（`(number | null)[]`）；`fast=12`、`slow=26`、`signal=9`
- **输出**：`MacdResult | null`
- **最低数据量**：`closes.length >= slow + signal`

**`MacdResult` 结构**：

```
{
  macd: number              // MACD 线（fastEMA - slowEMA）
  signal: number            // 信号线（MACD 的 EMA）
  hist: number              // 柱状图（macd - signal）
  histDelta: number | null  // hist[当前] - hist[前一根]（动量加速度）
}
```

**算法**：

1. 用第一根收盘价初始化 `fastEMA` 和 `slowEMA`
2. 对后续每根 K 线：
   - `fastEMA = close × kFast + fastEMA × (1 - kFast)`，其中 `kFast = 2 / (fast + 1)`
   - `slowEMA = close × kSlow + slowEMA × (1 - kSlow)`，其中 `kSlow = 2 / (slow + 1)`
3. 经过 `slow - 1` 根 K 线后，开始记录 `MACD = fastEMA - slowEMA`
4. 以 `kSignal = 2 / (signal + 1)` 对 MACD 序列计算信号线 EMA
5. `Histogram = MACD - Signal`
6. `histDelta = 当前 hist - 前一根 hist`（动量加速度）

**在策略中的作用**：

- `hist > 0` 且 `histDelta > 0`（绿柱扩张）→ UP 方向 +2 分
- `hist < 0` 且 `histDelta < 0`（红柱扩张）→ DOWN 方向 +2 分
- `macd > 0` → UP 方向 +1 分
- `macd < 0` → DOWN 方向 +1 分
- 柱状图符号与方向一致 → 置信度对齐加分

---

## 4. VWAP — 成交量加权平均价 (`src/indicators/vwap.ts`)

### 4.1 `computeSessionVwap(candles)`

- **输入**：`Candle[]`（含 `high`、`low`、`close`、`volume`）
- **输出**：`number | null`（VWAP 值）

**算法**：

1. 对每根 K 线计算典型价格：`TP = (high + low + close) / 3`
2. 累加：`pv += TP × volume`，`v += volume`
3. `VWAP = pv / v`（典型价格的成交量加权平均）
4. 若总成交量为 0，返回 `null`

---

### 4.2 `computeVwapSeries(candles)`

- **输入**：`Candle[]`
- **输出**：`number[]`（每根 K 线处的累计 VWAP）
- **算法**：与 `computeSessionVwap` 相同，但返回每一步的中间值，用于斜率计算

**在策略中的作用**：

- `price > VWAP` → UP 方向 +2 分
- `price < VWAP` → DOWN 方向 +2 分
- VWAP 斜率 `> 0` → UP 方向 +2 分（通过 `slopeLast` 对 VWAP 序列计算，回溯 5 个点）
- VWAP 斜率 `< 0` → DOWN 方向 +2 分
- VWAP 是市场状态检测的核心：
  - `price > VWAP` 且斜率 `> 0` → `TREND_UP`
  - `price < VWAP` 且斜率 `< 0` → `TREND_DOWN`
  - 20 根 K 线内出现 3 次以上 VWAP 穿越 → `CHOP`
- VWAP 夺回失败 → DOWN 方向 +3 分（强烈看跌信号）

---

## 5. Heiken Ashi — 平均K线 (`src/indicators/heikenAshi.ts`)

### 5.1 `computeHeikenAshi(candles)`

- **输入**：`Candle[]`（标准 OHLC）
- **输出**：`HaCandle[]`

**`HaCandle` 结构**：

```
{
  open: number      // (前一根 haOpen + 前一根 haClose) / 2
  high: number      // max(high, haOpen, haClose)
  low: number       // min(low, haOpen, haClose)
  close: number     // (open + high + low + close) / 4
  isGreen: boolean  // haClose >= haOpen（看涨）
  body: number      // |haClose - haOpen|
}
```

**算法**：

1. 第一根：`haOpen = (open + close) / 2`，`haClose = (O + H + L + C) / 4`
2. 后续每根：`haOpen = (前一根 haOpen + 前一根 haClose) / 2`
3. `haClose = (O + H + L + C) / 4`（始终为四价均值）
4. `haHigh = max(high, haOpen, haClose)`
5. `haLow = min(low, haOpen, haClose)`
6. `isGreen = haClose >= haOpen`（看涨）

---

### 5.2 `countConsecutive(haCandles)`

- **输入**：`HaCandle[]`
- **输出**：`{ color: "green" | "red" | null, count: number }`
- **功能**：从末尾统计连续同色 K 线数量

**算法**：

1. 取最后一根 K 线的颜色
2. 向前遍历，统计颜色相同的连续根数
3. 遇到颜色变化时停止

**在策略中的作用**：

- 连续绿色 `>= 2` → UP 方向 +1 分
- 连续红色 `>= 2` → DOWN 方向 +1 分
- 颜色与方向一致 → 置信度指标对齐
- 在 MarketCard 中展示迷你趋势（5 根 K 线显示）

---

## 6. 波动率 — 已实现波动率

注意：波动率不是独立的指标文件，而是在概率引擎中内联计算。

**计算方法**：

1. 取最后 60 根 K 线的收盘价
2. 计算对数收益率：`ln(close[i] / close[i-1])`
3. 对对数收益率序列计算标准差
4. 缩放至 15 分钟：`volatility15m = stddev × sqrt(15)`（乘以窗口分钟数的平方根）

**在策略中的作用**：

- 输入波动率隐含概率计算：`z = ln(P / PTB) / (vol15m × sqrt(t / 15))`
- 置信度波动率评分：`0.3–0.8%` → 最优（1.0）；`< 0.2%` → 偏低（0.3）；`> 1.0%` → 偏高风险（0.4）
- 自适应时间衰减：高波动（`> 0.8%`）→ 有效时间 +20%；低波动（`< 0.3%`）→ 有效时间 -20%

---

## 7. 指标交互图

各指标如何汇入策略的数据流：

```
Binance 1 分钟 K 线（240 根）
    │
    ├──> computeHeikenAshi() ──> 颜色 + 连续根数 ──────────┐
    ├──> computeRsi(14) + slopeLast() ──> RSI + 斜率 ──────┤
    ├──> computeMacd(12,26,9) ──> hist + histDelta ─────────┤──> scoreDirection()
    ├──> computeSessionVwap() + slopeLast() ──> VWAP + 斜率 ┤     ├──> rawUp
    └──> realizedVolatility(60) ──> volatility15m ──────────┘     └──> 用于混合计算
                                        │
                                        └──> computeVolatilityImpliedProb()
                                              └──> volImpliedUp
```

---

## 8. 参数汇总

| 指标 | 参数 | 值 | 说明 |
|------|------|----|------|
| RSI | period | 14 | 标准 14 周期 |
| RSI slope | points | （通过 slopeLast） | 斜率计算点数 |
| MACD | fast | 12 | 快速 EMA 周期 |
| MACD | slow | 26 | 慢速 EMA 周期 |
| MACD | signal | 9 | 信号线 EMA 周期 |
| VWAP | session | 全部 K 线 | 累计 VWAP |
| VWAP slope | lookback | 5 分钟 | 斜率窗口 |
| HA | — | — | 无可调参数 |
| Volatility | lookback | 60 根 K 线 | 已实现波动率窗口 |
| Volatility | scale | sqrt(15) | 缩放到 15 分钟 |
