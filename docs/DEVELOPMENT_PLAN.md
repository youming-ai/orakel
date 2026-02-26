# Orakel 开发计划

> 基于 [CODE_REVIEW.md](./CODE_REVIEW.md) 的 32 项审查发现
> 总估时：7-9 工作日（单人）
> 原则：每个 task 可独立提交，不引入新的 broken state

---

## 总览

```
Sprint 1 ▸ 安全门控 + 紧急修复          2 天   (P0 全部 + P1 部分)
Sprint 2 ▸ 网络性能 + 数据层类型化       2 天   (P1 剩余 + P0-3 深化)
Sprint 3 ▸ 结构拆分 (index.ts 瘦身)     3 天   (P2 后端)
Sprint 4 ▸ 前端修正 + DX 改善           2 天   (P1/P2 前端)
Backlog  ▸ P3 低优先级                  按需
```

每个 Sprint 结束时须通过 `bun run lint && bun run typecheck && bun run test`。

---

## Sprint 1 — 安全门控 + 紧急修复（2 天）

> 目标：消除可导致错误交易和资金风险的问题。完成后 bot 的运行时安全性达到生产标准。

### Day 1: 数值安全 + 运行时防护

#### Task 1.1 — decide() / executeTrade() NaN 门控
> 对应 P0-1

**改动文件**：
- `src/engines/edge.ts` — `decide()` 函数入口
- `src/trader.ts` — `executeTrade()` 函数入口
- `src/engines/edge.test.ts` — 新增 NaN 测试用例

**具体改动**：
1. `decide()` 入口（~line 290）添加校验：
   ```typescript
   if (!Number.isFinite(modelUp) || !Number.isFinite(modelDown)) {
     return { action: "NO_TRADE", side: null, phase, regime, reason: "model_prob_not_finite" };
   }
   if (!Number.isFinite(marketUp) || !Number.isFinite(marketDown)) {
     return { action: "NO_TRADE", side: null, phase, regime, reason: "market_price_not_finite" };
   }
   ```
2. `executeTrade()` 入口（~line 430）添加校验：
   ```typescript
   const marketPrice = isUp ? parseFloat(String(marketUp)) : parseFloat(String(marketDown));
   if (!Number.isFinite(marketPrice)) {
     log.warn(`Non-finite market price for ${signal.marketId}, aborting trade`);
     return { success: false, reason: "price_not_finite" };
   }
   ```
3. 测试：`edge.test.ts` 新增 `describe("NaN safety")` — 传入 NaN/Infinity/undefined 的 modelUp/marketUp，断言返回 NO_TRADE。

**验收标准**：
- [x] `decide(NaN, ...)` → `{ action: "NO_TRADE", reason: "model_prob_not_finite" }`
- [x] `executeTrade({ marketUp: NaN, ... })` → `{ success: false, reason: "price_not_finite" }`
- [x] 现有测试全部通过
- [x] `bun run typecheck && bun run test` 通过

---

#### Task 1.2 — 主循环降级模式
> 对应 P1-2

**改动文件**：
- `src/index.ts` — `while(true)` 主循环（~line 1191）

**具体改动**：
在主循环添加全局健康追踪：
```typescript
let consecutiveAllFails = 0;
const SAFE_MODE_THRESHOLD = 3;

while (true) {
  // ... existing shouldRunLoop check ...
  const results = await Promise.allSettled(markets.map((m) => processMarket({ ... })));
  const allFailed = results.every((r) => r.status === "rejected");

  if (allFailed) {
    consecutiveAllFails++;
    log.warn(`All markets failed (${consecutiveAllFails}/${SAFE_MODE_THRESHOLD})`);
    if (consecutiveAllFails >= SAFE_MODE_THRESHOLD) {
      log.error("Entering safe mode: all markets failed consecutively, pausing trades");
      // 不停止循环，只跳过交易决策，dashboard 继续可用
    }
  } else {
    if (consecutiveAllFails >= SAFE_MODE_THRESHOLD) {
      log.info("Exiting safe mode: at least one market recovered");
    }
    consecutiveAllFails = 0;
  }
  // ...
}
```

