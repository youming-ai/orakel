# Orakel Architecture Review

## Executive Summary

Orakel is a well-structured Bun monorepo for Polymarket crypto trading. The architecture follows clean separation of concerns with three packages: `shared` (types/contracts), `bot` (backend trading engine), and `web` (frontend dashboard). While the overall design is pragmatic for a single-process trading bot, there are significant concerns around **global mutable state**, **scattered trade lifecycle logic**, and **best-effort consistency** that present risks for production trading operations.

**Overall Grade: B+** — Good for current scope, needs tightening for production scale.

---

## 1. System Architecture Overview

### Monorepo Structure

```
packages/
├── shared/           # @orakel/shared — TypeScript contracts + Zod schemas
├── bot/              # @orakel/bot — Trading engine (Bun + Hono + Drizzle)
└── web/              # @orakel/web — Dashboard (React 19 + Vite + Cloudflare Workers)
```

**Deployment Model:**
- **Frontend**: Cloudflare Workers (edge deployment)
- **Backend**: Docker VPS (single-process Bun runtime)

### Architectural Patterns

| Pattern | Implementation | Assessment |
|---------|----------------|------------|
| **Layered Architecture** | `data/ → pipeline/ → runtime/ → trading/` | ✅ Good separation |
| **Repository Pattern** | `repositories/` with Drizzle ORM | ✅ Clean data access |
| **Pipeline Pattern** | `fetch.ts → compute.ts → processMarket.ts` | ✅ Clear data flow |
| **Observer Pattern** | EventEmitter in `core/state.ts` | ⚠️ Global, hard to trace |
| **Singleton Pattern** | Module-level state (CONFIG, botEvents) | ❌ Anti-pattern for testability |
| **Factory Pattern** | `createLogger()`, `createMarketStreams()` | ✅ Acceptable for DI-free approach |

---

## 2. Component Analysis

### 2.1 Entry Point & Bootstrap (`packages/bot/src/index.ts`)

**Current Approach:**
Manual dependency composition with 15+ parameters passed to `runMainLoop()`.

```typescript
// Line 124-166: Main loop receives many dependencies
await runMainLoop({
  markets, states, streams, clobWs, orderManager,
  onchainRuntime, liveSettler, prevWindowStartMs,
  paperTracker, liveTracker: orderTracker,
  paperAccount, liveAccount, processMarket, renderDashboard,
  onLiveOrderPlaced: {...}
});
```

**Strengths:**
- Explicit dependencies (no hidden globals in main loop)
- Easy to follow initialization order

**Concerns:**
- Parameter bloat indicates high cohesion
- No `Application` wrapper for lifecycle management
- Shutdown relies on `process.exit()` rather than graceful cancellation

**Recommendation:** Introduce a `RuntimeContext` object:
```typescript
interface RuntimeContext {
  config: Config;
  state: StatePublisher;
  accounts: AccountManager;
  wallet: WalletClient;
  orderManager: OrderManager;
}
```

---

### 2.2 State Management (`packages/bot/src/core/state.ts`)

**Current Approach:**
Hybrid mutable state + EventEmitter:

```typescript
// Module-level mutable state
let _markets: MarketSnapshot[] = [];
let _paperRunning = false;
let _liveRunning = false;

// Global event bus
export const botEvents = new EventEmitter();

// Version tracking for consistency
let _stateVersion = 0;
```

**Strengths:**
- Simple and fast for single-process architecture
- Version tracking enables frontend consistency checks
- WebSocket broadcasting integration

**Critical Concerns:**
1. **Global mutable state** — Any module can mutate state unpredictably
2. **No transaction boundaries** — DB, memory, and WS updates are separate operations
3. **Testability issues** — State persists between tests (module-level singletons)
4. **No thread safety** — Bun is single-threaded, but this limits future scaling

**Recommendation:**
Split into two concerns:
```typescript
// 1. Immutable state store
interface StateStore {
  get(): DashboardState;
  update(patch: Partial<DashboardState>): void;
  subscribe(callback: (state: DashboardState) => void): Unsubscribe;
}

// 2. Event publisher (internal)
interface EventPublisher {
  emit(event: BotEvent): void;
}
```

---

### 2.3 Trade Lifecycle (Scattered Logic)

**Current Flow:**
Trade execution logic is spread across **6 modules**:

