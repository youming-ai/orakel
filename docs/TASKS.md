# Orakel 优化任务清单

## Phase 1: 数据源扩展

### 任务 1.1: 添加 Bybit 数据源
- [ ] 创建 `src/data/bybit.ts`
- [ ] 实现 `fetchBybitPrice(symbol: string): Promise<number | null>`
- [ ] 实现 `fetchBybitKlines(params): Promise<Candle[]>`
- [ ] 添加错误处理和重试机制
- [ ] 编写单元测试 `src/__tests__/bybit.test.ts`

### 任务 1.2: 多数据源聚合
- [ ] 创建 `src/data/priceAggregator.ts`
- [ ] 实现 `aggregatePrices(sources: PriceSource[]): AggregatedPrice`
- [ ] 实现 `detectPriceDivergence(price1, price2): DivergenceInfo`
- [ ] 添加配置项 `priceAggregator` 到 `config.json`

### 任务 1.3: 集成到 processMarket
- [ ] 修改 `src/pipeline/processMarket.ts`
- [ ] 添加多数据源价格验证
- [ ] 当价差 > 0.4% 时提升信号置信度
- [ ] 记录价差数据到日志

---

## Phase 2: Kelly 仓位管理

### 任务 2.1: 实现 Kelly Criterion
- [ ] 创建 `src/trading/positionSizing.ts`
- [ ] 实现 `calculateKellySize(params: KellyParams): number`
- [ ] 使用 1/4 Kelly（保守）
- [ ] 设置最大/最小仓位限制

### 任务 2.2: 动态仓位调整
- [ ] 修改 `src/trading/accountService.ts`
- [ ] 根据信号强度调整仓位
- [ ] 添加仓位调整日志

### 任务 2.3: 市场差异化配置
- [ ] 修改 `config.json` 添加仓位配置
- [ ] BTC-15m: 更激进仓位
- [ ] ETH-15m: 更保守仓位

---

## Phase 3: 提高轮询频率

### 任务 3.1: 减少轮询间隔
- [ ] 修改 `src/runtime/mainLoop.ts`
- [ ] BTC-15m: 5s → 1s
- [ ] ETH-15m: 5s → 2s
- [ ] 添加配置项到 `config.json`

### 任务 3.2: 性能优化
- [ ] 并行获取市场数据
- [ ] 缓存计算结果
- [ ] 减少日志输出

---

## Phase 4: 止损逻辑

### 任务 4.1: 实现止损监控
- [ ] 创建 `src/trading/stopLoss.ts`
- [ ] 实现 `checkStopLoss(trades: Trade[]): StopLossResult[]`
- [ ] 每 10 秒检查未结算交易

### 任务 4.2: 止损执行
- [ ] 集成到 mainLoop
- [ ] 记录止损事件
- [ ] 添加止损统计

### 任务 4.3: 配置
- [ ] 添加止损配置到 `config.json`
- [ ] `stopLossPercent`: 0.03
- [ ] `stopLossCheckIntervalMs`: 10_000

---

## Phase 5: 策略微调

### 任务 5.1: 价格区间过滤
- [ ] 修改 `src/pipeline/processMarket.ts`
- [ ] 禁用 Live 在 0.40-0.49 区间交易
- [ ] 添加配置项 `priceRangeFilter`

### 任务 5.2: 方向偏好
- [ ] DOWN 方向: edgeBoost +0.02
- [ ] UP 方向: 保持原样
- [ ] 修改 `src/pipeline/compute.ts`

### 任务 5.3: 市场权重
- [ ] BTC-15m: 75%
- [ ] ETH-15m: 25%
- [ ] 添加到 `config.json`

---

## 测试任务

### 单元测试
- [ ] Bybit API 测试
- [ ] 价格聚合器测试
- [ ] Kelly 计算测试
- [ ] 止损逻辑测试

### 集成测试
- [ ] 多数据源集成测试
- [ ] 仓位管理集成测试
- [ ] 端到端回测

### Paper 测试
- [ ] 运行 24 小时 Paper 测试
- [ ] 验证胜率提升
- [ ] 检查日志和统计

---

## 部署任务

### Phase 1 部署
- [ ] 代码审查
- [ ] 合并到 main 分支
- [ ] Docker 重建
- [ ] Paper 测试 24 小时

### Phase 2 部署
- [ ] 代码审查
- [ ] 合并到 main 分支
- [ ] Docker 重建
- [ ] Paper 测试 24 小时

### Full Live 部署
- [ ] 所有 Phase 测试通过
- [ ] Paper 胜率 > 70%
- [ ] 逐步迁移到 Live
- [ ] 监控 7 天

---

## 当前任务

**已完成**: 
- ✅ Phase 1 - 多数据源 (Bybit + Binance 价格聚合)
- ✅ Phase 2 - Kelly 仓位管理 (1/4 Kelly, 动态调整)
- ✅ Phase 3 - 轮询频率 (1s)
- ✅ Phase 4 - 止损监控 (3% 止损, 15min 最大持仓)
- ✅ Phase 5 - 策略微调 (价格过滤, DOWN偏好, 市场权重)

**状态**: 所有优化任务已完成，准备 Paper 测试