**验收标准**：
- [x] 连续 3 次全失败后日志输出 safe mode 警告
- [x] 恢复后自动退出 safe mode
- [x] Dashboard 在 safe mode 下仍可用

---

#### Task 1.3 — Binance REST 超时
> 对应 P1-3

**改动文件**：
- `src/data/binance.ts` — `fetchKlines()` 和 `fetchLastPrice()`

**具体改动**：
```typescript
// binance.ts — 两个 fetch 调用都加 signal
const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
```

**验收标准**：
- [x] 两个函数均有超时
- [x] 超时后抛出 AbortError，被 processMarket catch

---

#### Task 1.4 — reloadConfig() 保留 marketPerformance
> 对应 P1-7

**改动文件**：
- `src/config.ts` — `reloadConfig()` 函数（~line 284）

**具体改动**：
```typescript
export function reloadConfig(): AppConfig {
  const prevMarketPerformance = CONFIG.strategy.marketPerformance; // 保留

  // ... existing reload logic ...

  CONFIG.strategy = {
    // ... existing fields ...
    marketPerformance: prevMarketPerformance ?? fileStrategy.marketPerformance,
  };

  return CONFIG;
}
```

**验收标准**：
- [x] 热重载后 `CONFIG.strategy.marketPerformance` 保持不变
- [x] 首次加载时从文件读取

---

### Day 2: 凭证安全 + Config 原子写入

#### Task 1.5 — Config 原子写入
> 对应 P1-6

**改动文件**：
- `src/api.ts` — `PUT /config` handler（~line 421）
- `src/config.ts` — 新增 `atomicWriteConfig()` 辅助函数

**具体改动**：
1. `config.ts` 新增：
   ```typescript
   import { writeFile, rename } from "node:fs/promises";

   export async function atomicWriteConfig(configPath: string, data: unknown): Promise<void> {
     const tmp = `${configPath}.tmp.${Date.now()}`;
     await writeFile(tmp, JSON.stringify(data, null, 2));
     await rename(tmp, configPath); // POSIX 原子操作
   }
   ```
2. `api.ts` 中 `PUT /config` 改用 `atomicWriteConfig()`。

**验收标准**：
- [x] 写入失败不会损坏 config.json
- [x] 并发写入不会产生 partial JSON

---

#### Task 1.6 — API 凭证安全评估 + 最低防护
> 对应 P0-2, P0-4

**改动文件**：
- `src/trader.ts` — `CREDS_PATH` 相关逻辑
- `web/src/components/LiveConnect.tsx` — 私钥提交逻辑

**具体改动**：
1. `trader.ts`：写入 `api-creds.json` 后设置文件权限 `0o600`：
   ```typescript
   fs.writeFileSync(CREDS_PATH, JSON.stringify(creds));
   fs.chmodSync(CREDS_PATH, 0o600);
   ```
2. `LiveConnect.tsx`：添加用户提示，明确标注私钥仅通过 localhost 传输：
   ```typescript
   // 仅当非 localhost 时显示警告
   const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
   ```
3. `.gitignore` / `.dockerignore` 确认已包含 `data/api-creds.json`。

**验收标准**：
- [x] `api-creds.json` 文件权限为 600
- [x] 非 localhost 环境显示安全警告
- [x] gitignore 覆盖凭证文件

**注意**：这是最低限度修复。长期方案是让后端从环境变量或加密密钥库读取，不通过 HTTP 传输。

---

#### Sprint 1 收尾检查

```bash
bun run lint && bun run typecheck && bun run test
```

**Sprint 1 交付物**：
- NaN 不再能触发交易（有测试覆盖）
- 全市场失败时自动降级
- Binance 请求有超时
- Config 写入原子化
- 凭证文件权限收紧
- 热重载不再丢失 marketPerformance

---

## Sprint 2 — 网络性能 + 数据层类型化（2 天）

> 目标：减少 80%+ 每 tick 网络负载，消除 Polymarket unknown 类型链。

### Day 3: REST 缓存层

#### Task 2.1 — 通用 TTL 缓存工具
> 对应 P1-1 前置

**新建文件**：
- `src/cache.ts`