1. `trading/executionService.ts` — Order placement
2. `runtime/orderStatusSync.ts` — Status reconciliation
3. `runtime/orderRecovery.ts` — Restart recovery
4. `trading/accountService.ts` — Settlement
5. `trading/orderManager.ts` — Order tracking
6. `runtime/tradeDispatch.ts` — Signal → Order routing

**Critical Concern:**
The most critical system function (executing trades) has no single owner. This creates:
- Race conditions between status updates
- Inconsistent error handling
- Difficult debugging when trades fail
- No clear audit trail

**Recommendation:**
Consolidate into a `TradeLifecycleCoordinator`:
```typescript
class TradeLifecycleCoordinator {
  async execute(signal: TradeSignal): Promise<TradeResult>;
  async reconcile(orderId: string): Promise<void>;
  async recover(): Promise<void>; // On restart
  async settle(trade: Trade): Promise<SettlementResult>;
}
```

---

### 2.4 Data Pipeline (`packages/bot/src/pipeline/`)

**Flow:**
```
External APIs → fetch.ts → compute.ts → processMarket.ts → TradeDecision
```

**Strengths:**
- Clean functional composition
- `processMarket()` is pure and testable
- Multiple price sources with fallback (Bybit, Chainlink, Polymarket)

**Concerns:**
- No backpressure handling — if `fetch()` is faster than `compute()`, data piles up
- Synchronous loop — one slow market blocks others

**Recommendation:**
Consider per-market workers if scaling beyond 2-3 markets:
```typescript
// Current (synchronous)
for (const market of markets) {
  await processMarket(market); // Blocks
}

// Future (concurrent, if needed)
await Promise.all(markets.map(m => processMarket(m)));
```

---

### 2.5 Database Layer (`packages/bot/src/db/` + `repositories/`)

**Schema Design:**
- **trades** — Trade records with reconciliation status
- **botState** — Singleton state per mode (paper/live)
- **livePendingOrders** — Order tracking with full context
- **onchainEvents** — Blockchain events (unique tx + logIndex)
- **balanceSnapshots** — Balance history
- **signalLog** — Audit trail

**Strengths:**
- Drizzle ORM provides type-safe queries
- Repository pattern encapsulates domain logic
- Reconciliation tracking (`reconStatus`, `reconConfidence`)

**Critical Concerns:**
1. **No transaction management** — Complex operations (place order + persist + emit) are not atomic
2. **Text timestamps** — `timestamp: text` instead of `integer` or `timestamptz`
3. **No foreign keys** — Referential integrity not enforced at DB level

**Recommendation:**
Add transaction wrapper for critical paths:
```typescript
export async function withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx);
  });
}
```

---

### 2.6 Configuration System (`core/config.ts` + `env.ts`)

**Two-Layer Design:**
1. **Environment** (`.env`) — Secrets, ports, mode (immutable)
2. **JSON Config** (`config.json`) — Strategy thresholds (hot-reload)

**Hot Reload Implementation:**
```typescript
fs.watch(configPath, () => {
  const newConfig = loadConfig();
  Object.assign(CONFIG, newConfig); // In-place mutation!
  onConfigReload?.();
});
```

**Strengths:**
- Atomic file writes (temp → rename)
- Per-market strategy overrides

**Critical Concerns:**
1. **In-place mutation** of `CONFIG` object — references may be stale
2. **No validation on reload** — Invalid config can crash running system
3. **Unused `onConfigReload()`** — Many modules cache config at startup

**Evidence of Stale Config:**
```typescript
// OrderManager copies config at construction
this.pollInterval = CONFIG.maintenance.orderPollIntervalMs;

// CLOB circuit breaker caches thresholds
const maxFailures = CONFIG.infra.circuitBreakerMaxFailures;
```

**Recommendation:**
- Make config immutable after load
- Explicitly mark which fields support hot reload
- Rebuild affected components on change

---

### 2.7 Frontend Architecture (`packages/web/src/`)

**State Management:**
- **TanStack Query** — Server state (API calls)
- **Zustand** — UI state (view mode, dialogs)
- **WebSocket** — Real-time updates

**Structure:**
```
src/
├── app/           # Routing, layout, WS integration
├── components/    # UI components (shadcn/ui)
├── lib/           # API client, stores, utils
├── hooks/         # Custom React hooks
└── widgets/       # Page-level widgets
```

