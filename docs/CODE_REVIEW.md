# Orakel 代码审查报告

> 审查范围：全栈（后端 ~5000 LoC / 前端 ~2000 LoC）
> 审查偏向：简约、高性能、架构清晰度
> 日期：2026-02-26

---

## 目录

- [概述](#概述)
- [P0 — 必须立即修复](#p0--必须立即修复)
- [P1 — 高优先级](#p1--高优先级)
- [P2 — 中优先级](#p2--中优先级)
- [P3 — 低优先级改进](#p3--低优先级改进)
- [架构评估](#架构评估)
- [性能评估](#性能评估)
- [重构路线图](#重构路线图)

---

## 概述

Orakel 是一个可运行的生产级交易机器人，核心交易逻辑（概率融合、边缘计算、信心评分）设计合理。主要问题集中在 **运行时安全性**（NaN 传播、无降级策略）、**网络效率**（每 tick 冗余 REST）、和 **代码结构**（God File、类型重复）。

审查共识别 **32 个问题**，按影响分为 4 个优先级。

| 优先级 | 数量 | 修复估时 |
|--------|------|----------|
| P0 必须立即修复 | 4 | 1 天 |
| P1 高优先级 | 8 | 2-3 天 |
| P2 中优先级 | 12 | 3-5 天 |
| P3 低优先级 | 8 | 按需 |

---

## P0 — 必须立即修复

这些问题可能导致 **错误交易** 或 **资金损失**。

### P0-1. NaN 可触发真实交易

**位置**: `src/engines/edge.ts:339-341`, `src/trader.ts:436-444`

`computeEdge()` / `decide()` 不拒绝 NaN 值。`executeTrade()` 只检查价格 `<0.02` / `>0.98`，NaN 会绕过所有检查，可能以错误价格下单。

```typescript
// edge.ts — 缺少 NaN 校验
const edgeUp = modelUp - marketUp;  // modelUp 为 NaN 时 edgeUp 也是 NaN
// NaN > threshold 为 false，但 NaN 在某些路径上不会被正确拦截
```

**修复**: 在 `decide()` 入口和 `executeTrade()` 入口添加 `Number.isFinite()` 门控，任何 NaN/Infinity 立即返回 `missing_market_data`。

```typescript
// src/engines/edge.ts — decide() 入口
if (!Number.isFinite(modelUp) || !Number.isFinite(marketUp) || !Number.isFinite(marketDown)) {
  return { action: "SKIP", reason: "missing_market_data" };
}

// src/trader.ts — executeTrade() 入口
if (!Number.isFinite(price) || !Number.isFinite(size)) {
  log.error("invalid trade params", { price, size });
  return;
}
```

---

### P0-2. 私钥通过 HTTP 明文传输

**位置**: `web/src/components/LiveConnect.tsx:73-76`, `src/trader.ts:258+`

UI 组件直接将 raw private key 通过 HTTP POST 发送到后端。即使是 localhost，这也意味着：
- 浏览器历史/DevTools 可见
- 中间代理可截获
- 日志可能记录请求体

**修复**: 短期——确保仅 localhost + 添加 TLS。长期——让后端从环境变量或加密密钥库读取，永远不通过 HTTP 传输私钥。

---

### P0-3. Polymarket 数据全链路无类型

**位置**: `src/index.ts:187-296`, `src/data/polymarket.ts`

`poly.market` 类型为 `unknown`，全程依赖 `as AnyRecord` 强转和 `extractNumericFromMarket()` 递归遍历（深度限制 6）。任何 API 结构变更会静默产生错误数据，进而触发错误交易决策。

```typescript
type AnyRecord = Record<string, unknown>;  // line 188
const market = poly.market as AnyRecord;   // line 296 — 无校验
```

**修复**: 定义 Zod schema 覆盖实际使用字段，在 `src/data/polymarket.ts` 解析一次：

```typescript
const GammaMarketSchema = z.object({
  slug: z.string(),
  endDate: z.string(),
  outcomes: z.array(z.string()),
  outcomePrices: z.string(), // JSON-encoded array
  clobTokenIds: z.string(),  // JSON-encoded array
  bestBid: z.number().optional(),
  bestAsk: z.number().optional(),
  spread: z.number().optional(),
});
type GammaMarket = z.infer<typeof GammaMarketSchema>;
```

---

### P0-4. API 凭证明文存储

**位置**: `src/trader.ts:18`, `src/trader.ts:308-311`

`CREDS_PATH = "./data/api-creds.json"` 将派生的 API 密钥以明文 JSON 写入磁盘。在共享环境或容器挂载卷中存在泄露风险。

**修复**: 使用加密存储或环境变量。最低限度——限制文件权限 `chmod 600` + `.gitignore` + `.dockerignore`。

---

## P1 — 高优先级

影响 **可靠性、性能或可维护性**，应在下一个迭代解决。

### P1-1. 每 tick 大量冗余 REST 请求

**位置**: `src/data/binance.ts:9-42`, `src/index.ts:464-469`, `src/index.ts:702-707`

每个 market 每秒：
- 1× Binance klines REST (240 行数据)
- 1× Binance 最新价 REST
- 1× Chainlink REST (有时)
- 4× Polymarket CLOB REST

已有 WebSocket 流提供实时数据，但 REST 仍每秒全量拉取。这是 **最大的性能瓶颈**。

**修复**: 引入带 TTL 的缓存层：

| 数据 | 当前频率 | 建议频率 | 理由 |
|------|----------|----------|------|
| Klines (240条) | 1s | 60s | K线每分钟才更新 |
| Market metadata | 1s | 30-60s | slug/outcomes 几乎不变 |
| Orderbook | 1s | 2-5s | 需要较新但不需每秒 |
| 最新价 | 1s REST | WS only | 已有 WebSocket |

可减少 **80-95%** 的网络请求。

---

### P1-2. 无循环级错误恢复

**位置**: `src/index.ts:1191`, `src/index.ts:1296`

主循环 `while(true)` 对每个 market 有 try/catch，但无全局降级策略。若所有 market 同时失败（网络中断），循环继续空转渲染空结果，无告警、无熔断、无自动暂停交易。

**修复**: 添加循环级健康检测：

```typescript
let consecutiveAllFails = 0;
while (true) {
  const results = await Promise.allSettled(markets.map(processMarket));
  const allFailed = results.every((r) => r.status === "rejected");
  if (allFailed) {
    consecutiveAllFails++;
    if (consecutiveAllFails >= 3) {
      log.error("all markets failed 3x, entering safe mode");
      // 暂停交易，保持 dashboard 可用
    }
  } else {
    consecutiveAllFails = 0;
  }
}
```

---

### P1-3. Binance REST 无超时

**位置**: `src/data/binance.ts`

Polymarket 和 Chainlink 的 REST 调用有超时设置，但 Binance REST 没有。一个挂起的 fetch 会阻塞整个 market tick。

**修复**: 添加 `AbortSignal.timeout(5000)`:

```typescript
const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
```

---

### P1-4. 前端 API 客户端无错误处理

**位置**: `web/src/lib/api.ts:4-30`

`get()` / `post()` / `put()` 不检查 `res.ok`，500 响应会被当作正常 JSON 解析。

```typescript
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  return res.json(); // ← 500/404 也走这里
}
```

**修复**:

```typescript
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}
```

---

### P1-5. 前端无 Hono RPC 类型推断

**位置**: `web/src/lib/api.ts:92-240`, `src/api.ts:579`

后端已导出 `AppType = typeof apiRoutes`，但前端完全没用。手动维护的 `DashboardState`、`MarketSnapshot`、`PaperStats` 等约 15 个类型与后端 `src/types.ts` 重复，随时可能漂移。

**修复**: 使用 Hono client 类型推断或通过 `@server/*` 路径映射共享类型。删除 `web/src/lib/api.ts` 中的重复类型定义。

---

### P1-6. Config 写入非原子、无锁

**位置**: `src/api.ts:421-459`

`PUT /config` 读取 → 合并 → 写入 config.json，无文件锁，无原子操作。并发更新可能损坏文件。

**修复**: 写入临时文件 + rename（原子操作）：

```typescript
import { writeFile, rename } from "node:fs/promises";
const tmpPath = `${configPath}.tmp.${Date.now()}`;
await writeFile(tmpPath, JSON.stringify(merged, null, 2));
await rename(tmpPath, configPath); // 原子操作
```

---

### P1-7. `reloadConfig()` 丢失 `marketPerformance`

**位置**: `src/config.ts:261-273` vs `src/config.ts:291-302`

初始化时 CONFIG 包含 `marketPerformance`，但 `reloadConfig()` 重新解析后未恢复此字段，导致热重载后运行时数据丢失。

**修复**: 在 `reloadConfig()` 中保留运行时字段：

```typescript
function reloadConfig() {
  const saved = CONFIG.marketPerformance; // 保留
  CONFIG = parseConfig(rawJson);
  CONFIG.marketPerformance = saved;       // 恢复
}
```

---

### P1-8. 前端用了错误的 Query Hook

**位置**: `web/src/components/Dashboard.tsx:45-56`, `web/src/lib/queries.ts:92-98`

`useDashboardStateWithWs()` 可在 WebSocket 连接时禁用轮询，但 `Dashboard.tsx` 使用了 `useDashboardState()`，导致 WS 连接时仍每 5 秒轮询。

**修复**: 将 `Dashboard.tsx` 中的 `useDashboardState()` 替换为 `useDashboardStateWithWs()`。

---

## P2 — 中优先级

影响 **代码质量、可维护性、用户体验**。

### P2-1. `index.ts` 是 1498 行 God File

**位置**: `src/index.ts`

该文件包含：市场处理、价格解析、ANSI 终端渲染、订单跟踪、交易执行协调、CSV 写入、信号持久化。`ProcessMarketResult` 有 ~30 个可选字段。

**修复**: 分三层拆分：
1. `src/pipeline/fetch.ts` — 数据获取 + 规范化
2. `src/pipeline/compute.ts` — 指标 + 概率 + 边缘 + 决策（纯函数）
3. `src/pipeline/persist.ts` — 持久化 + WS 广播
4. `src/terminal.ts` — ANSI 终端渲染

`processMarket()` 变为薄编排层，调用上述模块。

---

### P2-2. `paperTracker` / `liveTracker` 重复代码

**位置**: `src/index.ts:609-661`

两个 tracker 几乎相同接口，完全 copy-paste。

**修复**: 提取工厂函数 `createTracker(mode: "paper" | "live")`。

---

### P2-3. Prepared Statements 每次调用重建

**位置**: `src/db.ts:283+`

`statements` 对象使用 getter `insertSignal: () => getDb().prepare(...)`，每次调用都重新 prepare。虽然 bun:sqlite 的 prepare 很快，但语义上错误且浪费。

**修复**: 延迟初始化 + 缓存：

```typescript
let _stmtCache: Map<string, Statement> = new Map();
function cachedPrepare(sql: string): Statement {
  let stmt = _stmtCache.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    _stmtCache.set(sql, stmt);
  }
  return stmt;
}
```

---

### P2-4. WebSocket 缓存浅合并无校验

**位置**: `web/src/lib/queries.ts:65-89`

WS `state:snapshot` 事件直接 `{ ...prev, ...msg.data }` 合并到 React Query 缓存，不验证数据结构。部分更新可能丢失嵌套字段。

**修复**: 显式枚举合并字段，或对 `msg.data` 做 Zod 校验。

---

### P2-5. WebSocket 重连逻辑边缘情况

**位置**: `web/src/lib/ws.ts:123-193`

- `connect()` 可能在首次连接完成前被多次调用（竞态）
- 组件在重连超时期间卸载可能内存泄漏（`reconnectTimeoutRef` 未清理）
- 退避上限 30s 硬编码，不可配置

**修复**: 添加连接锁 + 卸载清理 + 可配置上限。

---

### P2-6. Dashboard → AnalyticsTabs 严重 Prop Drilling

**位置**: `web/src/components/Dashboard.tsx:180-190`, `web/src/components/AnalyticsTabs.tsx:28-42`

`AnalyticsTabs` 接收 11 个 props，包括深层嵌套对象。

**修复**: 提取 `useAnalyticsData(viewMode)` 自定义 hook，或引入 `AnalyticsContext`。

---

### P2-7. MarketCard 269 行单体组件

**位置**: `web/src/components/MarketCard.tsx:101-269`

信号灯、信心条、迷你趋势、技术详情、交易决策全部内联。

**修复**: 拆分为 `<SignalLight />`, `<ConfidenceBar />`, `<TechnicalDetails />` 等子组件。

---

### P2-8. 可访问性缺失

**位置**: `web/src/components/Header.tsx`, `MarketCard.tsx`, 多个组件

- 按钮缺少 `aria-label`（主题切换、展开按钮）
- 无键盘导航支持
- 信号灯仅靠颜色区分

**修复**: 为所有交互元素添加 ARIA 属性和键盘事件处理。

---

### P2-9. ConnectWallet 不安全类型转换

**位置**: `web/src/components/ConnectWallet.tsx:71-74`

`useReadContracts` 返回结果直接 `as bigint | undefined` 强转，不检查 `status`。

**修复**: 检查 `status === "success"` 后再转换。

---

### P2-10. Mutations 无 Loading 状态

**位置**: `web/src/components/AnalyticsTabs.tsx:271-307`

`saveConfig()` 调用时按钮不禁用，用户可重复点击。

**修复**: 使用 `configMutation.isPending` 禁用按钮 + 显示加载状态。

---

### P2-11. Error Boundary 覆盖不完整

**位置**: `web/src/components/` — `ChartErrorBoundary` 仅用于部分图表

`OverviewTab` 和 `TradesTab` 有 ErrorBoundary，但 `MarketsTab` 等其他图表组件没有。

**修复**: 统一包裹所有 Recharts 组件。

---

### P2-12. CSV 双路径增加复杂度

**位置**: `src/api.ts` (CSV 解析), `src/index.ts:934+` (CSV 写入)

`PERSIST_BACKEND` 支持 `csv | sqlite | dual`，CSV 路径在 api.ts 和 index.ts 中引入大量条件分支。

**修复**: 如果不再依赖 CSV，废弃该路径。否则统一到 adapter 模式。

---

## P3 — 低优先级改进

### P3-1. WS 客户端 Set 清理不完善

`src/api.ts:98-119` — `pruneClosedWsClients()` 仅在 close/error 事件触发，静默断连的客户端留在 Set 中。添加心跳 ping/pong 机制。

### P3-2. EventEmitter 无 maxListeners

`src/state.ts:46` — `botEvents` 未设 maxListeners。长时间运行 + 重连客户端可能泄漏。添加 `setMaxListeners(20)`。

### P3-3. Module Singletons 影响可测试性

`src/state.ts` — 模块级变量 + getter/setter 模式对单进程 OK，但无法在测试中隔离。如需集成测试，考虑 DI 或 factory 模式。

### P3-4. Dashboard 内联 Config Fallback 巨大

`web/src/components/Dashboard.tsx:184` — 提取为 `DEFAULT_CONFIG` 常量，避免每次渲染创建新对象。

### P3-5. Theme 水合竞态

`web/index.html:11-17` vs `web/src/main.tsx:8-9` — index.html 内联脚本和 Zustand 都设置 theme，两个来源。统一到一个。

### P3-6. 硬编码常量分散

`web/src/components/` 中 `USDC_E_ADDRESS`、`WINDOW_SEC`、toast 超时等散落各处。集中到 `constants.ts`。

### P3-7. AnalyticsTabs 过度 Memoization

`web/src/components/AnalyticsTabs.tsx:154-240` — 8 个 `useMemo`，4 个依赖 `trades`。用 React DevTools Profiler 验证是否真的有收益。

### P3-8. Vite 构建缺少优化配置

`web/vite.config.ts` — 无 code splitting、无 manualChunks。为 recharts 和 wagmi 配置独立 chunk。

---

## 架构评估

### 整体判断

Module singleton 模式（`state.ts`）对单进程 Bun bot **可以接受**。不需要引入 DI 框架。但需要把「核心逻辑保持纯函数」和「IO/副作用推到边界」做得更彻底。

当前最大架构问题是 `index.ts` 混合了所有职责。交易逻辑、终端渲染、数据持久化、WebSocket 广播全在同一个函数里，导致：
- 无法单独测试交易决策逻辑
- 修改持久化方式需要改动主循环
- 终端渲染代码干扰了核心流程

### 推荐架构方向

```
当前:
  index.ts:processMarket() → fetch + compute + persist + render (1个函数做所有事)

目标:
  pipeline/fetch.ts    → 获取 + 规范化 (返回 NormalizedMarketData)
  pipeline/compute.ts  → 指标 + 概率 + 边缘 + 决策 (纯函数, 返回 Decision)
  pipeline/persist.ts  → 写入 DB + 广播 WS (副作用边界)
  terminal.ts          → ANSI 渲染 (独立关注点)
  index.ts             → 薄编排层, <50 行
```

这样 `compute.ts` 可以完全用单元测试覆盖，不需要 mock 任何 IO。

### 模块边界评价

| 模块 | 评价 |
|------|------|
| `engines/` (edge, probability, regime) | ✅ 清晰的纯函数，易测试 |
| `indicators/` (rsi, macd, vwap) | ✅ 优秀，co-located 测试 |
| `data/` (binance, polymarket, chainlink) | ⚠️ 可接受，但 Polymarket 类型缺失 |
| `trader.ts` | ⚠️ 混合了钱包管理和交易执行 |
| `api.ts` | ⚠️ 715 行，可按路由组拆分 |
| `index.ts` | ❌ God File，需拆分 |
| `web/src/lib/` | ⚠️ 类型重复严重 |
| `web/src/components/` | ⚠️ 组件划分合理但 prop drilling 重 |

---

## 性能评估

### 当前瓶颈

CPU 不是问题。**网络 IO 是最大瓶颈。**

每 tick 每 market 的网络调用：
- 1× Binance klines REST (240 rows JSON)
- 1× Binance last price REST
- 1× Chainlink REST (有时)
- 1-4× Polymarket CLOB REST

4 个 market × 1s = **每秒 ~20 次 REST 调用**。

已有 Binance WS + Polymarket WS + Chainlink WS 提供实时数据，但 REST 仍全量拉取。引入缓存后可减少 **80-95%** 的网络负载。

### 1 秒主循环是否合适？

**合适**，作为决策节奏。但输入数据不需要每秒全量刷新。保持 1s 循环做「WS 数据 + 缓存命中 → 计算 → 决策」，让 REST 做低频补充。

### 前端性能

- 分页表格（10条/页）性能 OK，暂不需虚拟化
- 但 `AnalyticsTabs` 8 个 `useMemo` 链可能过度——建议 profiling 后再决定
- WS 连接时仍在轮询（P1-8），修复后可减少不必要请求

---

## 重构路线图

### Phase 0 — 安全门控（1 天）

> 目标：确保不会因坏数据产生错误交易

- [ ] `decide()` 和 `executeTrade()` 入口添加 `Number.isFinite()` 门控
- [ ] 循环级降级模式：连续 N 次全失败 → 暂停交易
- [ ] Binance REST 添加超时
- [ ] 评估私钥传输方案（至少 localhost + TLS）

### Phase 1 — 网络性能（1 天）

> 目标：减少 80%+ 的每 tick 网络请求

- [ ] Klines 缓存（TTL 60s）
- [ ] Market metadata 缓存（TTL 30-60s）
- [ ] Orderbook 缓存（TTL 2-5s）
- [ ] 最新价完全依赖 WS，REST 做 fallback
- [ ] 添加并发限制器（避免突发请求）

### Phase 2 — 类型安全（1 天）

> 目标：消除类型漂移风险

- [ ] 定义 Polymarket Zod schema，parse once in `polymarket.ts`
- [ ] 前端使用 Hono RPC 类型推断或共享类型
- [ ] 删除 `web/src/lib/api.ts` 中的重复类型
- [ ] 前端 API 客户端添加 `res.ok` 检查

### Phase 3 — 结构清理（2-3 天）

> 目标：拆分 God File，提高可测试性

- [ ] 将 `processMarket()` 拆分为 fetch → normalize → decide 三层
- [ ] 终端渲染移出 `index.ts`
- [ ] 持久化逻辑移出 `index.ts`
- [ ] 合并 `paperTracker` / `liveTracker` 为工厂函数
- [ ] Config 写入改为原子操作
- [ ] `reloadConfig()` 保留运行时字段
- [ ] Prepared statements 缓存

### Phase 4 — 前端改进（按需）

> 目标：改善 DX 和用户体验

- [ ] `Dashboard.tsx` 换用 `useDashboardStateWithWs()`
- [ ] 提取 `DEFAULT_CONFIG` 常量
- [ ] 添加 ARIA 属性和键盘导航
- [ ] Mutations 添加 loading 状态
- [ ] 评估 Vite 构建优化（code splitting）

---

## 附录：问题索引

| ID | 优先级 | 类别 | 问题 | 位置 |
|----|--------|------|------|------|
| P0-1 | P0 | 安全 | NaN 可触发交易 | `edge.ts:339`, `trader.ts:436` |
| P0-2 | P0 | 安全 | 私钥 HTTP 明文传输 | `LiveConnect.tsx:73`, `trader.ts:258` |
| P0-3 | P0 | 类型 | Polymarket 数据全链路 unknown | `index.ts:187-296` |
| P0-4 | P0 | 安全 | API 凭证明文存储 | `trader.ts:18` |
| P1-1 | P1 | 性能 | 每 tick 冗余 REST | `binance.ts`, `index.ts:464` |
| P1-2 | P1 | 可靠性 | 无循环级错误恢复 | `index.ts:1191` |
| P1-3 | P1 | 可靠性 | Binance REST 无超时 | `binance.ts` |
| P1-4 | P1 | 前端 | API 客户端无错误处理 | `web/lib/api.ts:4` |
| P1-5 | P1 | 类型 | 前端无 Hono 类型推断 | `web/lib/api.ts:92` |
| P1-6 | P1 | 可靠性 | Config 写入非原子 | `api.ts:421` |
| P1-7 | P1 | 正确性 | reloadConfig 丢失字段 | `config.ts:261-302` |
| P1-8 | P1 | 前端 | 用了错误的 Query Hook | `Dashboard.tsx:45` |
| P2-1 | P2 | 架构 | index.ts God File | `index.ts` (1498行) |
| P2-2 | P2 | 架构 | Tracker 重复代码 | `index.ts:609-661` |
| P2-3 | P2 | 性能 | Statements 每次重建 | `db.ts:283` |
| P2-4 | P2 | 前端 | WS 缓存浅合并无校验 | `queries.ts:65` |
| P2-5 | P2 | 前端 | WS 重连边缘情况 | `ws.ts:123` |
| P2-6 | P2 | 前端 | Prop Drilling 严重 | `Dashboard.tsx:180` |
| P2-7 | P2 | 前端 | MarketCard 单体组件 | `MarketCard.tsx` (269行) |
| P2-8 | P2 | 前端 | 可访问性缺失 | 多个组件 |
| P2-9 | P2 | 类型 | ConnectWallet 不安全转换 | `ConnectWallet.tsx:71` |
| P2-10 | P2 | 前端 | Mutations 无 Loading | `AnalyticsTabs.tsx:271` |
| P2-11 | P2 | 前端 | ErrorBoundary 覆盖不全 | 多个组件 |
| P2-12 | P2 | 架构 | CSV 双路径复杂度 | `api.ts`, `index.ts` |
| P3-1 | P3 | 可靠性 | WS Set 清理不完善 | `api.ts:98` |
| P3-2 | P3 | 可靠性 | EventEmitter 无上限 | `state.ts:46` |
| P3-3 | P3 | 测试 | Singletons 影响测试 | `state.ts` |
| P3-4 | P3 | 前端 | 内联 Config Fallback | `Dashboard.tsx:184` |
| P3-5 | P3 | 前端 | Theme 水合竞态 | `index.html`, `main.tsx` |
| P3-6 | P3 | 前端 | 常量分散 | 多个组件 |
| P3-7 | P3 | 前端 | 过度 Memoization | `AnalyticsTabs.tsx:154` |
| P3-8 | P3 | 前端 | Vite 构建未优化 | `vite.config.ts` |