**具体实现**：
```typescript
export function createTtlCache<T>(ttlMs: number) {
  let value: T | undefined;
  let expiresAt = 0;

  return {
    get(): T | undefined {
      return Date.now() < expiresAt ? value : undefined;
    },
    set(v: T): void {
      value = v;
      expiresAt = Date.now() + ttlMs;
    },
    invalidate(): void {
      expiresAt = 0;
    },
  };
}
```

**验收标准**：
- [x] 纯函数，无副作用
- [x] 单元测试覆盖 get/set/expire/invalidate

---

#### Task 2.2 — Klines 缓存（TTL 60s）
> 对应 P1-1

**改动文件**：
- `src/data/binance.ts` — 包装 `fetchKlines()`
- `src/index.ts` — 调用方无需改动（接口不变）

**具体改动**：
```typescript
import { createTtlCache } from "../cache.ts";

const klinesCache = new Map<string, ReturnType<typeof createTtlCache<Candle[]>>>();

export async function fetchKlines({ symbol, interval, limit }: KlinesParams): Promise<Candle[]> {
  const key = `${symbol}:${interval}:${limit}`;
  let cache = klinesCache.get(key);
  if (!cache) {
    cache = createTtlCache<Candle[]>(60_000);
    klinesCache.set(key, cache);
  }
  const cached = cache.get();
  if (cached) return cached;

  // ... existing fetch logic ...
  cache.set(result);
  return result;
}
```

**验收标准**：
- [x] 60 秒内相同参数的 klines 请求返回缓存
- [x] TTL 过期后重新请求
- [x] 现有测试通过

---

#### Task 2.3 — Orderbook 缓存（TTL 3s）+ Market Metadata 缓存（TTL 30s）
> 对应 P1-1

**改动文件**：
- `src/data/polymarket.ts` — 包装 `fetchOrderBook()` 和 `fetchMarketBySlug()`

**具体改动**：对 `fetchOrderBook` 和 `fetchMarketBySlug` 应用与 Task 2.2 相同的缓存模式。

| 函数 | TTL | 缓存键 |
|------|-----|--------|
| `fetchOrderBook()` | 3s | `tokenId` |
| `fetchMarketBySlug()` | 30s | `slug` |
| `fetchClobPrice()` | 3s | `tokenId` |

**验收标准**：
- [x] 每 tick 的 Polymarket REST 调用从 ~4 次降至 0-1 次（缓存命中时）
- [x] 现有 `polymarket.test.ts` 测试通过

---

#### Task 2.4 — Prepared Statements 缓存
> 对应 P2-3

**改动文件**：
- `src/db.ts` — `statements` 对象（~line 283）

**具体改动**：
将 getter 模式改为 lazy-init + 缓存：
```typescript
function cachedPrepare(sql: string): ReturnType<Database["prepare"]> {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, getDb().prepare(sql));
  }
  return stmtCache.get(sql)!;
}

// 使用
export const statements = {
  insertSignal: () => cachedPrepare("INSERT INTO signals ..."),
  // ...
};
```

DB 重新初始化时清空缓存。

**验收标准**：
- [x] 同一 SQL 只 prepare 一次
- [x] DB 重建时缓存清空
- [x] 现有测试通过

---

### Day 4: Polymarket 类型安全

#### Task 2.5 — Polymarket Zod Schema
> 对应 P0-3

**改动文件**：
- `src/types.ts` — 新增 `GammaMarket` 类型
- `src/data/polymarket.ts` — 新增 Zod schema + parse 函数
- `src/data/polymarket.test.ts` — 新增 schema 测试

**具体改动**：
1. 定义 schema 覆盖实际使用字段：
   ```typescript
   import { z } from "zod";

   const GammaMarketSchema = z.object({
     slug: z.string(),
     question: z.string().optional(),
     endDate: z.string(),
     outcomes: z.union([z.string(), z.array(z.string())]),
     outcomePrices: z.union([z.string(), z.array(z.number())]),
     clobTokenIds: z.union([z.string(), z.array(z.string())]),
     bestBid: z.number().optional(),
     bestAsk: z.number().optional(),
     spread: z.number().optional(),
   });

   export type GammaMarket = z.infer<typeof GammaMarketSchema>;
   ```