**Strengths:**
- Clean separation of server vs UI state
- Shared contracts prevent type drift
- Zustand persistence for UI preferences

**Critical Concerns:**
1. **Multiple WebSocket connections** — `useDashboardStateWithWs()` creates new WS each mount
   - Called in `AppShell.tsx`, `OverviewPanel.tsx`, `ConfirmToggleDialog.tsx`
   - Result: 3+ WS connections per browser tab

2. **No connection pooling** — Each component manages its own WS lifecycle

**Recommendation:**
Move WebSocket to app-level provider:
```typescript
// App.tsx
<WebSocketProvider>
  <AppShell />
</WebSocketProvider>

// hooks/useDashboardState.ts — Uses shared connection
const { state } = useWebSocket(); // Singleton hook
```

---

## 3. Data Flow Analysis

### Trading Cycle Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MARKET DATA LAYER                            │
├─────────────────────────────────────────────────────────────────────┤
│  Bybit WS ───┐                                                      │
│  Chainlink ──┼──► fetch.ts ───► compute.ts ───► processMarket.ts   │
│  Polymarket ─┘     (prices)     (signals)        (decisions)       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EXECUTION LAYER                                │
├─────────────────────────────────────────────────────────────────────┤
│  tradeDispatch.ts ──► executionService.ts ──► orderManager.ts      │
│  (route paper/live)    (place orders)          (track status)      │
└─────────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   DATABASE   │    │    STATE     │    │   WEBSOCKET  │
│  (persist)   │    │  (memory)    │    │  (broadcast) │
└──────────────┘    └──────────────┘    └──────────────┘
```

### Consistency Analysis

| Operation | DB Write | State Update | WS Emit | Atomic? |
|-----------|----------|--------------|---------|---------|
| Place Order | ✅ | ✅ | ✅ | ❌ No |
| Status Update | ✅ | ✅ | ✅ | ❌ No |
| Settlement | ✅ | ✅ | ✅ | ❌ No |

**Risk:** Partial failure can leave systems inconsistent. Example:
1. Order placed on Polymarket ✓
2. DB write fails ✗
3. Frontend never sees the order

**Mitigation:** The system uses "best-effort" consistency with reconciliation loops (`orderStatusSync.ts`, `orderRecovery.ts`). This is acceptable for a hobby bot but risky for production.

---

## 4. Error Handling Assessment

### Current Strategies

| Strategy | Implementation | Coverage |
|----------|----------------|----------|
| **Try/Catch + Log** | `log.warn()` / `log.error()` | Good |
| **Safe Mode** | Stop after N consecutive failures | Partial |
| **Circuit Breaker** | Config-defined thresholds | Good |
| **Zod Validation** | `env.ts`, `config.ts` | Excellent |
| **Graceful Degradation** | Default values on failure | Good |

### Weaknesses

1. **Silent Failures:**
```typescript
// blockchain/redeemer.ts
catch {
  return []; // Empty result on error
}
```

2. **No Error Boundaries:** No centralized error handler for unhandled rejections

3. **No Observability:** Console logging only — no metrics, tracing, or alerting

### Recommendations

1. Add structured error types:
```typescript
class TradingError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public context: Record<string, unknown>
  ) {}
}
```

2. Add error tracking integration (Sentry, etc.)

3. Implement health check endpoint for monitoring

---

## 5. Testing Architecture

### Current Coverage

- **32 test files** in `packages/bot/src/__tests__/`
- **364 tests** total
- **Framework:** Vitest (10s timeout)

### Test Patterns

| Pattern | Example | Assessment |
|---------|---------|------------|
| Pure Functions | `rsi.test.ts` (no mocks) | ✅ Excellent |
| Module Mocking | `vi.mock("../db/queries.ts")` | ⚠️ Heavy coupling |
| Parameterized | `it.each([...])` | ✅ Good coverage |
| Factory Helpers | `makeStrategy(overrides)` | ✅ Maintainable |

### Gaps

1. **No E2E tests** — Full trading cycle not tested
2. **No integration tests** — Cross-module seams unprotected
3. **Frontend minimal** — Only schema validation
4. **No load tests** — WS broadcast performance unknown

### Recommendations

1. Add integration test for live order lifecycle
2. Add frontend test for WS cache sync
3. Add performance test for market data pipeline

---

## 6. Scalability & Performance

### Current Limits

| Resource | Limit | Bottleneck |
|----------|-------|------------|
| Markets | 2-3 | Main loop is synchronous |
| Concurrent Orders | Unlimited | No backpressure |
| WS Connections | 1 per client | Memory (no pooling) |
| Database | Single instance | Connection pool |

### Scaling Triggers

If you need to scale beyond current limits:

| Trigger | Solution | Effort |
|---------|----------|--------|
| >5 markets | Per-market workers + shared snapshot layer | High |
| Multiple bot instances | State coordination (Redis/event log) | High |
| Audit requirements | Stronger transactions + event sourcing | Medium |

---

## 7. Security Assessment

### Strengths

- ✅ Private key in `.env` (not committed)
- ✅ API token authentication on endpoints
- ✅ No SQL injection (Drizzle ORM)
- ✅ Input validation with Zod

### Concerns

1. **No rate limiting** on API endpoints
2. **No request validation** beyond Zod schemas
3. **WebSocket has no auth** — Anyone can connect and receive state
4. **CORS origin** configurable but defaults to permissive

### Recommendations

```typescript
// Add to middleware.ts
app.use('/api/*', rateLimiter({
  windowMs: 60_000,
  max: 100
}));