2. `fetchMarketBySlug()` 返回 `GammaMarket` 而非 `unknown`。
3. 解析失败时 log.warn 并返回 null（降级而非崩溃）。

**验收标准**：
- [x] `fetchMarketBySlug()` 返回类型为 `GammaMarket | null`
- [x] 无效数据返回 null + 日志警告
- [x] 测试覆盖正常数据 + 畸形数据

---

#### Task 2.6 — 消除 index.ts 中的 unknown/AnyRecord
> 对应 P0-3 延伸

**改动文件**：
- `src/index.ts` — 替换 `poly.market as AnyRecord` 相关代码

**具体改动**：
1. `processMarket()` 中接收的 `poly.market` 改为 `GammaMarket | null`。
2. 删除 `type AnyRecord = Record<string, unknown>` 定义。
3. 删除 `extractNumericFromMarket()` 递归函数，改用 schema 字段直接访问。
4. 所有从 market 读取的字段通过 `.` 访问而非 `extractNumericFromMarket()`。

**验收标准**：
- [x] `index.ts` 中无 `AnyRecord` 和 `as unknown`
- [x] `extractNumericFromMarket()` 已删除或移入 polymarket.ts 作为 private helper
- [x] typecheck 通过

---

#### Sprint 2 收尾检查

```bash
bun run lint && bun run typecheck && bun run test
```

**Sprint 2 交付物**：
- 每 tick 网络请求减少 80%+
- Polymarket 数据有 schema 校验
- index.ts 中无 unknown 类型链
- Prepared statements 只 prepare 一次

---

## Sprint 3 — 结构拆分（3 天）

> 目标：将 index.ts 从 1498 行瘦身到 <200 行。提取纯函数层，使交易逻辑可独立测试。

### Day 5: 提取终端渲染 + 持久化

#### Task 3.1 — 提取终端渲染到 src/terminal.ts
> 对应 P2-1

**新建文件**：
- `src/terminal.ts`

**改动文件**：
- `src/index.ts` — 删除 ANSI 渲染相关函数

**具体改动**：
将以下函数从 `index.ts` 移至 `terminal.ts`：
- `renderTable()`（或等价的终端渲染逻辑）
- ANSI 颜色常量
- `readline` 相关代码

`terminal.ts` 导出 `renderDashboard(results: ProcessMarketResult[]): void`。

**验收标准**：
- [x] `index.ts` 不再 import `readline`
- [x] 终端输出与重构前一致
- [x] typecheck 通过

---

#### Task 3.2 — 提取持久化逻辑到 src/persistence.ts
> 对应 P2-1

**新建文件**：
- `src/persistence.ts`

**改动文件**：
- `src/index.ts` — 删除 CSV/SQLite 写入代码

**具体改动**：
将以下逻辑从 `index.ts` 移至 `persistence.ts`：
- `writeLatestSignal()` (~line 580)
- 信号写入 SQLite + CSV 的逻辑
- `emitSignalNew()` / `emitStateSnapshot()` 调用

导出 `persistSignal(result: ProcessMarketResult): void`。

**验收标准**：
- [x] `index.ts` 不再直接调用 `statements.insertSignal`
- [x] CSV 和 SQLite 写入逻辑集中在一个文件
- [x] typecheck 通过

---

#### Task 3.3 — 合并 paperTracker / liveTracker 为工厂函数
> 对应 P2-2

**改动文件**：
- `src/index.ts` — 替换两个 tracker 对象

**具体改动**：
```typescript
function createTradeTracker() {
  return {
    markets: new Set<string>(),
    windowStartMs: 0,
    globalCount: 0,
    clear() { this.markets.clear(); this.globalCount = 0; this.windowStartMs = 0; },
    setWindow(startMs: number) { if (this.windowStartMs !== startMs) { this.clear(); this.windowStartMs = startMs; } },
    has(marketId: string, startMs: number) { return this.markets.has(`${marketId}:${startMs}`); },
    record(marketId: string, startMs: number) { this.markets.add(`${marketId}:${startMs}`); this.globalCount++; },
    canTradeGlobally(max: number) { return this.globalCount < max; },
  };
}

const paperTracker = createTradeTracker();
const liveTracker = createTradeTracker();
```