// Add to WebSocket
wsServer.on('connection', (ws, req) => {
  const token = req.headers['authorization'];
  if (!verifyToken(token)) ws.close();
});
```

---

## 8. Deployment & Operations

### Current Model

```
┌─────────────┐     ┌─────────────┐
│  Cloudflare │     │  VPS (Docker)│
│   (Web)     │◄────┤   (Bot)     │
└─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ PostgreSQL  │
                    └─────────────┘
```

### Concerns

1. **Single point of failure** — One bot instance
2. **No graceful shutdown** — `process.exit()` may kill active trades
3. **No health checks** — Can't detect degraded state
4. **Deployment ambiguity** — Bot serves static assets too (blurred boundaries)

### Recommendations

1. Add health check endpoint:
```typescript
app.get('/health', (c) => {
  return c.json({
    status: isHealthy() ? 'ok' : 'degraded',
    markets: activeMarkets.length,
    lastUpdate: lastStateUpdate
  });
});
```

2. Implement graceful shutdown:
```typescript
process.on('SIGTERM', async () => {
  await gracefulShutdown({
    finishPendingTrades: true,
    timeout: 30_000
  });
  process.exit(0);
});
```

---

## 9. Action Plan (Prioritized)

### High Priority (Do First)

1. **Fix WebSocket Connection Leak** — Single provider for frontend
2. **Add Trade Lifecycle Coordinator** — Consolidate scattered logic
3. **Implement Graceful Shutdown** — Prevent data loss on restart
4. **Add Health Check Endpoint** — Enable monitoring

### Medium Priority (Do Next)

5. **Introduce RuntimeContext** — Reduce global mutable state
6. **Split State Management** — Separate store from event publisher
7. **Add Transaction Wrapper** — Atomic DB + state updates
8. **Fix Config Hot Reload** — Immutable config + selective rebuild

### Low Priority (Future)

9. Add integration tests for order lifecycle
10. Add observability (metrics, tracing)
11. Implement proper error types
12. Add rate limiting and WS auth

---

## 10. Conclusion

### What Works Well

- Clean monorepo structure with shared types
- Good separation of concerns (data → pipeline → runtime → trading)
- Type-safe database layer with Drizzle
- Pure functions for indicators (testable)
- Event-driven real-time updates

### What Needs Attention

- **Global mutable state** hinders testability and reasoning
- **Scattered trade lifecycle** creates consistency risks
- **Best-effort consistency** acceptable for hobby, risky for production
- **No graceful shutdown** risks data loss
- **Multiple WebSocket connections** waste resources

### Bottom Line

The architecture is **fit for purpose** for a single-operator, 2-market trading bot. The code is clean, well-tested, and follows sensible patterns. However, before scaling to more markets, operators, or production-grade reliability, the issues around **state management** and **trade lifecycle coordination** must be addressed.

The recommended next step is not a rewrite, but incremental tightening: introduce a `RuntimeContext`, consolidate the trade lifecycle, and add graceful shutdown. These changes (1-2 days effort) will significantly improve reliability without disrupting what's already working.

---

*Review conducted by analyzing 230+ files across the monorepo, focusing on architectural patterns, data flow, state management, and operational concerns.*