**验收标准**：
- [x] 两个 tracker 共享同一实现
- [x] 行为与重构前一致

---

### Day 6: processMarket 三层拆分

#### Task 3.4 — 提取数据获取层 src/pipeline/fetch.ts
> 对应 P2-1 核心

**新建文件**：
- `src/pipeline/fetch.ts`

**改动文件**：
- `src/index.ts` — 删除 processMarket 中的数据获取部分

**具体改动**：
提取 `processMarket()` 中的数据获取部分（~line 670-780）为独立函数：
```typescript
export async function fetchMarketData(
  market: MarketConfig,
  timing: CandleWindowTiming,
  streams: StreamHandles,
): Promise<RawMarketData> {
  // WS 最新价
  // Binance klines (cached)
  // Polymarket market data (cached)
  // Chainlink price
  // Orderbook (cached)
  return { klines, binancePrice, chainlinkPrice, polyMarket, orderbook, ... };
}
```

定义 `RawMarketData` 接口到 `src/types.ts`。

**验收标准**：
- [x] `fetchMarketData()` 是纯 IO 函数，无计算逻辑
- [x] 返回类型明确，无 unknown
- [x] typecheck 通过

---

#### Task 3.5 — 提取计算层 src/pipeline/compute.ts
> 对应 P2-1 核心

**新建文件**：
- `src/pipeline/compute.ts`
- `src/pipeline/compute.test.ts`

**改动文件**：
- `src/index.ts` — 删除指标计算 + 概率融合 + 决策部分

**具体改动**：
```typescript
export function computeMarketDecision(
  data: RawMarketData,
  timing: CandleWindowTiming,
  config: AppConfig,
  marketId: string,
): MarketDecision {
  // 1. 计算指标 (RSI, MACD, VWAP, HA)
  // 2. 检测 Regime
  // 3. 评分 + 概率融合
  // 4. 计算 Edge
  // 5. decide()
  return { action, side, edge, confidence, indicators, ... };
}
```

**关键**：这是 **纯函数**，无 IO，无副作用。输入数据 → 输出决策。

**验收标准**：
- [x] 函数签名中无 Promise（同步纯函数）
- [x] 不 import 任何 IO 模块（fs, fetch, db）
- [x] 单元测试覆盖：给定固定输入，输出确定
- [x] typecheck 通过

---

### Day 7: 瘦身 index.ts + CSV 清理

#### Task 3.6 — processMarket 重组为编排层
> 对应 P2-1 收尾

**改动文件**：
- `src/index.ts`

**具体改动**：
`processMarket()` 简化为：
```typescript
async function processMarket({ market, timing, streams, state }): Promise<ProcessMarketResult> {
  const data = await fetchMarketData(market, timing, streams);
  const decision = computeMarketDecision(data, timing, CONFIG, market.id);
  persistSignal(market.id, decision, data);
  return buildResult(market, data, decision, state);
}
```

目标：`processMarket()` < 30 行。

**验收标准**：
- [x] `processMarket()` < 30 行
- [x] `index.ts` 总行数 < 400
- [x] Bot 运行行为与重构前一致（手动验证）
- [x] `bun run test` 全通过

---

#### Task 3.7 — CSV 路径废弃评估
> 对应 P2-12

**改动文件**：视评估结果而定

**具体改动**：
1. 检查 `PERSIST_BACKEND` 环境变量在生产中的实际值
2. 如果已全部使用 SQLite：
   - 标记 CSV 相关代码为 `@deprecated`
   - 从 `api.ts` 移除 CSV 解析逻辑
   - 保留但不再主动维护 CSV 写入路径
3. 如果仍有 CSV 依赖：保持现状，仅添加注释说明计划

**验收标准**：
- [x] CSV 路径状态明确记录
- [x] 无功能回归

---

#### Sprint 3 收尾检查

```bash
bun run lint && bun run typecheck && bun run test
```

**Sprint 3 交付物**：
- `index.ts` 从 1498 行降至 <400 行
- 交易决策逻辑可独立测试（纯函数）
- 终端渲染、持久化、数据获取各有独立模块
- Tracker 重复代码消除

---

## Sprint 4 — 前端修正 + DX 改善（2 天）

> 目标：修复前端运行时错误，改善开发体验。

### Day 8: API 层 + 数据流修复

#### Task 4.1 — API 客户端错误处理
> 对应 P1-4

**改动文件**：
- `web/src/lib/api.ts` — `get()`, `post()`, `put()` 函数

**具体改动**：
```typescript
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}
// post/put 同理
```

**验收标准**：
- [x] 500/404 响应抛出明确错误而非静默失败
- [x] TanStack Query 能正常 catch 并显示错误

---

#### Task 4.2 — 切换到 useDashboardStateWithWs()
> 对应 P1-8

**改动文件**：
- `web/src/components/Dashboard.tsx` — hook 调用

**具体改动**：
```diff
- const { data: state, isLoading } = useDashboardState();
+ const { data: state, isLoading } = useDashboardStateWithWs();
```

**验收标准**：
- [x] WS 连接时停止 HTTP 轮询
- [x] WS 断开时自动回退到轮询
- [x] Dashboard 数据更新无感知变化

---

#### Task 4.3 — WS 缓存合并加固
> 对应 P2-4

**改动文件**：
- `web/src/lib/queries.ts` — `createWsCacheHandler()`

**具体改动**：
```typescript
case "state:snapshot": {
  const prev = qc.getQueryData<DashboardState>(queries.state().queryKey);
  if (prev && msg.data && typeof msg.data === "object") {
    const patch = msg.data as Partial<DashboardState>;
    qc.setQueryData(queries.state().queryKey, {
      ...prev,
      // 显式枚举可更新字段，缺失字段保留 prev 值
      markets: patch.markets ?? prev.markets,
      updatedAt: patch.updatedAt ?? prev.updatedAt,
      config: patch.config ?? prev.config,
      paperRunning: patch.paperRunning ?? prev.paperRunning,
      liveRunning: patch.liveRunning ?? prev.liveRunning,
      paperStats: patch.paperStats ?? prev.paperStats,
      paperBalance: patch.paperBalance ?? prev.paperBalance,
      liveWallet: patch.liveWallet ?? prev.liveWallet,
      wallet: patch.wallet ?? prev.wallet,
      stopLoss: patch.stopLoss !== undefined ? patch.stopLoss : prev.stopLoss,
      todayStats: patch.todayStats ?? prev.todayStats,
    });
  }
  break;
}
```

**验收标准**：
- [x] 部分更新不会丢失已有字段
- [x] null 值（如 stopLoss = null）能正确传递

---

#### Task 4.4 — 提取 DEFAULT_CONFIG 常量
> 对应 P3-4

**改动文件**：
- `web/src/components/Dashboard.tsx`

**具体改动**：
将 line 184 的内联 config fallback 提取为模块级常量：
```typescript
const DEFAULT_CONFIG: DashboardState["config"] = {
  strategy: { edgeThresholdEarly: 0.06, /* ... */ },
  paperRisk: { /* ... */ },
  liveRisk: { /* ... */ },
};
```

**验收标准**：
- [x] 内联对象消除
- [x] 不再每次渲染创建新对象

---

### Day 9: 前端类型安全 + UX 修复

#### Task 4.5 — Hono RPC 类型共享（或路径映射）
> 对应 P1-5

**改动文件**：
- `web/tsconfig.json` — 路径映射
- `web/src/lib/api.ts` — 删除重复类型，import from backend

**方案选择**（二选一）：

**方案 A — 路径映射**（推荐，零依赖）：
```jsonc
// web/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@server/*": ["../src/*"]
    }
  }
}
```
前端 `import type` from `@server/types.ts`。

**方案 B — Hono RPC Client**：
使用 `hono/client` 的类型推断，需要后端导出 route chain 类型。

**验收标准**：
- [x] `web/src/lib/api.ts` 中删除至少 80% 的手动类型定义
- [x] 后端类型变更时前端 typecheck 自动报错
- [x] `bun run typecheck` 通过（前后端）

---

#### Task 4.6 — Mutations Loading 状态
> 对应 P2-10

**改动文件**：
- `web/src/components/AnalyticsTabs.tsx` — Save Config 按钮

**具体改动**：
```typescript
<Button
  onClick={saveConfig}
  disabled={configMutation.isPending}
>
  {configMutation.isPending ? "Saving..." : "Save Config"}
</Button>
```

对其他 mutations（paper start/stop、live connect/disconnect）也添加 pending 状态。

**验收标准**：
- [x] 所有 mutation 按钮在请求中禁用
- [x] 显示 loading 文案

---

#### Task 4.7 — 关键可访问性修复
> 对应 P2-8（部分）

**改动文件**：
- `web/src/components/Header.tsx` — theme toggle
- `web/src/components/MarketCard.tsx` — expand button

**具体改动**：
```typescript
// Header.tsx — theme toggle
<button aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} ...>

// MarketCard.tsx — expand
<button aria-expanded={expanded} aria-controls={`technicals-${marketId}`} ...>
<div id={`technicals-${marketId}`} role="region">
```

**验收标准**：
- [x] 所有交互按钮有 aria-label
- [x] 展开区域有 aria-expanded + aria-controls

---

#### Sprint 4 收尾检查

```bash
cd web && bun run typecheck
bun run lint && bun run typecheck && bun run test
```

**Sprint 4 交付物**：
- API 错误被正确处理和展示
- WS 连接时不再冗余轮询
- 前后端类型共享，无重复定义
- 所有 mutations 有 loading 状态
- 基础可访问性达标

---

## Backlog — P3 低优先级

按需处理，不阻塞主线。

| Task | 对应 | 估时 | 说明 |
|------|------|------|------|
| WS Set 心跳 + 清理 | P3-1 | 1h | 添加 ping/pong，定时清理 |
| EventEmitter maxListeners | P3-2 | 15m | `botEvents.setMaxListeners(20)` |
| Theme 水合统一 | P3-5 | 30m | 删除 index.html inline script，统一到 Zustand |
| 常量集中化 | P3-6 | 30m | 散落常量移入 constants.ts |
| AnalyticsTabs memo 审计 | P3-7 | 1h | React DevTools profiling，删除无收益 memo |
| Vite 构建 code splitting | P3-8 | 30m | manualChunks for recharts/wagmi |
| ConnectWallet 安全转换 | P2-9 | 30m | 检查 status === "success" |
| ChartErrorBoundary 全覆盖 | P2-11 | 30m | 包裹 MarketsTab 图表 |
| MarketCard 拆分子组件 | P2-7 | 2h | 纯重构，不影响功能 |
| Prop Drilling → Context | P2-6 | 3h | AnalyticsContext 替代 11 props |

---

## 依赖图

```
Sprint 1 (安全)  ──┐
                    ├──▸ Sprint 2 (性能+类型) ──▸ Sprint 3 (结构拆分) ──▸ Sprint 4 (前端)
                    │                                                          ↑
                    └────── Task 1.5 (原子写入) ─────────────────────────────────┘
                                                                          (独立可并行)
```

- Sprint 1 → Sprint 2：类型化依赖安全门控先就位
- Sprint 2 → Sprint 3：缓存层就位后拆分 processMarket 更安全（减少 IO 纠缠）
- Sprint 4 可与 Sprint 3 并行（前后端独立）
- Backlog 任何时候可插入

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| processMarket 拆分引入回归 | 交易行为变化 | 拆分前用当前输出做 snapshot test |
| Polymarket API schema 变更 | Zod parse 失败 | 降级返回 null，log warn，不崩溃 |
| 前端类型共享打破构建 | CI 失败 | 先跑通 typecheck 再合并 |
| REST 缓存导致决策用旧数据 | 交易质量下降 | TTL 保守（klines 60s 合理，orderbook 3s 够新） |
| Config 原子写入在 Windows 失败 | rename 行为不同 | 生产环境全是 Linux/macOS，可忽略 |
