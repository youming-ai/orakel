# BTC 5-Min Bot Rewrite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `packages/bot` from scratch as a CLI-first BTC 5-minute up/down trading bot for Polymarket.

**Architecture:** CLI-First execution (Polymarket CLI subprocess for trading), real-time price deviation strategy (Chainlink price vs PriceToBeat → model probability → edge vs market), two data sources only (Chainlink WS + Polymarket CLOB WS/Gamma API).

**Tech Stack:** Bun, TypeScript, Hono, Drizzle ORM, PostgreSQL, Vitest, Zod, Polymarket CLI (Rust binary)

**Spec:** `docs/superpowers/specs/2026-03-12-btc-5min-bot-rewrite-design.md`

**Test command:** `bunx vitest run --config packages/bot/vitest.config.ts`
**Single test:** `bunx vitest run src/__tests__/{name}.test.ts --config packages/bot/vitest.config.ts`
**Typecheck:** `bun run typecheck`
**Lint:** `bun run lint`

---

## File Map

### New Files (packages/bot/src/)

| File | Responsibility |
|------|---------------|
| `core/config.ts` | Zod-validated config.json loading + hot-reload |
| `core/env.ts` | Environment variable validation (Zod) |
| `core/logger.ts` | createLogger factory (same pattern as current) |
| `core/state.ts` | Paper/live running state + pending start/stop |
| `core/clock.ts` | 5-min window time calculations, slug generation, phase detection |
| `core/types.ts` | Core type definitions (WindowState, Phase, Side, etc.) |
| `data/chainlink.ts` | Chainlink WS/HTTP price feed adapter |
| `data/polymarket.ts` | Gamma API (market discovery) + CLOB WS (orderbook) |
| `cli/executor.ts` | CLI subprocess wrapper (spawn, JSON parse, timeout, retry) |
| `cli/commands.ts` | Type-safe CLI command builders |
| `cli/types.ts` | CLI output type definitions |
| `engine/signal.ts` | Model probability: price deviation → P(Up) |
| `engine/edge.ts` | Edge calculation: model prob - market prob |
| `engine/decision.ts` | Trade decision: phase + edge + risk → ENTER/SKIP |
| `runtime/mainLoop.ts` | Main loop: tick → process → dispatch |
| `runtime/windowManager.ts` | Window lifecycle state machine |
| `runtime/settlement.ts` | Post-window settlement verification |
| `runtime/redeemer.ts` | Auto-redeem resolved positions via CLI |
| `trading/paperTrader.ts` | Paper trade simulation |
| `trading/liveTrader.ts` | Live trading via CLI commands |
| `trading/account.ts` | Account stats (P&L, balance, positions) |
| `trading/persistence.ts` | Signal/trade DB persistence |
| `db/schema.ts` | Drizzle schema (trades, signals, balanceSnapshots) |
| `db/client.ts` | PostgreSQL connection |
| `app/bootstrap.ts` | App startup (DB, API server, config watcher) |
| `app/api/routes.ts` | Hono API routes |
| `app/ws.ts` | WebSocket push to frontend |
| `terminal/dashboard.ts` | Terminal UI rendering |
| `backtest/engine.ts` | Backtest engine |
| `backtest/replay.ts` | Historical data fetcher |
| `index.ts` | Entry point |

### New Files (packages/shared/src/contracts/)

| File | Responsibility |
|------|---------------|
| `config.ts` | StrategyConfig, RiskConfigDto, ConfigUpdateDto |
| `state.ts` | StateSnapshotPayload, SignalNewPayload, TradeExecutedPayload, AccountStatsDto, WsMessage |
| `http.ts` | StatusDto, StatsDto, TradeRecordDto, SignalRecordDto, ConfigSnapshotDto, ControlRequestDto, ControlResponseDto |
| `schemas.ts` | Zod schemas for runtime validation |
| `index.ts` | Re-exports |

### New Test Files (packages/bot/src/__tests__/)

| File | Tests |
|------|-------|
| `clock.test.ts` | Window time calculations, slug generation, phase detection |
| `signal.test.ts` | Model probability function |
| `edge.test.ts` | Edge calculation |
| `decision.test.ts` | Trade decision logic |
| `cliExecutor.test.ts` | CLI subprocess wrapper (mocked) |
| `paperTrader.test.ts` | Paper trade simulation |
| `account.test.ts` | Account P&L calculation |
| `windowManager.test.ts` | Window lifecycle state machine |
| `config.test.ts` | Config loading and validation |

---

## Chunk 1: Foundation (Shared Contracts + Core Modules + DB Schema)

### Task 1: Clean slate — remove old bot source

**Files:**
- Delete: `packages/bot/src/` (all existing files)
- Keep: `packages/bot/vitest.config.ts`, `packages/bot/package.json`, `packages/bot/tsconfig.json`

- [ ] **Step 1: Remove old source files**

```bash
# Remove all source files but keep config
rm -rf packages/bot/src/
mkdir -p packages/bot/src/__tests__
```

- [ ] **Step 2: Verify clean state**

```bash
ls packages/bot/src/
# Expected: only __tests__/
```

- [ ] **Step 3: Commit**

```bash
git add -A packages/bot/src/
git commit -m "chore: remove old bot source for rewrite"
```

---

### Task 2: Shared contracts — config types

**Files:**
- Create: `packages/shared/src/contracts/config.ts`

- [ ] **Step 1: Write shared config types**

```typescript
// packages/shared/src/contracts/config.ts
export interface StrategyConfig {
	edgeThresholdEarly: number;
	edgeThresholdMid: number;
	edgeThresholdLate: number;
	phaseEarlySeconds: number;
	phaseLateSeconds: number;
	sigmoidScale: number;
	minVolatility: number;
	maxEntryPrice: number;
	minTimeLeftSeconds: number;
	maxTimeLeftSeconds: number;
}

export interface RiskConfigDto {
	maxTradeSizeUsdc: number;
	dailyMaxLossUsdc: number;
	maxOpenPositions: number;
	maxTradesPerWindow: number;
}

export interface ExecutionConfig {
	orderType: string;
	limitDiscount: number;
	minOrderPrice: number;
	maxOrderPrice: number;
}

export interface InfraConfig {
	pollIntervalMs: number;
	cliTimeoutMs: number;
	cliRetries: number;
	chainlinkWssUrls: string[];
	chainlinkHttpUrl: string;
	chainlinkAggregator: string;
	chainlinkDecimals: number;
	polymarketGammaUrl: string;
	polymarketClobUrl: string;
	polymarketClobWsUrl: string;
	slugPrefix: string;
	windowSeconds: number;
}

export interface MaintenanceConfig {
	signalLogRetentionDays: number;
	pruneIntervalMs: number;
	redeemIntervalMs: number;
}

export interface AppConfig {
	strategy: StrategyConfig;
	risk: { paper: RiskConfigDto; live: RiskConfigDto };
	execution: ExecutionConfig;
	infra: InfraConfig;
	maintenance: MaintenanceConfig;
}

export interface ConfigUpdateDto {
	strategy?: Partial<StrategyConfig>;
	risk?: {
		paper?: Partial<RiskConfigDto>;
		live?: Partial<RiskConfigDto>;
	};
}

export interface ConfigSnapshotDto {
	strategy: StrategyConfig;
	risk: { paper: RiskConfigDto; live: RiskConfigDto };
	execution: ExecutionConfig;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/contracts/config.ts
git commit -m "feat(shared): add new config contract types for 5-min bot"
```

---

### Task 3: Shared contracts — state types

**Files:**
- Create: `packages/shared/src/contracts/state.ts`

- [ ] **Step 1: Write shared state types**

```typescript
// packages/shared/src/contracts/state.ts
export interface AccountStatsDto {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
	todayPnl: number;
	todayTrades: number;
	dailyMaxLoss: number;
	balanceUsdc: number;
}

export type WindowStateLabel = "PENDING" | "ACTIVE" | "CLOSING" | "SETTLED" | "REDEEMED";
export type Phase = "EARLY" | "MID" | "LATE";
export type Side = "UP" | "DOWN";
export type Decision = "ENTER_UP" | "ENTER_DOWN" | "SKIP";

export interface WindowSnapshotDto {
	slug: string;
	state: WindowStateLabel;
	startMs: number;
	endMs: number;
	timeLeftSeconds: number;
	priceToBeat: number | null;
	chainlinkPrice: number | null;
	deviation: number | null;
	modelProbUp: number | null;
	marketProbUp: number | null;
	edgeUp: number | null;
	edgeDown: number | null;
	phase: Phase | null;
	decision: Decision | null;
	volatility: number | null;
}

export interface StateSnapshotPayload {
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	currentWindow: WindowSnapshotDto | null;
	paperStats: AccountStatsDto | null;
	liveStats: AccountStatsDto | null;
}

export interface SignalNewPayload {
	windowSlug: string;
	chainlinkPrice: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edgeUp: number;
	edgeDown: number;
	phase: Phase;
	decision: Decision;
	reason: string | null;
}

export interface TradeExecutedPayload {
	mode: "paper" | "live";
	windowSlug: string;
	side: Side;
	price: number;
	size: number;
	edge: number;
	orderId: string | null;
	timestamp: string;
}

export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed";

export interface WsMessage<T = unknown> {
	type: WsEventType;
	data: T;
	ts: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/contracts/state.ts
git commit -m "feat(shared): add new state contract types for 5-min bot"
```

---

### Task 4: Shared contracts — HTTP types + schemas + index

**Files:**
- Create: `packages/shared/src/contracts/http.ts`
- Create: `packages/shared/src/contracts/schemas.ts`
- Modify: `packages/shared/src/contracts/index.ts`

- [ ] **Step 1: Write HTTP contract types**

```typescript
// packages/shared/src/contracts/http.ts
import type { AccountStatsDto, Phase, Side, WindowSnapshotDto } from "./state.ts";
// ConfigSnapshotDto and RiskConfigDto are re-exported via config.ts barrel — don't duplicate

export interface StatusDto {
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	currentWindow: WindowSnapshotDto | null;
	chainlinkPrice: number | null;
	chainlinkPriceAgeMs: number | null;
	cliAvailable: boolean;
	dbConnected: boolean;
	uptimeMs: number;
}

export interface StatsDto {
	paper: AccountStatsDto;
	live: AccountStatsDto;
}

export interface TradeRecordDto {
	id: number;
	mode: "paper" | "live";
	windowSlug: string;
	side: Side;
	price: number;
	size: number;
	priceToBeat: number;
	entryBtcPrice: number;
	edge: number;
	modelProb: number;
	marketProb: number;
	phase: Phase;
	orderId: string | null;
	outcome: "WIN" | "LOSS" | null;
	settleBtcPrice: number | null;
	pnlUsdc: number | null;
	createdAt: string;
	settledAt: string | null;
}

export interface SignalRecordDto {
	id: number;
	windowSlug: string;
	timestamp: string;
	chainlinkPrice: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edgeUp: number;
	edgeDown: number;
	volatility: number;
	timeLeftSeconds: number;
	phase: Phase;
	decision: "ENTER_UP" | "ENTER_DOWN" | "SKIP";
	reason: string | null;
}

export interface ControlRequestDto {
	mode: "paper" | "live";
}

export interface ControlResponseDto {
	ok: boolean;
	message: string;
	state: { paperRunning: boolean; liveRunning: boolean };
}
```

- [ ] **Step 2: Write Zod schemas**

```typescript
// packages/shared/src/contracts/schemas.ts
import { z } from "zod";

export const StrategyConfigSchema = z.object({
	edgeThresholdEarly: z.number(),
	edgeThresholdMid: z.number(),
	edgeThresholdLate: z.number(),
	phaseEarlySeconds: z.number().int().positive(),
	phaseLateSeconds: z.number().int().positive(),
	sigmoidScale: z.number().positive(),
	minVolatility: z.number().positive(),
	maxEntryPrice: z.number().min(0).max(1),
	minTimeLeftSeconds: z.number().int().nonnegative(),
	maxTimeLeftSeconds: z.number().int().positive(),
});

export const RiskConfigSchema = z.object({
	maxTradeSizeUsdc: z.number().positive(),
	dailyMaxLossUsdc: z.number().positive(),
	maxOpenPositions: z.number().int().positive(),
	maxTradesPerWindow: z.number().int().positive(),
});

export const ExecutionConfigSchema = z.object({
	orderType: z.string(),
	limitDiscount: z.number().min(0).max(1),
	minOrderPrice: z.number().min(0).max(1),
	maxOrderPrice: z.number().min(0).max(1),
});

export const InfraConfigSchema = z.object({
	pollIntervalMs: z.number().int().positive(),
	cliTimeoutMs: z.number().int().positive(),
	cliRetries: z.number().int().nonnegative(),
	chainlinkWssUrls: z.array(z.string().url()),
	chainlinkHttpUrl: z.string().url(),
	chainlinkAggregator: z.string().startsWith("0x"),
	chainlinkDecimals: z.number().int().positive(),
	polymarketGammaUrl: z.string().url(),
	polymarketClobUrl: z.string().url(),
	polymarketClobWsUrl: z.string(),
	slugPrefix: z.string(),
	windowSeconds: z.number().int().positive(),
});

export const MaintenanceConfigSchema = z.object({
	signalLogRetentionDays: z.number().int().positive(),
	pruneIntervalMs: z.number().int().positive(),
	redeemIntervalMs: z.number().int().positive(),
});

export const AppConfigSchema = z.object({
	strategy: StrategyConfigSchema,
	risk: z.object({
		paper: RiskConfigSchema,
		live: RiskConfigSchema,
	}),
	execution: ExecutionConfigSchema,
	infra: InfraConfigSchema,
	maintenance: MaintenanceConfigSchema,
});

export const ConfigUpdateSchema = z.object({
	strategy: StrategyConfigSchema.partial().optional(),
	risk: z.object({
		paper: RiskConfigSchema.partial().optional(),
		live: RiskConfigSchema.partial().optional(),
	}).optional(),
});

export const ControlRequestSchema = z.object({
	mode: z.enum(["paper", "live"]),
});
```

- [ ] **Step 3: Update index.ts re-exports**

```typescript
// packages/shared/src/contracts/index.ts
export * from "./config.ts";
export * from "./state.ts";
export * from "./http.ts";
export * from "./schemas.ts";
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
# Expected: packages/shared passes (packages/web will fail — expected and out of scope)
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/contracts/
git commit -m "feat(shared): add HTTP types, Zod schemas, and re-export index"
```

---

### Task 5: Core — logger, types, env

**Files:**
- Create: `packages/bot/src/core/logger.ts`
- Create: `packages/bot/src/core/types.ts`
- Create: `packages/bot/src/core/env.ts`

- [ ] **Step 1: Write logger (same pattern as current)**

```typescript
// packages/bot/src/core/logger.ts
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getMinLevel(): number {
	const raw = process.env.LOG_LEVEL ?? "info";
	return LEVELS[raw as LogLevel] ?? LEVELS.info;
}

export interface Logger {
	debug(msg: string, data?: Record<string, unknown>): void;
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
	const minLevel = getMinLevel();
	const emit = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
		if (LEVELS[level] < minLevel) return;
		const entry = { ts: new Date().toISOString(), level, module, msg, ...data };
		// biome-ignore lint/suspicious/noConsole: logger is the authorized console user
		console.log(JSON.stringify(entry));
	};
	return {
		debug: (msg, data) => emit("debug", msg, data),
		info: (msg, data) => emit("info", msg, data),
		warn: (msg, data) => emit("warn", msg, data),
		error: (msg, data) => emit("error", msg, data),
	};
}
```

- [ ] **Step 2: Write core types**

```typescript
// packages/bot/src/core/types.ts
export type { Side, Phase, Decision, WindowStateLabel } from "@orakel/shared/contracts";

export interface PriceTick {
	price: number;
	timestampMs: number;
}

export interface OrderBookSnapshot {
	bestBid: number | null;
	bestAsk: number | null;
	midpoint: number | null;
	spread: number | null;
	timestampMs: number;
}

export interface MarketInfo {
	slug: string;
	conditionId: string;
	upTokenId: string;
	downTokenId: string;
	priceToBeat: number;
	startMs: number;
	endMs: number;
}
```

- [ ] **Step 3: Write env validation**

```typescript
// packages/bot/src/core/env.ts
import { z } from "zod";

const EnvSchema = z.object({
	PAPER_MODE: z.coerce.boolean().default(true),
	POLYMARKET_PRIVATE_KEY: z.string().startsWith("0x").optional(),
	DATABASE_URL: z.string().url(),
	API_TOKEN: z.string().min(1),
	PORT: z.coerce.number().int().positive().default(9999),
	LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function loadEnv(): Env {
	if (_env) return _env;
	const result = EnvSchema.safeParse(process.env);
	if (!result.success) {
		throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
	}
	_env = result.data;
	return _env;
}

export function getEnv(): Env {
	if (!_env) throw new Error("Environment not loaded. Call loadEnv() first.");
	return _env;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/bot/src/core/
git commit -m "feat(bot): add core modules — logger, types, env"
```

---

### Task 6: Core — clock module (TDD)

**Files:**
- Create: `packages/bot/src/core/clock.ts`
- Create: `packages/bot/src/__tests__/clock.test.ts`

- [ ] **Step 1: Write failing tests for clock**

```typescript
// packages/bot/src/__tests__/clock.test.ts
import { describe, expect, it } from "vitest";
import {
	computeWindowBounds,
	computeSlug,
	computePhase,
	computeTimeLeftSeconds,
} from "../core/clock.ts";

const WINDOW_SEC = 300;

describe("computeWindowBounds", () => {
	it("returns correct start/end for a time mid-window", () => {
		// 2026-03-12T06:52:30Z = 1773564750 (mid-window)
		const nowSec = 1773564750;
		const { startSec, endSec } = computeWindowBounds(nowSec, WINDOW_SEC);
		expect(endSec).toBe(1773564900); // ceil to next 300 boundary
		expect(startSec).toBe(1773564600); // endSec - 300
	});

	it("returns next window when exactly on boundary", () => {
		const nowSec = 1773564600; // exactly on 300 boundary
		const { startSec, endSec } = computeWindowBounds(nowSec, WINDOW_SEC);
		// On boundary = start of new window, so this IS the start
		expect(startSec).toBe(1773564600);
		expect(endSec).toBe(1773564900);
	});
});

describe("computeSlug", () => {
	it("generates correct slug from endSec", () => {
		expect(computeSlug(1773298200, "btc-updown-5m-")).toBe("btc-updown-5m-1773298200");
	});
});

describe("computeTimeLeftSeconds", () => {
	it("returns seconds until window end", () => {
		const nowMs = 1773564750_000; // 150s into window
		const endMs = 1773564900_000;
		expect(computeTimeLeftSeconds(nowMs, endMs)).toBe(150);
	});

	it("returns 0 when past window end", () => {
		const nowMs = 1773565000_000;
		const endMs = 1773564900_000;
		expect(computeTimeLeftSeconds(nowMs, endMs)).toBe(0);
	});
});

describe("computePhase", () => {
	it("returns EARLY when > phaseEarlySeconds left", () => {
		expect(computePhase(200, 180, 60)).toBe("EARLY");
	});

	it("returns MID when between early and late", () => {
		expect(computePhase(120, 180, 60)).toBe("MID");
	});

	it("returns LATE when < phaseLateSeconds left", () => {
		expect(computePhase(30, 180, 60)).toBe("LATE");
	});

	it("returns LATE when exactly at late boundary", () => {
		expect(computePhase(60, 180, 60)).toBe("LATE");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/clock.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Implement clock.ts**

```typescript
// packages/bot/src/core/clock.ts
import type { Phase } from "./types.ts";

export function computeWindowBounds(
	nowSec: number,
	windowSec: number,
): { startSec: number; endSec: number } {
	const endSec = Math.ceil(nowSec / windowSec) * windowSec;
	const startSec = endSec - windowSec;
	// If exactly on boundary, this window just started (nowSec === startSec)
	// The "current" window is the one that just started, not the one that ended
	if (nowSec === startSec) {
		return { startSec, endSec: startSec + windowSec };
	}
	return { startSec, endSec };
}

export function computeSlug(endSec: number, slugPrefix: string): string {
	return `${slugPrefix}${endSec}`;
}

export function computeTimeLeftSeconds(nowMs: number, endMs: number): number {
	return Math.max(0, Math.round((endMs - nowMs) / 1000));
}

export function computePhase(
	timeLeftSeconds: number,
	phaseEarlySeconds: number,
	phaseLateSeconds: number,
): Phase {
	if (timeLeftSeconds > phaseEarlySeconds) return "EARLY";
	if (timeLeftSeconds <= phaseLateSeconds) return "LATE";
	return "MID";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/clock.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/core/clock.ts packages/bot/src/__tests__/clock.test.ts
git commit -m "feat(bot): add clock module with TDD — window bounds, slug, phase"
```

---

### Task 7: Core — config module (TDD)

**Files:**
- Create: `packages/bot/src/core/config.ts`
- Create: `packages/bot/src/__tests__/config.test.ts`

- [ ] **Step 1: Write failing tests for config**

```typescript
// packages/bot/src/__tests__/config.test.ts
import { describe, expect, it } from "vitest";
import { parseConfig, mergeConfigUpdate } from "../core/config.ts";

const VALID_CONFIG = {
	strategy: {
		edgeThresholdEarly: 0.08,
		edgeThresholdMid: 0.05,
		edgeThresholdLate: 0.03,
		phaseEarlySeconds: 180,
		phaseLateSeconds: 60,
		sigmoidScale: 5.0,
		minVolatility: 0.0001,
		maxEntryPrice: 0.92,
		minTimeLeftSeconds: 15,
		maxTimeLeftSeconds: 270,
	},
	risk: {
		paper: { maxTradeSizeUsdc: 5, dailyMaxLossUsdc: 100, maxOpenPositions: 1, maxTradesPerWindow: 1 },
		live: { maxTradeSizeUsdc: 5, dailyMaxLossUsdc: 100, maxOpenPositions: 1, maxTradesPerWindow: 1 },
	},
	execution: { orderType: "GTC", limitDiscount: 0.02, minOrderPrice: 0.05, maxOrderPrice: 0.95 },
	infra: {
		pollIntervalMs: 1000,
		cliTimeoutMs: 10000,
		cliRetries: 1,
		chainlinkWssUrls: ["wss://polygon-mainnet.g.alchemy.com/v2/test"],
		chainlinkHttpUrl: "https://polygon-mainnet.g.alchemy.com/v2/test",
		chainlinkAggregator: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
		chainlinkDecimals: 8,
		polymarketGammaUrl: "https://gamma-api.polymarket.com",
		polymarketClobUrl: "https://clob.polymarket.com",
		polymarketClobWsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
		slugPrefix: "btc-updown-5m-",
		windowSeconds: 300,
	},
	maintenance: { signalLogRetentionDays: 30, pruneIntervalMs: 3600000, redeemIntervalMs: 60000 },
};

describe("parseConfig", () => {
	it("parses a valid config", () => {
		const result = parseConfig(JSON.stringify(VALID_CONFIG));
		expect(result.strategy.edgeThresholdEarly).toBe(0.08);
		expect(result.risk.paper.maxTradeSizeUsdc).toBe(5);
	});

	it("throws on invalid config", () => {
		expect(() => parseConfig("{}")).toThrow();
	});

	it("throws on non-JSON", () => {
		expect(() => parseConfig("not json")).toThrow();
	});
});

describe("mergeConfigUpdate", () => {
	it("merges partial strategy update", () => {
		const base = parseConfig(JSON.stringify(VALID_CONFIG));
		const updated = mergeConfigUpdate(base, { strategy: { edgeThresholdEarly: 0.10 } });
		expect(updated.strategy.edgeThresholdEarly).toBe(0.10);
		expect(updated.strategy.edgeThresholdMid).toBe(0.05); // unchanged
	});

	it("merges partial risk update", () => {
		const base = parseConfig(JSON.stringify(VALID_CONFIG));
		const updated = mergeConfigUpdate(base, { risk: { paper: { maxTradeSizeUsdc: 10 } } });
		expect(updated.risk.paper.maxTradeSizeUsdc).toBe(10);
		expect(updated.risk.live.maxTradeSizeUsdc).toBe(5); // unchanged
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/config.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement config.ts**

```typescript
// packages/bot/src/core/config.ts
import type { AppConfig, ConfigUpdateDto } from "@orakel/shared/contracts";
import { AppConfigSchema, ConfigUpdateSchema } from "@orakel/shared/contracts";
import { z } from "zod";
import { createLogger } from "./logger.ts";

const log = createLogger("config");

export function parseConfig(raw: string): AppConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Config is not valid JSON");
	}
	const result = AppConfigSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid config: ${z.prettifyError(result.error)}`);
	}
	return result.data;
}

export function mergeConfigUpdate(base: AppConfig, update: ConfigUpdateDto): AppConfig {
	const validated = ConfigUpdateSchema.parse(update);
	return {
		...base,
		strategy: { ...base.strategy, ...validated.strategy },
		risk: {
			paper: { ...base.risk.paper, ...validated.risk?.paper },
			live: { ...base.risk.live, ...validated.risk?.live },
		},
	};
}

let _config: AppConfig | null = null;

export async function loadConfigFromFile(path: string): Promise<AppConfig> {
	const raw = await Bun.file(path).text();
	_config = parseConfig(raw);
	log.info("Config loaded", { path });
	return _config;
}

export function getConfig(): AppConfig {
	if (!_config) throw new Error("Config not loaded. Call loadConfigFromFile() first.");
	return _config;
}

export function setConfig(config: AppConfig): void {
	_config = config;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/config.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/core/config.ts packages/bot/src/__tests__/config.test.ts
git commit -m "feat(bot): add config module with TDD — parse, merge, validate"
```

---

### Task 8: Core — state module

**Files:**
- Create: `packages/bot/src/core/state.ts`

- [ ] **Step 1: Write state module**

```typescript
// packages/bot/src/core/state.ts
import { createLogger } from "./logger.ts";

const log = createLogger("state");

let _paperRunning = false;
let _liveRunning = false;
let _paperPendingStart = false;
let _paperPendingStop = false;
let _livePendingStart = false;
let _livePendingStop = false;

export function isPaperRunning(): boolean { return _paperRunning; }
export function isLiveRunning(): boolean { return _liveRunning; }
export function isPaperPendingStart(): boolean { return _paperPendingStart; }
export function isPaperPendingStop(): boolean { return _paperPendingStop; }
export function isLivePendingStart(): boolean { return _livePendingStart; }
export function isLivePendingStop(): boolean { return _livePendingStop; }

export function requestPaperStart(): void { _paperPendingStart = true; log.info("Paper start requested"); }
export function requestPaperStop(): void { _paperPendingStop = true; log.info("Paper stop requested"); }
export function requestLiveStart(): void { _livePendingStart = true; log.info("Live start requested"); }
export function requestLiveStop(): void { _livePendingStop = true; log.info("Live stop requested"); }

export function applyPendingStarts(): boolean {
	let changed = false;
	if (_paperPendingStart && !_paperRunning) {
		_paperRunning = true;
		_paperPendingStart = false;
		log.info("Paper trading started");
		changed = true;
	}
	if (_livePendingStart && !_liveRunning) {
		_liveRunning = true;
		_livePendingStart = false;
		log.info("Live trading started");
		changed = true;
	}
	return changed;
}

export function applyPendingStops(): boolean {
	let changed = false;
	if (_paperPendingStop && _paperRunning) {
		_paperRunning = false;
		_paperPendingStop = false;
		log.info("Paper trading stopped");
		changed = true;
	}
	if (_livePendingStop && _liveRunning) {
		_liveRunning = false;
		_livePendingStop = false;
		log.info("Live trading stopped");
		changed = true;
	}
	return changed;
}

export function getStateSnapshot() {
	return {
		paperRunning: _paperRunning,
		liveRunning: _liveRunning,
		paperPendingStart: _paperPendingStart,
		paperPendingStop: _paperPendingStop,
		livePendingStart: _livePendingStart,
		livePendingStop: _livePendingStop,
	};
}

/** Reset all state — for testing only */
export function resetState(): void {
	_paperRunning = false;
	_liveRunning = false;
	_paperPendingStart = false;
	_paperPendingStop = false;
	_livePendingStart = false;
	_livePendingStop = false;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/src/core/state.ts
git commit -m "feat(bot): add state module — paper/live running state management"
```

---

### Task 9: Database schema

**Files:**
- Create: `packages/bot/src/db/schema.ts`
- Create: `packages/bot/src/db/client.ts`

- [ ] **Step 1: Write Drizzle schema**

```typescript
// packages/bot/src/db/schema.ts
import { bigint, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const trades = pgTable("trades_v2", {
	id: serial("id").primaryKey(),
	mode: text("mode").notNull(), // "paper" | "live"
	windowSlug: text("window_slug").notNull(),
	windowStartMs: bigint("window_start_ms", { mode: "number" }).notNull(),
	windowEndMs: bigint("window_end_ms", { mode: "number" }).notNull(),
	side: text("side").notNull(), // "UP" | "DOWN"
	price: numeric("price", { precision: 10, scale: 4 }).notNull(),
	size: numeric("size", { precision: 10, scale: 2 }).notNull(),
	priceToBeat: numeric("price_to_beat", { precision: 16, scale: 2 }).notNull(),
	entryBtcPrice: numeric("entry_btc_price", { precision: 16, scale: 2 }).notNull(),
	edge: numeric("edge", { precision: 10, scale: 6 }).notNull(),
	modelProb: numeric("model_prob", { precision: 10, scale: 6 }).notNull(),
	marketProb: numeric("market_prob", { precision: 10, scale: 6 }).notNull(),
	phase: text("phase").notNull(), // "EARLY" | "MID" | "LATE"
	orderId: text("order_id"),
	outcome: text("outcome"), // "WIN" | "LOSS" | null
	settleBtcPrice: numeric("settle_btc_price", { precision: 16, scale: 2 }),
	pnlUsdc: numeric("pnl_usdc", { precision: 10, scale: 4 }),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	settledAt: timestamp("settled_at"),
});

export const signals = pgTable("signals_v2", {
	id: serial("id").primaryKey(),
	windowSlug: text("window_slug").notNull(),
	timestamp: timestamp("timestamp").defaultNow().notNull(),
	chainlinkPrice: numeric("chainlink_price", { precision: 16, scale: 2 }).notNull(),
	priceToBeat: numeric("price_to_beat", { precision: 16, scale: 2 }).notNull(),
	deviation: numeric("deviation", { precision: 12, scale: 8 }).notNull(),
	modelProbUp: numeric("model_prob_up", { precision: 10, scale: 6 }).notNull(),
	marketProbUp: numeric("market_prob_up", { precision: 10, scale: 6 }).notNull(),
	edgeUp: numeric("edge_up", { precision: 10, scale: 6 }).notNull(),
	edgeDown: numeric("edge_down", { precision: 10, scale: 6 }).notNull(),
	volatility: numeric("volatility", { precision: 12, scale: 8 }).notNull(),
	timeLeftSeconds: integer("time_left_seconds").notNull(),
	phase: text("phase").notNull(),
	decision: text("decision").notNull(), // "ENTER_UP" | "ENTER_DOWN" | "SKIP"
	reason: text("reason"),
});

export const balanceSnapshots = pgTable("balance_snapshots_v2", {
	id: serial("id").primaryKey(),
	mode: text("mode").notNull(),
	balanceUsdc: numeric("balance_usdc", { precision: 12, scale: 4 }).notNull(),
	totalPnl: numeric("total_pnl", { precision: 12, scale: 4 }).notNull(),
	winCount: integer("win_count").notNull(),
	lossCount: integer("loss_count").notNull(),
	snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Write DB client**

```typescript
// packages/bot/src/db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createLogger } from "../core/logger.ts";
import * as schema from "./schema.ts";

const log = createLogger("db");

let _db: ReturnType<typeof drizzle> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export async function connectDb(databaseUrl: string): Promise<ReturnType<typeof drizzle>> {
	_sql = postgres(databaseUrl);
	_db = drizzle(_sql, { schema });
	log.info("Database connected");
	return _db;
}

export function getDb(): ReturnType<typeof drizzle> {
	if (!_db) throw new Error("Database not connected. Call connectDb() first.");
	return _db;
}

export async function disconnectDb(): Promise<void> {
	if (_sql) {
		await _sql.end();
		_sql = null;
		_db = null;
		log.info("Database disconnected");
	}
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/bot/src/db/
git commit -m "feat(bot): add Drizzle schema and DB client for 5-min bot"
```

- [ ] **Step 4: Verify chunk 1 builds**

```bash
bun run typecheck
# Expected: packages/bot and packages/shared pass (web may fail — expected)
```

---

## Chunk 2: Engine (Signal + Edge + Decision — TDD)

### Task 10: Engine — signal module (TDD)

**Files:**
- Create: `packages/bot/src/engine/signal.ts`
- Create: `packages/bot/src/__tests__/signal.test.ts`

- [ ] **Step 1: Write failing tests for signal**

```typescript
// packages/bot/src/__tests__/signal.test.ts
import { describe, expect, it } from "vitest";
import { modelProbability, sigmoid, computeVolatility } from "../engine/signal.ts";

describe("sigmoid", () => {
	it("returns 0.5 at z=0", () => {
		expect(sigmoid(0)).toBe(0.5);
	});

	it("returns ~1.0 for large positive z", () => {
		expect(sigmoid(10)).toBeCloseTo(1.0, 4);
	});

	it("returns ~0.0 for large negative z", () => {
		expect(sigmoid(-10)).toBeCloseTo(0.0, 4);
	});

	it("is symmetric around 0.5", () => {
		expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1.0, 10);
	});
});

describe("modelProbability", () => {
	it("returns 0.5 when deviation is 0", () => {
		const result = modelProbability(0, 150, 0.001, { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 });
		expect(result).toBeCloseTo(0.5, 2);
	});

	it("returns > 0.5 for positive deviation", () => {
		const result = modelProbability(0.002, 150, 0.001, { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 });
		expect(result).toBeGreaterThan(0.5);
	});

	it("returns < 0.5 for negative deviation", () => {
		const result = modelProbability(-0.002, 150, 0.001, { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 });
		expect(result).toBeLessThan(0.5);
	});

	it("confidence increases as time left decreases", () => {
		const params = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };
		const early = modelProbability(0.001, 280, 0.001, params);
		const late = modelProbability(0.001, 30, 0.001, params);
		// Late should be further from 0.5 (more confident)
		expect(Math.abs(late - 0.5)).toBeGreaterThan(Math.abs(early - 0.5));
	});

	it("confidence decreases with higher volatility", () => {
		const params = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };
		const lowVol = modelProbability(0.001, 150, 0.0005, params);
		const highVol = modelProbability(0.001, 150, 0.005, params);
		expect(Math.abs(lowVol - 0.5)).toBeGreaterThan(Math.abs(highVol - 0.5));
	});

	it("clamps to [0.01, 0.99]", () => {
		const params = { sigmoidScale: 50, minVolatility: 0.0001, epsilon: 0.001 };
		const extreme = modelProbability(0.1, 1, 0.0001, params);
		expect(extreme).toBeLessThanOrEqual(0.99);
		expect(extreme).toBeGreaterThanOrEqual(0.01);
	});
});

describe("computeVolatility", () => {
	it("returns 0 for single tick", () => {
		expect(computeVolatility([{ price: 80000, timestampMs: 0 }])).toBe(0);
	});

	it("returns 0 for identical prices", () => {
		const ticks = [
			{ price: 80000, timestampMs: 0 },
			{ price: 80000, timestampMs: 1000 },
			{ price: 80000, timestampMs: 2000 },
		];
		expect(computeVolatility(ticks)).toBe(0);
	});

	it("returns positive value for varying prices", () => {
		const ticks = [
			{ price: 80000, timestampMs: 0 },
			{ price: 80100, timestampMs: 1000 },
			{ price: 79900, timestampMs: 2000 },
			{ price: 80050, timestampMs: 3000 },
		];
		expect(computeVolatility(ticks)).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/signal.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement signal.ts**

```typescript
// packages/bot/src/engine/signal.ts
import type { PriceTick } from "../core/types.ts";

export interface SignalParams {
	sigmoidScale: number;
	minVolatility: number;
	epsilon: number;
}

export function sigmoid(z: number): number {
	return 1 / (1 + Math.exp(-z));
}

export function modelProbability(
	priceDeviation: number,
	timeLeftSeconds: number,
	recentVolatility: number,
	params: SignalParams,
): number {
	const timeDecay = timeLeftSeconds / 300;
	const volAdjust = Math.max(recentVolatility, params.minVolatility);
	const z = priceDeviation / (volAdjust * Math.sqrt(timeDecay + params.epsilon));
	const raw = sigmoid(z * params.sigmoidScale);
	return Math.max(0.01, Math.min(0.99, raw));
}

export function computeVolatility(ticks: PriceTick[]): number {
	if (ticks.length < 2) return 0;
	const logReturns: number[] = [];
	for (let i = 1; i < ticks.length; i++) {
		const prev = ticks[i - 1];
		const curr = ticks[i];
		if (prev && curr && prev.price > 0) {
			logReturns.push(Math.log(curr.price / prev.price));
		}
	}
	if (logReturns.length === 0) return 0;
	const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
	const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
	return Math.sqrt(variance);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/signal.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/engine/signal.ts packages/bot/src/__tests__/signal.test.ts
git commit -m "feat(bot): add signal module with TDD — model probability, volatility"
```

---

### Task 11: Engine — edge module (TDD)

**Files:**
- Create: `packages/bot/src/engine/edge.ts`
- Create: `packages/bot/src/__tests__/edge.test.ts`

- [ ] **Step 1: Write failing tests for edge**

```typescript
// packages/bot/src/__tests__/edge.test.ts
import { describe, expect, it } from "vitest";
import { computeEdge } from "../engine/edge.ts";

describe("computeEdge", () => {
	it("computes edge when model favors UP", () => {
		const result = computeEdge(0.7, 0.55);
		expect(result.edgeUp).toBeCloseTo(0.15, 6);
		expect(result.edgeDown).toBeCloseTo(-0.15, 6);
		expect(result.bestSide).toBe("UP");
		expect(result.bestEdge).toBeCloseTo(0.15, 6);
	});

	it("computes edge when model favors DOWN", () => {
		const result = computeEdge(0.3, 0.55);
		expect(result.edgeUp).toBeCloseTo(-0.25, 6);
		expect(result.edgeDown).toBeCloseTo(0.25, 6);
		expect(result.bestSide).toBe("DOWN");
		expect(result.bestEdge).toBeCloseTo(0.25, 6);
	});

	it("returns zero edge when model matches market", () => {
		const result = computeEdge(0.5, 0.5);
		expect(result.edgeUp).toBeCloseTo(0, 6);
		expect(result.edgeDown).toBeCloseTo(0, 6);
		expect(result.bestEdge).toBeCloseTo(0, 6);
	});

	it("handles extreme model probabilities", () => {
		const result = computeEdge(0.99, 0.5);
		expect(result.edgeUp).toBeCloseTo(0.49, 6);
		expect(result.bestSide).toBe("UP");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/edge.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement edge.ts**

```typescript
// packages/bot/src/engine/edge.ts
import type { Side } from "../core/types.ts";

export interface EdgeResult {
	edgeUp: number;
	edgeDown: number;
	bestSide: Side;
	bestEdge: number;
}

export function computeEdge(modelProbUp: number, marketProbUp: number): EdgeResult {
	const edgeUp = modelProbUp - marketProbUp;
	const edgeDown = marketProbUp - modelProbUp; // (1 - modelProbUp) - (1 - marketProbUp)
	const bestSide: Side = edgeUp >= edgeDown ? "UP" : "DOWN";
	const bestEdge = Math.max(edgeUp, edgeDown);
	return { edgeUp, edgeDown, bestSide, bestEdge };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/edge.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/engine/edge.ts packages/bot/src/__tests__/edge.test.ts
git commit -m "feat(bot): add edge module with TDD — model vs market probability"
```

---

### Task 12: Engine — decision module (TDD)

**Files:**
- Create: `packages/bot/src/engine/decision.ts`
- Create: `packages/bot/src/__tests__/decision.test.ts`

- [ ] **Step 1: Write failing tests for decision**

```typescript
// packages/bot/src/__tests__/decision.test.ts
import { describe, expect, it } from "vitest";
import { makeTradeDecision } from "../engine/decision.ts";
import type { StrategyConfig, RiskConfigDto } from "@orakel/shared/contracts";

function makeStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
	return {
		edgeThresholdEarly: 0.08,
		edgeThresholdMid: 0.05,
		edgeThresholdLate: 0.03,
		phaseEarlySeconds: 180,
		phaseLateSeconds: 60,
		sigmoidScale: 5.0,
		minVolatility: 0.0001,
		maxEntryPrice: 0.92,
		minTimeLeftSeconds: 15,
		maxTimeLeftSeconds: 270,
		...overrides,
	};
}

function makeRisk(overrides: Partial<RiskConfigDto> = {}): RiskConfigDto {
	return {
		maxTradeSizeUsdc: 5,
		dailyMaxLossUsdc: 100,
		maxOpenPositions: 1,
		maxTradesPerWindow: 1,
		...overrides,
	};
}

describe("makeTradeDecision", () => {
	it("returns ENTER_UP when edge exceeds LATE threshold", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.7,
			marketProbUp: 0.55,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy(),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("ENTER_UP");
		expect(result.side).toBe("UP");
	});

	it("returns SKIP when edge below threshold", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.52,
			marketProbUp: 0.50,
			timeLeftSeconds: 200,
			phase: "EARLY",
			strategy: makeStrategy(),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("edge");
	});

	it("returns SKIP when already has position in window", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.9,
			marketProbUp: 0.5,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy(),
			risk: makeRisk(),
			hasPositionInWindow: true,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 1,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("position");
	});

	it("returns SKIP when daily loss limit reached", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.9,
			marketProbUp: 0.5,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy(),
			risk: makeRisk({ dailyMaxLossUsdc: 50 }),
			hasPositionInWindow: false,
			todayLossUsdc: 50,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("daily loss");
	});

	it("returns SKIP when market price too extreme", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.98,
			marketProbUp: 0.95,
			timeLeftSeconds: 30,
			phase: "LATE",
			strategy: makeStrategy({ maxEntryPrice: 0.92 }),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("price");
	});

	it("returns SKIP when time outside allowed window", () => {
		const result = makeTradeDecision({
			modelProbUp: 0.9,
			marketProbUp: 0.5,
			timeLeftSeconds: 5,
			phase: "LATE",
			strategy: makeStrategy({ minTimeLeftSeconds: 15 }),
			risk: makeRisk(),
			hasPositionInWindow: false,
			todayLossUsdc: 0,
			openPositions: 0,
			tradesInWindow: 0,
		});
		expect(result.decision).toBe("SKIP");
		expect(result.reason).toContain("time");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/decision.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement decision.ts**

```typescript
// packages/bot/src/engine/decision.ts
import type { StrategyConfig, RiskConfigDto } from "@orakel/shared/contracts";
import type { Decision, Phase, Side } from "../core/types.ts";
import { computeEdge } from "./edge.ts";

export interface DecisionInput {
	modelProbUp: number;
	marketProbUp: number;
	timeLeftSeconds: number;
	phase: Phase;
	strategy: StrategyConfig;
	risk: RiskConfigDto;
	hasPositionInWindow: boolean;
	todayLossUsdc: number;
	openPositions: number;
	tradesInWindow: number;
}

export interface DecisionResult {
	decision: Decision;
	side: Side | null;
	edge: number;
	reason: string | null;
}

function getEdgeThreshold(phase: Phase, strategy: StrategyConfig): number {
	switch (phase) {
		case "EARLY": return strategy.edgeThresholdEarly;
		case "MID": return strategy.edgeThresholdMid;
		case "LATE": return strategy.edgeThresholdLate;
	}
}

export function makeTradeDecision(input: DecisionInput): DecisionResult {
	const { modelProbUp, marketProbUp, timeLeftSeconds, phase, strategy, risk } = input;
	const { edgeUp, edgeDown, bestSide, bestEdge } = computeEdge(modelProbUp, marketProbUp);

	// Time guard
	if (timeLeftSeconds < strategy.minTimeLeftSeconds) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "time: too close to window end" };
	}
	if (timeLeftSeconds > strategy.maxTimeLeftSeconds) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "time: too far from window end" };
	}

	// Position guard
	if (input.hasPositionInWindow) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "already has position in window" };
	}

	// Risk guards
	if (input.todayLossUsdc >= risk.dailyMaxLossUsdc) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "daily loss limit reached" };
	}
	if (input.openPositions >= risk.maxOpenPositions) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "max open positions reached" };
	}
	if (input.tradesInWindow >= risk.maxTradesPerWindow) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: "max trades per window reached" };
	}

	// Price guard — entry price (the side we'd buy) must not be too extreme
	const entryPrice = bestSide === "UP" ? marketProbUp : (1 - marketProbUp);
	if (entryPrice > strategy.maxEntryPrice) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: `price too extreme: ${entryPrice.toFixed(4)} > ${strategy.maxEntryPrice}` };
	}

	// Edge threshold
	const threshold = getEdgeThreshold(phase, strategy);
	if (bestEdge < threshold) {
		return { decision: "SKIP", side: null, edge: bestEdge, reason: `edge ${bestEdge.toFixed(4)} < ${threshold} (${phase})` };
	}

	const decision: Decision = bestSide === "UP" ? "ENTER_UP" : "ENTER_DOWN";
	return { decision, side: bestSide, edge: bestEdge, reason: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/decision.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/engine/decision.ts packages/bot/src/__tests__/decision.test.ts
git commit -m "feat(bot): add decision module with TDD — phase, edge, risk guards"
```

---

## Chunk 3: CLI Layer + Data Adapters

### Task 13: CLI — executor (TDD)

**Files:**
- Create: `packages/bot/src/cli/types.ts`
- Create: `packages/bot/src/cli/executor.ts`
- Create: `packages/bot/src/__tests__/cliExecutor.test.ts`

- [ ] **Step 1: Write CLI types**

```typescript
// packages/bot/src/cli/types.ts
export interface CliResult<T> {
	ok: boolean;
	data?: T;
	error?: string;
	durationMs: number;
}

export interface CliOrderResponse {
	orderID: string;
	status: string;
}

export interface CliBalanceResponse {
	collateral: string;
}

export interface CliPositionEntry {
	asset: string;
	size: string;
	avgPrice: string;
	curPrice: string;
}
```

- [ ] **Step 2: Write failing tests for executor**

```typescript
// packages/bot/src/__tests__/cliExecutor.test.ts
import { describe, expect, it } from "vitest";
import { parseCliOutput, classifyCliError } from "../cli/executor.ts";

describe("parseCliOutput", () => {
	it("parses valid JSON output", () => {
		const result = parseCliOutput<{ value: number }>('{"value": 42}');
		expect(result).toEqual({ value: 42 });
	});

	it("returns null for empty output", () => {
		expect(parseCliOutput("")).toBeNull();
	});

	it("returns null for non-JSON output", () => {
		expect(parseCliOutput("Error: something went wrong")).toBeNull();
	});
});

describe("classifyCliError", () => {
	it("classifies timeout as transient", () => {
		expect(classifyCliError("timed out")).toBe("transient");
	});

	it("classifies network error as transient", () => {
		expect(classifyCliError("connection refused")).toBe("transient");
	});

	it("classifies auth failure as fatal", () => {
		expect(classifyCliError("authentication failed")).toBe("fatal");
	});

	it("classifies insufficient balance as permanent", () => {
		expect(classifyCliError("insufficient balance")).toBe("permanent");
	});

	it("classifies unknown error as transient", () => {
		expect(classifyCliError("something unexpected")).toBe("transient");
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/cliExecutor.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL
```

- [ ] **Step 4: Implement executor.ts**

```typescript
// packages/bot/src/cli/executor.ts
import { createLogger } from "../core/logger.ts";
import type { CliResult } from "./types.ts";

const log = createLogger("cli");

export function parseCliOutput<T>(raw: string): T | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		return null;
	}
}

export type CliErrorClass = "transient" | "permanent" | "fatal";

export function classifyCliError(message: string): CliErrorClass {
	const lower = message.toLowerCase();
	if (lower.includes("authentication") || lower.includes("auth fail") || lower.includes("not found")) {
		return "fatal";
	}
	if (lower.includes("insufficient") || lower.includes("invalid token") || lower.includes("invalid order")) {
		return "permanent";
	}
	return "transient";
}

export async function execCli<T>(
	args: string[],
	opts: { timeoutMs?: number; retries?: number; parseJson?: boolean } = {},
): Promise<CliResult<T>> {
	const { timeoutMs = 10_000, retries = 1, parseJson = true } = opts;
	let lastError = "";

	for (let attempt = 0; attempt <= retries; attempt++) {
		const start = Date.now();
		try {
			const proc = Bun.spawn(["polymarket", "-o", "json", ...args], {
				stdout: "pipe",
				stderr: "pipe",
				timeout: timeoutMs,
			});

			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			const exitCode = await proc.exited;
			const durationMs = Date.now() - start;

			if (exitCode !== 0) {
				lastError = stderr.trim() || stdout.trim() || `exit code ${exitCode}`;
				const errorClass = classifyCliError(lastError);
				if (errorClass !== "transient" || attempt >= retries) {
					log.warn("CLI command failed", { args, exitCode, error: lastError, errorClass });
					return { ok: false, error: lastError, durationMs };
				}
				log.warn("CLI transient error, retrying", { args, attempt: attempt + 1, error: lastError });
				continue;
			}

			const data = parseJson ? parseCliOutput<T>(stdout) : (undefined as T | undefined);
			return { ok: true, data: data ?? undefined, durationMs };
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			const durationMs = Date.now() - start;
			if (attempt >= retries) {
				log.error("CLI execution error", { args, error: lastError });
				return { ok: false, error: lastError, durationMs };
			}
		}
	}

	return { ok: false, error: lastError, durationMs: 0 };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/cliExecutor.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 6: Commit**

```bash
git add packages/bot/src/cli/
git commit -m "feat(bot): add CLI executor with TDD — subprocess wrapper, error classification"
```

---

### Task 14: CLI — commands module

**Files:**
- Create: `packages/bot/src/cli/commands.ts`

- [ ] **Step 1: Implement CLI command builders**

```typescript
// packages/bot/src/cli/commands.ts
import { execCli } from "./executor.ts";
import type { CliResult, CliOrderResponse, CliBalanceResponse, CliPositionEntry } from "./types.ts";

export function createOrder(params: {
	tokenId: string;
	side: "buy";
	price: number;
	size: number;
	orderType: "GTC" | "GTD" | "FOK";
}): Promise<CliResult<CliOrderResponse>> {
	return execCli<CliOrderResponse>([
		"clob", "create-order",
		"--token", params.tokenId,
		"--side", params.side,
		"--price", String(params.price),
		"--size", String(params.size),
		"--order-type", params.orderType,
	]);
}

export function cancelOrder(orderId: string): Promise<CliResult<void>> {
	return execCli<void>(["clob", "cancel", "--order-id", orderId], { parseJson: false });
}

export function cancelAll(): Promise<CliResult<void>> {
	return execCli<void>(["clob", "cancel-all"], { parseJson: false });
}

export function getBalance(): Promise<CliResult<CliBalanceResponse>> {
	return execCli<CliBalanceResponse>(["clob", "balance", "--asset-type", "collateral"]);
}

export function getPositions(): Promise<CliResult<CliPositionEntry[]>> {
	return execCli<CliPositionEntry[]>(["positions"]);
}

export function redeemPositions(): Promise<CliResult<unknown>> {
	return execCli<unknown>(["ctf", "redeem"], { timeoutMs: 30_000 });
}

export function checkCliAvailable(): Promise<boolean> {
	return execCli<unknown>(["--version"], { parseJson: false, timeoutMs: 5_000 })
		.then((r) => r.ok)
		.catch(() => false);
}

export function getOrderStatus(orderId: string): Promise<CliResult<CliOrderResponse>> {
	return execCli<CliOrderResponse>(["clob", "get-order", "--order-id", orderId]);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/src/cli/commands.ts
git commit -m "feat(bot): add CLI command builders — orders, balance, positions, redeem"
```

---

### Task 15: Data — Chainlink adapter

**Files:**
- Create: `packages/bot/src/data/chainlink.ts`

- [ ] **Step 1: Implement Chainlink price feed adapter**

This module manages a WebSocket connection to Polygon RPC for Chainlink price updates, with HTTP polling fallback. Implementation follows the same reconnection pattern as the existing codebase.

```typescript
// packages/bot/src/data/chainlink.ts
import { createLogger } from "../core/logger.ts";
import type { PriceTick } from "../core/types.ts";

const log = createLogger("chainlink");

// ABI fragment for latestRoundData
const LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c";

export interface ChainlinkAdapter {
	getLatestPrice(): PriceTick | null;
	getRecentTicks(maxAgeMs?: number): PriceTick[];
	start(): void;
	stop(): void;
}

export function createChainlinkAdapter(config: {
	httpUrl: string;
	aggregator: string;
	decimals: number;
	maxTickAge?: number;
}): ChainlinkAdapter {
	const { httpUrl, aggregator, decimals, maxTickAge = 60_000 } = config;
	const ticks: PriceTick[] = [];
	let latestTick: PriceTick | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let stopped = false;

	function recordTick(price: number): void {
		const tick: PriceTick = { price, timestampMs: Date.now() };
		latestTick = tick;
		ticks.push(tick);
		// Prune old ticks
		const cutoff = Date.now() - maxTickAge;
		while (ticks.length > 0 && (ticks[0]?.timestampMs ?? 0) < cutoff) {
			ticks.shift();
		}
	}

	async function fetchHttpPrice(): Promise<number | null> {
		try {
			const body = JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "eth_call",
				params: [{ to: aggregator, data: LATEST_ROUND_DATA_SELECTOR }, "latest"],
			});
			const res = await fetch(httpUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				signal: AbortSignal.timeout(5_000),
			});
			if (!res.ok) return null;
			const json = (await res.json()) as { result?: string };
			if (!json.result) return null;
			// latestRoundData returns (roundId, answer, startedAt, updatedAt, answeredInRound)
			// answer is at bytes 32-64 (offset 66-130 in hex string with 0x prefix)
			const hex = json.result;
			const answerHex = `0x${hex.slice(66, 130)}`;
			const raw = BigInt(answerHex);
			return Number(raw) / 10 ** decimals;
		} catch (err) {
			log.warn("HTTP price fetch failed", { error: err instanceof Error ? err.message : String(err) });
			return null;
		}
	}

	function startPolling(): void {
		pollTimer = setInterval(async () => {
			if (stopped) return;
			const price = await fetchHttpPrice();
			if (price !== null) recordTick(price);
		}, 3_000);
	}

	return {
		getLatestPrice: () => latestTick,
		getRecentTicks: (maxAgeMs = maxTickAge) => {
			const cutoff = Date.now() - maxAgeMs;
			return ticks.filter((t) => t.timestampMs >= cutoff);
		},
		start: () => {
			stopped = false;
			startPolling();
			// WS subscription to Polygon for real-time updates is an enhancement —
			// start with HTTP polling which is simpler and sufficient for 1s ticks
			log.info("Chainlink adapter started (HTTP polling)");
		},
		stop: () => {
			stopped = true;
			if (pollTimer) clearInterval(pollTimer);
			log.info("Chainlink adapter stopped");
		},
	};
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/src/data/chainlink.ts
git commit -m "feat(bot): add Chainlink price feed adapter — HTTP polling with tick buffer"
```

---

### Task 16: Data — Polymarket adapter

**Files:**
- Create: `packages/bot/src/data/polymarket.ts`

- [ ] **Step 1: Implement Polymarket adapter (Gamma API + CLOB WS)**

```typescript
// packages/bot/src/data/polymarket.ts
import { z } from "zod";
import { createLogger } from "../core/logger.ts";
import type { MarketInfo, OrderBookSnapshot } from "../core/types.ts";

const log = createLogger("polymarket");

const GammaMarketSchema = z.object({
	slug: z.string(),
	conditionId: z.string().optional(),
	endDate: z.string(),
	eventStartTime: z.string().optional(),
	outcomes: z.union([z.string(), z.array(z.string())]),
	clobTokenIds: z.union([z.string(), z.array(z.string())]),
}).passthrough();

function parseArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value !== "string") return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

export async function fetchMarketBySlug(
	slug: string,
	gammaUrl: string,
): Promise<MarketInfo | null> {
	try {
		const url = new URL("/markets", gammaUrl);
		url.searchParams.set("slug", slug);
		const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
		if (!res.ok) return null;
		const data: unknown = await res.json();
		const market = Array.isArray(data) ? data[0] : data;
		if (!market) return null;

		const parsed = GammaMarketSchema.safeParse(market);
		if (!parsed.success) {
			log.warn("Invalid Gamma market data", { slug });
			return null;
		}

		const outcomes = parseArray(parsed.data.outcomes);
		const tokenIds = parseArray(parsed.data.clobTokenIds);
		const upIdx = outcomes.findIndex((o) => o.toLowerCase() === "up");
		const downIdx = outcomes.findIndex((o) => o.toLowerCase() === "down");
		const upTokenId = upIdx >= 0 ? tokenIds[upIdx] : undefined;
		const downTokenId = downIdx >= 0 ? tokenIds[downIdx] : undefined;

		if (!upTokenId || !downTokenId) {
			log.warn("Missing token IDs", { slug, outcomes, tokenIds });
			return null;
		}

		const endMs = new Date(parsed.data.endDate).getTime();
		const startMs = parsed.data.eventStartTime
			? new Date(parsed.data.eventStartTime).getTime()
			: endMs - 300_000;

		return {
			slug: parsed.data.slug,
			conditionId: parsed.data.conditionId ?? "",
			upTokenId,
			downTokenId,
			priceToBeat: 0, // PtB comes from market description or separate source
			startMs,
			endMs,
		};
	} catch (err) {
		log.warn("fetchMarketBySlug failed", { slug, error: err instanceof Error ? err.message : String(err) });
		return null;
	}
}

export interface PolymarketOrderBookAdapter {
	getOrderBook(tokenId: string): OrderBookSnapshot | null;
	subscribe(tokenIds: string[]): void;
	stop(): void;
}

export function createOrderBookAdapter(clobWsUrl: string): PolymarketOrderBookAdapter {
	const books = new Map<string, OrderBookSnapshot>();
	let ws: WebSocket | null = null;
	let stopped = false;

	function connect(tokenIds: string[]): void {
		if (stopped) return;
		try {
			ws = new WebSocket(clobWsUrl);
			ws.onopen = () => {
				for (const tokenId of tokenIds) {
					ws?.send(JSON.stringify({
						type: "subscribe",
						channel: "best_bid_ask",
						assets_ids: [tokenId],
					}));
				}
				log.info("CLOB WS connected", { tokens: tokenIds.length });
			};
			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
					if (msg.event_type === "best_bid_ask") {
						const tokenId = String(msg.asset_id ?? "");
						const bestBid = Number(msg.best_bid ?? 0) || null;
						const bestAsk = Number(msg.best_ask ?? 0) || null;
						const midpoint = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
						const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
						books.set(tokenId, { bestBid, bestAsk, midpoint, spread, timestampMs: Date.now() });
					}
				} catch { /* ignore parse errors */ }
			};
			ws.onclose = () => {
				if (!stopped) {
					log.warn("CLOB WS disconnected, reconnecting in 3s");
					setTimeout(() => connect(tokenIds), 3_000);
				}
			};
		} catch (err) {
			log.error("CLOB WS connection error", { error: err instanceof Error ? err.message : String(err) });
		}
	}

	return {
		getOrderBook: (tokenId) => books.get(tokenId) ?? null,
		subscribe: (tokenIds) => connect(tokenIds),
		stop: () => {
			stopped = true;
			ws?.close();
		},
	};
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/src/data/polymarket.ts
git commit -m "feat(bot): add Polymarket adapter — Gamma API market discovery + CLOB WS orderbook"
```

---

## Chunk 4: Trading Layer

### Task 17: Trading — account module (TDD)

**Files:**
- Create: `packages/bot/src/trading/account.ts`
- Create: `packages/bot/src/__tests__/account.test.ts`

- [ ] **Step 1: Write failing tests for account**

```typescript
// packages/bot/src/__tests__/account.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { createAccountManager, type AccountManager } from "../trading/account.ts";

describe("AccountManager", () => {
	let account: AccountManager;

	beforeEach(() => {
		account = createAccountManager(1000); // 1000 USDC starting
	});

	it("starts with correct initial state", () => {
		const stats = account.getStats();
		expect(stats.balanceUsdc).toBe(1000);
		expect(stats.totalTrades).toBe(0);
		expect(stats.totalPnl).toBe(0);
	});

	it("records a winning trade", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, true); // win
		const stats = account.getStats();
		expect(stats.wins).toBe(1);
		expect(stats.totalTrades).toBe(1);
		expect(stats.totalPnl).toBeGreaterThan(0);
	});

	it("records a losing trade", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, false); // loss
		const stats = account.getStats();
		expect(stats.losses).toBe(1);
		expect(stats.totalPnl).toBeLessThan(0);
	});

	it("tracks pending trades", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		expect(account.getStats().pending).toBe(1);
		account.settleTrade(0, true);
		expect(account.getStats().pending).toBe(0);
	});

	it("computes win rate correctly", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, true);
		account.recordTrade({ side: "DOWN", size: 5, price: 0.55 });
		account.settleTrade(1, false);
		expect(account.getStats().winRate).toBeCloseTo(0.5, 6);
	});

	it("computes today P&L", () => {
		account.recordTrade({ side: "UP", size: 5, price: 0.55 });
		account.settleTrade(0, true);
		const stats = account.getStats();
		expect(stats.todayPnl).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/account.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement account.ts**

```typescript
// packages/bot/src/trading/account.ts
import type { AccountStatsDto, Side } from "@orakel/shared/contracts";

interface PendingTrade {
	side: Side;
	size: number;
	price: number;
	settled: boolean;
	won: boolean | null;
	pnl: number | null;
	timestamp: number;
}

export interface AccountManager {
	recordTrade(params: { side: Side; size: number; price: number }): number;
	settleTrade(index: number, won: boolean): void;
	getStats(): AccountStatsDto;
	getTodayLossUsdc(): number;
	getPendingCount(): number;
}

export function createAccountManager(initialBalanceUsdc: number): AccountManager {
	let balance = initialBalanceUsdc;
	const trades: PendingTrade[] = [];

	function computePnl(trade: PendingTrade, won: boolean): number {
		// Buy at `price`, if win → payout $1 per share, if lose → payout $0
		// shares = size / price (fractional)
		// PnL = won ? (1 - price) * shares : -price * shares = won ? size * (1/price - 1) : -size
		// Simpler: PnL = won ? size * ((1 - price) / price) : -size
		return won ? trade.size * ((1 - trade.price) / trade.price) : -trade.size;
	}

	return {
		recordTrade({ side, size, price }) {
			const idx = trades.length;
			trades.push({ side, size, price, settled: false, won: null, pnl: null, timestamp: Date.now() });
			return idx;
		},

		settleTrade(index, won) {
			const trade = trades[index];
			if (!trade || trade.settled) return;
			trade.settled = true;
			trade.won = won;
			trade.pnl = computePnl(trade, won);
			balance += trade.pnl;
		},

		getStats() {
			const settled = trades.filter((t) => t.settled);
			const wins = settled.filter((t) => t.won === true).length;
			const losses = settled.filter((t) => t.won === false).length;
			const pending = trades.filter((t) => !t.settled).length;
			const totalPnl = settled.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

			const todayStart = new Date();
			todayStart.setHours(0, 0, 0, 0);
			const todayMs = todayStart.getTime();
			const todayTrades = settled.filter((t) => t.timestamp >= todayMs);
			const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

			const total = wins + losses;
			return {
				totalTrades: total,
				wins,
				losses,
				pending,
				winRate: total > 0 ? wins / total : 0,
				totalPnl,
				todayPnl,
				todayTrades: todayTrades.length,
				dailyMaxLoss: 0, // filled from config at call site
				balanceUsdc: balance,
			};
		},

		getTodayLossUsdc() {
			const todayStart = new Date();
			todayStart.setHours(0, 0, 0, 0);
			const todayMs = todayStart.getTime();
			return trades
				.filter((t) => t.settled && t.timestamp >= todayMs && (t.pnl ?? 0) < 0)
				.reduce((sum, t) => sum + Math.abs(t.pnl ?? 0), 0);
		},

		getPendingCount() {
			return trades.filter((t) => !t.settled).length;
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/account.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/trading/account.ts packages/bot/src/__tests__/account.test.ts
git commit -m "feat(bot): add account module with TDD — P&L tracking, balance, win rate"
```

---

### Task 18: Trading — paper trader + live trader

**Files:**
- Create: `packages/bot/src/trading/paperTrader.ts`
- Create: `packages/bot/src/trading/liveTrader.ts`
- Create: `packages/bot/src/trading/persistence.ts`

- [ ] **Step 1: Implement paper trader**

```typescript
// packages/bot/src/trading/paperTrader.ts
import { createLogger } from "../core/logger.ts";
import type { Side } from "../core/types.ts";
import type { AccountManager } from "./account.ts";

const log = createLogger("paper-trader");

export interface PaperTradeParams {
	windowSlug: string;
	side: Side;
	price: number;
	size: number;
	edge: number;
	modelProb: number;
	marketProb: number;
	priceToBeat: number;
	entryBtcPrice: number;
	phase: string;
}

export interface PaperTradeResult {
	success: boolean;
	tradeIndex: number;
}

export function executePaperTrade(
	params: PaperTradeParams,
	account: AccountManager,
): PaperTradeResult {
	const tradeIndex = account.recordTrade({
		side: params.side,
		size: params.size,
		price: params.price,
	});
	log.info("Paper trade executed", {
		window: params.windowSlug,
		side: params.side,
		price: params.price,
		size: params.size,
		edge: params.edge.toFixed(4),
	});
	return { success: true, tradeIndex };
}
```

- [ ] **Step 2: Implement live trader**

```typescript
// packages/bot/src/trading/liveTrader.ts
import { createLogger } from "../core/logger.ts";
import type { Side } from "../core/types.ts";
import { createOrder } from "../cli/commands.ts";
import type { AppConfig } from "@orakel/shared/contracts";

const log = createLogger("live-trader");

export interface LiveTradeParams {
	tokenId: string;
	side: Side;
	price: number;
	size: number;
	windowSlug: string;
	edge: number;
}

export interface LiveTradeResult {
	success: boolean;
	orderId: string | null;
	error?: string;
}

export async function executeLiveTrade(
	params: LiveTradeParams,
	config: AppConfig,
): Promise<LiveTradeResult> {
	const limitPrice = Math.max(
		config.execution.minOrderPrice,
		Math.min(config.execution.maxOrderPrice, params.price - config.execution.limitDiscount),
	);

	const result = await createOrder({
		tokenId: params.tokenId,
		side: "buy",
		price: Number(limitPrice.toFixed(2)),
		size: params.size,
		orderType: config.execution.orderType as "GTC" | "GTD" | "FOK",
	});

	if (!result.ok) {
		log.warn("Live trade failed", { window: params.windowSlug, error: result.error });
		return { success: false, orderId: null, error: result.error };
	}

	const orderId = result.data?.orderID ?? null;
	log.info("Live trade placed", {
		window: params.windowSlug,
		side: params.side,
		price: limitPrice,
		size: params.size,
		orderId,
	});
	return { success: true, orderId };
}
```

- [ ] **Step 3: Implement persistence**

```typescript
// packages/bot/src/trading/persistence.ts
import { getDb } from "../db/client.ts";
import { trades, signals } from "../db/schema.ts";
import { createLogger } from "../core/logger.ts";

const log = createLogger("persistence");

export async function persistSignal(data: {
	windowSlug: string;
	chainlinkPrice: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edgeUp: number;
	edgeDown: number;
	volatility: number;
	timeLeftSeconds: number;
	phase: string;
	decision: string;
	reason: string | null;
}): Promise<void> {
	try {
		const db = getDb();
		await db.insert(signals).values({
			windowSlug: data.windowSlug,
			chainlinkPrice: String(data.chainlinkPrice),
			priceToBeat: String(data.priceToBeat),
			deviation: String(data.deviation),
			modelProbUp: String(data.modelProbUp),
			marketProbUp: String(data.marketProbUp),
			edgeUp: String(data.edgeUp),
			edgeDown: String(data.edgeDown),
			volatility: String(data.volatility),
			timeLeftSeconds: data.timeLeftSeconds,
			phase: data.phase,
			decision: data.decision,
			reason: data.reason,
		});
	} catch (err) {
		log.warn("Failed to persist signal", { error: err instanceof Error ? err.message : String(err) });
	}
}

export async function persistTrade(data: {
	mode: string;
	windowSlug: string;
	windowStartMs: number;
	windowEndMs: number;
	side: string;
	price: number;
	size: number;
	priceToBeat: number;
	entryBtcPrice: number;
	edge: number;
	modelProb: number;
	marketProb: number;
	phase: string;
	orderId: string | null;
}): Promise<number> {
	try {
		const db = getDb();
		const result = await db.insert(trades).values({
			mode: data.mode,
			windowSlug: data.windowSlug,
			windowStartMs: data.windowStartMs,
			windowEndMs: data.windowEndMs,
			side: data.side,
			price: String(data.price),
			size: String(data.size),
			priceToBeat: String(data.priceToBeat),
			entryBtcPrice: String(data.entryBtcPrice),
			edge: String(data.edge),
			modelProb: String(data.modelProb),
			marketProb: String(data.marketProb),
			phase: data.phase,
			orderId: data.orderId,
		}).returning({ id: trades.id });
		return result[0]?.id ?? 0;
	} catch (err) {
		log.warn("Failed to persist trade", { error: err instanceof Error ? err.message : String(err) });
		return 0;
	}
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/bot/src/trading/
git commit -m "feat(bot): add trading layer — paper trader, live trader (CLI), persistence"
```

---

## Chunk 5: Runtime + App + Terminal + Backtest

### Task 19: Runtime — window manager (TDD)

**Files:**
- Create: `packages/bot/src/runtime/windowManager.ts`
- Create: `packages/bot/src/__tests__/windowManager.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/bot/src/__tests__/windowManager.test.ts
import { describe, expect, it } from "vitest";
import { createWindowState, advanceWindowState, type WindowTrackerState } from "../runtime/windowManager.ts";

describe("createWindowState", () => {
	it("creates initial PENDING state", () => {
		const state = createWindowState("btc-updown-5m-100", 0, 100_000);
		expect(state.slug).toBe("btc-updown-5m-100");
		expect(state.state).toBe("PENDING");
	});
});

describe("advanceWindowState", () => {
	it("transitions PENDING → ACTIVE when within window", () => {
		const state = createWindowState("test", 1000, 6000);
		const next = advanceWindowState(state, 2000, false);
		expect(next.state).toBe("ACTIVE");
	});

	it("transitions ACTIVE → CLOSING when past window end", () => {
		const state: WindowTrackerState = {
			slug: "test", state: "ACTIVE", startMs: 1000, endMs: 6000,
			marketInfo: null, traded: false,
		};
		const next = advanceWindowState(state, 7000, false);
		expect(next.state).toBe("CLOSING");
	});

	it("transitions CLOSING → SETTLED when resolution confirmed", () => {
		const state: WindowTrackerState = {
			slug: "test", state: "CLOSING", startMs: 1000, endMs: 6000,
			marketInfo: null, traded: false,
		};
		const next = advanceWindowState(state, 8000, true);
		expect(next.state).toBe("SETTLED");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run src/__tests__/windowManager.test.ts --config packages/bot/vitest.config.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement windowManager.ts**

```typescript
// packages/bot/src/runtime/windowManager.ts
import type { WindowStateLabel } from "../core/types.ts";
import type { MarketInfo } from "../core/types.ts";

export interface WindowTrackerState {
	slug: string;
	state: WindowStateLabel;
	startMs: number;
	endMs: number;
	marketInfo: MarketInfo | null;
	traded: boolean;
}

export function createWindowState(slug: string, startMs: number, endMs: number): WindowTrackerState {
	return { slug, state: "PENDING", startMs, endMs, marketInfo: null, traded: false };
}

export function advanceWindowState(
	current: WindowTrackerState,
	nowMs: number,
	resolutionConfirmed: boolean,
): WindowTrackerState {
	const next = { ...current };

	switch (current.state) {
		case "PENDING":
			if (nowMs >= current.startMs && nowMs < current.endMs) {
				next.state = "ACTIVE";
			}
			break;
		case "ACTIVE":
			if (nowMs >= current.endMs) {
				next.state = "CLOSING";
			}
			break;
		case "CLOSING":
			if (resolutionConfirmed) {
				next.state = "SETTLED";
			}
			break;
		case "SETTLED":
			// Transition to REDEEMED happens externally after redeem call
			break;
		case "REDEEMED":
			break;
	}

	return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run src/__tests__/windowManager.test.ts --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/runtime/windowManager.ts packages/bot/src/__tests__/windowManager.test.ts
git commit -m "feat(bot): add window manager with TDD — state machine lifecycle"
```

---

### Task 20: Runtime — settlement + redeemer

**Files:**
- Create: `packages/bot/src/runtime/settlement.ts`
- Create: `packages/bot/src/runtime/redeemer.ts`

- [ ] **Step 1: Implement settlement**

```typescript
// packages/bot/src/runtime/settlement.ts
import { createLogger } from "../core/logger.ts";
import type { AccountManager } from "../trading/account.ts";

const log = createLogger("settlement");

export interface SettlementParams {
	windowSlug: string;
	priceToBeat: number;
	settleBtcPrice: number;
	tradeIndex: number;
	side: "UP" | "DOWN";
}

export function settleWindow(
	params: SettlementParams,
	account: AccountManager,
): { won: boolean } {
	const priceUp = params.settleBtcPrice >= params.priceToBeat;
	const won = (params.side === "UP" && priceUp) || (params.side === "DOWN" && !priceUp);
	account.settleTrade(params.tradeIndex, won);
	log.info("Window settled", {
		window: params.windowSlug,
		side: params.side,
		won,
		settleBtcPrice: params.settleBtcPrice,
		priceToBeat: params.priceToBeat,
	});
	return { won };
}
```

- [ ] **Step 2: Implement redeemer**

```typescript
// packages/bot/src/runtime/redeemer.ts
import { createLogger } from "../core/logger.ts";
import { redeemPositions } from "../cli/commands.ts";

const log = createLogger("redeemer");

export async function runRedemption(): Promise<{ ok: boolean; error?: string }> {
	log.info("Running CTF redemption");
	const result = await redeemPositions();
	if (!result.ok) {
		log.warn("Redemption failed", { error: result.error });
		return { ok: false, error: result.error };
	}
	log.info("Redemption completed", { durationMs: result.durationMs });
	return { ok: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/bot/src/runtime/settlement.ts packages/bot/src/runtime/redeemer.ts
git commit -m "feat(bot): add settlement and redeemer modules"
```

---

### Task 21: Runtime — main loop

**Files:**
- Create: `packages/bot/src/runtime/mainLoop.ts`

- [ ] **Step 1: Implement main loop**

```typescript
// packages/bot/src/runtime/mainLoop.ts
import { createLogger } from "../core/logger.ts";
import { getConfig } from "../core/config.ts";
import { computeWindowBounds, computeSlug, computeTimeLeftSeconds, computePhase } from "../core/clock.ts";
import type { ChainlinkAdapter } from "../data/chainlink.ts";
import { fetchMarketBySlug, type PolymarketOrderBookAdapter } from "../data/polymarket.ts";
import { modelProbability, computeVolatility, type SignalParams } from "../engine/signal.ts";
import { computeEdge } from "../engine/edge.ts";
import { makeTradeDecision, type DecisionInput } from "../engine/decision.ts";
import { executePaperTrade } from "../trading/paperTrader.ts";
import { executeLiveTrade } from "../trading/liveTrader.ts";
import type { AccountManager } from "../trading/account.ts";
import { persistSignal, persistTrade } from "../trading/persistence.ts";
import { createWindowState, advanceWindowState, type WindowTrackerState } from "./windowManager.ts";
import { settleWindow } from "./settlement.ts";
import { runRedemption } from "./redeemer.ts";
import type { WsPublisher } from "../app/ws.ts";
import { renderDashboard } from "../terminal/dashboard.ts";
import { isPaperRunning, isLiveRunning, getStateSnapshot } from "../core/state.ts";
import type { Side, Phase, Decision, PriceTick } from "../core/types.ts";

const log = createLogger("main-loop");

const SIGNAL_PARAMS: SignalParams = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };

interface MainLoopDeps {
	chainlink: ChainlinkAdapter;
	polymarketWs: PolymarketOrderBookAdapter;
	paperAccount: AccountManager;
	liveAccount: AccountManager;
	ws: WsPublisher;
}

interface TradeEntry {
	index: number;
	side: Side;
	tradeId?: number;
}

export function createMainLoop(deps: MainLoopDeps) {
	const { chainlink, polymarketWs, paperAccount, liveAccount, ws } = deps;
	const config = getConfig();
	let currentWindow: WindowTrackerState | null = null;
	let previousWindow: WindowTrackerState | null = null;
	const windowTrades = new Map<string, TradeEntry[]>();
	let consecutiveFailures = 0;
	let safeMode = false;
	let interval: ReturnType<typeof setInterval> | null = null;

	function getWindowTrades(slug: string): TradeEntry[] {
		if (!windowTrades.has(slug)) windowTrades.set(slug, []);
		return windowTrades.get(slug) ?? [];
	}

	async function discoverWindow(): Promise<void> {
		const nowSec = Math.floor(Date.now() / 1000);
		const { startSec, endSec } = computeWindowBounds(nowSec, config.infra.windowSeconds);
		const slug = computeSlug(endSec, config.infra.slugPrefix);

		if (currentWindow?.slug === slug) return;

		const market = await fetchMarketBySlug(slug, config.infra.polymarketGammaUrl);
		if (!market) {
			log.warn("Market not found, will retry", { slug });
			return;
		}

		previousWindow = currentWindow;
		currentWindow = createWindowState(slug, startSec * 1000, endSec * 1000);
		currentWindow.marketInfo = market;
		log.info("Discovered new window", { slug, priceToBeat: market.priceToBeat });

		if (market.upTokenId && market.downTokenId) {
			polymarketWs.subscribe([market.upTokenId, market.downTokenId]);
		}
	}

	async function processTick(): Promise<void> {
		try {
			const nowMs = Date.now();
			const paperRunning = isPaperRunning();
			const liveRunning = isLiveRunning();

			if (!currentWindow) {
				await discoverWindow();
				return;
			}

			const priceTick = chainlink.getLatestPrice();
			if (!priceTick) {
				log.warn("No Chainlink price available");
				return;
			}
			if (nowMs - priceTick.timestampMs > 5000) {
				log.warn("Stale price, skipping tick", { ageMs: nowMs - priceTick.timestampMs });
				return;
			}

			const timeLeft = computeTimeLeftSeconds(nowMs, currentWindow.endMs);
			const phase = computePhase(timeLeft, config.strategy.phaseEarlySeconds, config.strategy.phaseLateSeconds);

			const marketInfo = currentWindow.marketInfo;
			if (!marketInfo) return;

			const upBook = polymarketWs.getOrderBook(marketInfo.upTokenId);
			const downBook = polymarketWs.getOrderBook(marketInfo.downTokenId);
			if (!upBook?.midpoint || !downBook?.midpoint) {
				log.debug("Orderbook not ready");
				return;
			}

			const marketProbUp = upBook.midpoint;
			const priceToBeat = marketInfo.priceToBeat || priceTick.price;
			const deviation = (priceTick.price - priceToBeat) / priceToBeat;
			const recentTicks = chainlink.getRecentTicks(60000);
			const volatility = computeVolatility(recentTicks);
			const modelProbUp = modelProbability(deviation, timeLeft, volatility, SIGNAL_PARAMS);
			const { edgeUp, edgeDown, bestSide, bestEdge } = computeEdge(modelProbUp, marketProbUp);

			const tradesInWindow = getWindowTrades(currentWindow.slug).length;
			const hasPosition = tradesInWindow > 0;

			const decisionInput: DecisionInput = {
				modelProbUp,
				marketProbUp,
				timeLeftSeconds: timeLeft,
				phase,
				strategy: config.strategy,
				risk: config.risk.paper,
				hasPositionInWindow: hasPosition,
				todayLossUsdc: paperAccount.getTodayLossUsdc(),
				openPositions: paperAccount.getPendingCount(),
				tradesInWindow,
			};

			const decision = makeTradeDecision(decisionInput);

			await persistSignal({
				windowSlug: currentWindow.slug,
				chainlinkPrice: priceTick.price,
				priceToBeat,
				deviation,
				modelProbUp,
				marketProbUp,
				edgeUp,
				edgeDown,
				volatility,
				timeLeftSeconds: timeLeft,
				phase,
				decision: decision.decision,
				reason: decision.reason,
			});

			if (decision.decision.startsWith("ENTER")) {
				const side = decision.side!;
				const entryPrice = side === "UP" ? upBook.midpoint : downBook.midpoint;
				const tokenId = side === "UP" ? marketInfo.upTokenId : marketInfo.downTokenId;

				if (paperRunning && !hasPosition) {
					const tradeIndex = executePaperTrade({
						windowSlug: currentWindow.slug,
						side,
						price: entryPrice,
						size: config.risk.paper.maxTradeSizeUsdc,
						edge: decision.edge,
						modelProb: modelProbUp,
						marketProb: marketProbUp,
						priceToBeat,
						entryBtcPrice: priceTick.price,
						phase,
					}, paperAccount).tradeIndex;
					getWindowTrades(currentWindow.slug).push({ index: tradeIndex, side });
				}

				if (liveRunning && !hasPosition) {
					const result = await executeLiveTrade({
						tokenId,
						side,
						price: entryPrice,
						size: config.risk.live.maxTradeSizeUsdc,
						windowSlug: currentWindow.slug,
						edge: decision.edge,
					}, config);
					if (result.success) {
						const tradeId = await persistTrade({
							mode: "live",
							windowSlug: currentWindow.slug,
							windowStartMs: currentWindow.startMs,
							windowEndMs: currentWindow.endMs,
							side,
							price: entryPrice,
							size: config.risk.live.maxTradeSizeUsdc,
							priceToBeat,
							entryBtcPrice: priceTick.price,
							edge: decision.edge,
							modelProb: modelProbUp,
							marketProb: marketProbUp,
							phase,
							orderId: result.orderId,
						});
						getWindowTrades(currentWindow.slug).push({ index: 0, side, tradeId });
					}
				}
			}

			currentWindow.state = advanceWindowState(currentWindow, nowMs, false).state;

			if (previousWindow && previousWindow.state !== "REDEEMED") {
				const settled = advanceWindowState(previousWindow, nowMs, true);
				if (settled.state === "SETTLED" && previousWindow.state !== "SETTLED") {
					const settlePrice = priceTick.price;
					const trades = getWindowTrades(previousWindow.slug);
					for (const entry of trades) {
						const won = (entry.side === "UP" && settlePrice >= priceToBeat) || (entry.side === "DOWN" && settlePrice < priceToBeat);
						paperAccount.settleTrade(entry.index, won);
						if (liveRunning) await runRedemption();
					}
					previousWindow.state = "SETTLED";
				}
			}

			ws.broadcast("state:snapshot", {
				updatedAt: new Date().toISOString(),
				...getStateSnapshot(),
				currentWindow: {
					slug: currentWindow.slug,
					state: currentWindow.state,
					startMs: currentWindow.startMs,
					endMs: currentWindow.endMs,
					timeLeftSeconds: timeLeft,
					priceToBeat,
					chainlinkPrice: priceTick.price,
					deviation,
					modelProbUp,
					marketProbUp,
					edgeUp,
					edgeDown,
					phase,
					decision: decision.decision,
					volatility,
				},
				paperStats: paperAccount.getStats(),
				liveStats: liveAccount.getStats(),
			});

			renderDashboard({
				slug: currentWindow.slug,
				state: currentWindow.state,
				timeLeft,
				price: priceTick.price,
				priceToBeat,
				deviation,
				modelProbUp,
				marketProbUp,
				edge: bestEdge,
				phase,
				paperPnl: paperAccount.getStats().totalPnl,
			});

			consecutiveFailures = 0;
			if (safeMode) {
				safeMode = false;
				log.info("Recovered from safe mode");
			}
		} catch (err) {
			consecutiveFailures++;
			log.error("Tick processing error", { error: err instanceof Error ? err.message : String(err), consecutiveFailures });
			if (consecutiveFailures >= 10 && !safeMode) {
				safeMode = true;
				log.warn("Entering safe mode — trading paused");
			}
		}
	}

	return {
		start() {
			interval = setInterval(processTick, config.infra.pollIntervalMs);
			log.info("Main loop started", { intervalMs: config.infra.pollIntervalMs });
		},
		stop() {
			if (interval) clearInterval(interval);
			log.info("Main loop stopped");
		},
	};
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
# Expected: packages/bot passes (some cross-module imports may need adjustment)
```

- [ ] **Step 3: Commit**

```bash
git add packages/bot/src/runtime/mainLoop.ts
git commit -m "feat(bot): add main loop — tick orchestration connecting all modules"
```

---

### Task 22: App layer — bootstrap, API routes, WebSocket

**Files:**
- Create: `packages/bot/src/app/bootstrap.ts`
- Create: `packages/bot/src/app/api/routes.ts`
- Create: `packages/bot/src/app/ws.ts`

- [ ] **Step 1: Implement bootstrap**

```typescript
// packages/bot/src/app/bootstrap.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadEnv } from "../core/env.ts";
import { loadConfigFromFile } from "../core/config.ts";
import { connectDb } from "../db/client.ts";
import { createChainlinkAdapter } from "../data/chainlink.ts";
import { createOrderBookAdapter } from "../data/polymarket.ts";
import { createAccountManager } from "../trading/account.ts";
import { createMainLoop } from "../runtime/mainLoop.ts";
import { createWsPublisher } from "./ws.ts";
import { createApiRoutes } from "./api/routes.ts";
import { createLogger } from "../core/logger.ts";
import { checkCliAvailable } from "../cli/commands.ts";
import { applyPendingStarts, applyPendingStops } from "../core/state.ts";

const log = createLogger("bootstrap");

export async function bootstrapApp(): Promise<void> {
	const env = loadEnv();
	const config = await loadConfigFromFile("./config.json");
	await connectDb(env.DATABASE_URL);

	const chainlink = createChainlinkAdapter({
		httpUrl: config.infra.chainlinkHttpUrl,
		aggregator: config.infra.chainlinkAggregator,
		decimals: config.infra.chainlinkDecimals,
	});
	chainlink.start();

	const polymarketWs = createOrderBookAdapter(config.infra.polymarketClobWsUrl);

	const cliAvailable = await checkCliAvailable();
	if (!cliAvailable && !env.PAPER_MODE) {
		log.error("Polymarket CLI not available and not in paper mode — aborting");
		process.exit(1);
	}
	log.info("CLI check", { available: cliAvailable });

	const paperAccount = createAccountManager(10000);
	const liveAccount = createAccountManager(0);

	const ws = createWsPublisher();
	const mainLoop = createMainLoop({ chainlink, polymarketWs, paperAccount, liveAccount, ws });

	const app = new Hono();
	app.use("*", cors());
	app.route("/api", createApiRoutes());

	const server = Bun.serve({
		port: env.PORT,
		fetch: app.fetch,
		websocket: ws.getWebSocketHandler(),
	});

	log.info("API server started", { port: env.PORT });

	setInterval(() => {
		applyPendingStarts();
		applyPendingStops();
	}, 1000);

	mainLoop.start();

	const watcher = Bun.file("./config.json").watch();
	void (async () => {
		for await (const _ of watcher) {
			try {
				await loadConfigFromFile("./config.json");
				log.info("Config reloaded");
			} catch (err) {
				log.warn("Config reload failed", { error: err instanceof Error ? err.message : String(err) });
			}
		}
	})();

	process.on("SIGINT", () => {
		log.info("Shutting down...");
		mainLoop.stop();
		chainlink.stop();
		polymarketWs.stop();
		server.stop();
		process.exit(0);
	});
}
```

- [ ] **Step 2: Implement API routes**

```typescript
// packages/bot/src/app/api/routes.ts
import { Hono } from "hono";
import { getConfig, mergeConfigUpdate } from "../../core/config.ts";
import { getDb } from "../../db/client.ts";
import { trades, signals } from "../../db/schema.ts";
import { desc, eq, and, sql } from "drizzle-orm";
import { requestPaperStart, requestPaperStop, requestLiveStart, requestLiveStop, isPaperRunning, isLiveRunning, getStateSnapshot } from "../../core/state.ts";
import { checkCliAvailable } from "../../cli/commands.ts";
import type { ControlRequestDto, ConfigUpdateDto } from "@orakel/shared/contracts";
import { z } from "zod";

export function createApiRoutes(): Hono {
	const app = new Hono();

	app.get("/status", async (c) => {
		const config = getConfig();
		const state = getStateSnapshot();
		return c.json({
			paperRunning: state.paperRunning,
			liveRunning: state.liveRunning,
			paperPendingStart: state.paperPendingStart,
			paperPendingStop: state.paperPendingStop,
			livePendingStart: state.livePendingStart,
			livePendingStop: state.livePendingStop,
			currentWindow: null,
			chainlinkPrice: null,
			chainlinkPriceAgeMs: null,
			cliAvailable: await checkCliAvailable(),
			dbConnected: true,
			uptimeMs: Date.now() - startTime,
		});
	});

	app.get("/trades", async (c) => {
		const mode = c.req.query("mode");
		const limit = Number(c.req.query("limit") ?? "50");
		const db = getDb();
		const rows = await db.query.trades.findMany({
			where: mode ? eq(trades.mode, mode) : undefined,
			orderBy: desc(trades.createdAt),
			limit,
		});
		return c.json(rows);
	});

	app.get("/signals", async (c) => {
		const slug = c.req.query("windowSlug");
		const limit = Number(c.req.query("limit") ?? "100");
		const db = getDb();
		const rows = await db.query.signals.findMany({
			where: slug ? eq(signals.windowSlug, slug) : undefined,
			orderBy: desc(signals.timestamp),
			limit,
		});
		return c.json(rows);
	});

	app.get("/config", (c) => {
		const config = getConfig();
		return c.json({
			strategy: config.strategy,
			risk: config.risk,
			execution: config.execution,
		});
	});

	app.patch("/config", async (c) => {
		const body = (await c.req.json()) as ConfigUpdateDto;
		const current = getConfig();
		mergeConfigUpdate(current, body);
		return c.json({ ok: true });
	});

	app.post("/control/start", async (c) => {
		const body = (await c.req.json()) as ControlRequestDto;
		if (body.mode === "paper") requestPaperStart();
		else requestLiveStart();
		return c.json({ ok: true, message: `${body.mode} trading start requested`, state: { paperRunning: isPaperRunning(), liveRunning: isLiveRunning() } });
	});

	app.post("/control/stop", async (c) => {
		const body = (await c.req.json()) as ControlRequestDto;
		if (body.mode === "paper") requestPaperStop();
		else requestLiveStop();
		return c.json({ ok: true, message: `${body.mode} trading stop requested`, state: { paperRunning: isPaperRunning(), liveRunning: isLiveRunning() } });
	});

	app.get("/stats", async (c) => {
		const db = getDb();
		const [paperStats, liveStats] = await Promise.all([
			db.select({ count: sql<number>`count(*)`, wins: sql<number>`count(case when outcome = 'WIN' then 1 end)`, pnl: sql<number>`sum(pnl_usdc)` }).from(trades).where(eq(trades.mode, "paper")),
			db.select({ count: sql<number>`count(*)`, wins: sql<number>`count(case when outcome = 'WIN' then 1 end)`, pnl: sql<number>`sum(pnl_usdc)` }).from(trades).where(eq(trades.mode, "live")),
		]);
		return c.json({
			paper: { totalTrades: paperStats[0]?.count ?? 0, wins: paperStats[0]?.wins ?? 0, totalPnl: paperStats[0]?.pnl ?? 0 },
			live: { totalTrades: liveStats[0]?.count ?? 0, wins: liveStats[0]?.wins ?? 0, totalPnl: liveStats[0]?.pnl ?? 0 },
		});
	});

	return app;
}

const startTime = Date.now();
```

- [ ] **Step 3: Implement WebSocket publisher**

```typescript
// packages/bot/src/app/ws.ts
import type { Server } from "bun";
import type { WsMessage, WsEventType } from "@orakel/shared/contracts";

interface WsConnection {
	send: (data: string) => void;
}

export function createWsPublisher() {
	const connections = new Set<WsConnection>();

	return {
		broadcast<T>(type: WsEventType, data: T) {
			const msg: WsMessage<T> = { type, data, ts: Date.now() };
			const payload = JSON.stringify(msg);
			for (const conn of connections) {
				try { conn.send(payload); } catch { /* ignore */ }
			}
		},
		getWebSocketHandler() {
			return {
				open: (ws: unknown) => { connections.add(ws as WsConnection); },
				close: (ws: unknown) => { connections.delete(ws as WsConnection); },
			};
		},
	};
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
# Expected: packages/bot passes (packages/web will fail — expected)
```

- [ ] **Step 5: Commit**

```bash
git add packages/bot/src/app/
git commit -m "feat(bot): add app layer — bootstrap, Hono API routes, WebSocket publisher"
```

---

### Task 23: Terminal dashboard

**Files:**
- Create: `packages/bot/src/terminal/dashboard.ts`

- [ ] **Step 1: Implement terminal dashboard**

```typescript
// packages/bot/src/terminal/dashboard.ts
import { createLogger } from "../core/logger.ts";

const log = createLogger("dashboard");

interface DashboardData {
	slug: string;
	state: string;
	timeLeft: number;
	price: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edge: number;
	phase: string;
	paperPnl: number;
}

export function renderDashboard(data: DashboardData): void {
	const lines = [
		"═══ BTC 5-Min Bot ═══",
		`Window: ${data.slug} | State: ${data.state} | Phase: ${data.phase}`,
		`Time Left: ${data.timeLeft}s`,
		`",`
		`Chainlink: $${data.price.toFixed(2)} | PtB: $${data.priceToBeat.toFixed(2)} | Dev: ${(data.deviation * 100).toFixed(3)}%`,
		`Model P(Up): ${(data.modelProbUp * 100).toFixed(1)}% | Market: ${(data.marketProbUp * 100).toFixed(1)}%`,
		`Edge: ${(data.edge * 100).toFixed(2)}%`,
		`Paper P&L: $${data.paperPnl.toFixed(2)}`,
		"═════════════════════",
	];
	// biome-ignore lint/suspicious/noConsole: terminal dashboard is authorized console use
	console.clear();
	for (const line of lines) {
		// biome-ignore lint/suspicious/noConsole: terminal dashboard
		console.log(line);
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/src/terminal/dashboard.ts
git commit -m "feat(bot): add terminal dashboard — single market status rendering"
```

---

### Task 24: Entry point

**Files:**
- Create: `packages/bot/src/index.ts`

- [ ] **Step 1: Implement entry point**

```typescript
// packages/bot/src/index.ts
import { bootstrapApp } from "./app/bootstrap.ts";
import { createLogger } from "./core/logger.ts";

const log = createLogger("main");

async function main(): Promise<void> {
	await bootstrapApp();
}

void main().catch((err: unknown) => {
	log.error("Fatal startup error", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/src/index.ts
git commit -m "feat(bot): add entry point"
```

---

### Task 25: Backtest engine (scaffold)

**Files:**
- Create: `packages/bot/src/backtest/engine.ts`
- Create: `packages/bot/src/backtest/replay.ts`

- [ ] **Step 1: Implement backtest engine scaffold**

```typescript
// packages/bot/src/backtest/engine.ts
import { createLogger } from "../core/logger.ts";
import { computeWindowBounds, computeSlug, computePhase, computeTimeLeftSeconds } from "../core/clock.ts";
import { modelProbability, computeVolatility, type SignalParams } from "../engine/signal.ts";
import { computeEdge } from "../engine/edge.ts";
import { makeTradeDecision, type DecisionInput } from "../engine/decision.ts";
import { getConfig } from "../core/config.ts";
import type { PriceTick } from "../core/types.ts";
import type { BacktestTick, BacktestResult } from "./replay.ts";

const log = createLogger("backtest");

const SIGNAL_PARAMS: SignalParams = { sigmoidScale: 5, minVolatility: 0.0001, epsilon: 0.001 };

export interface BacktestWindow {
	slug: string;
	startMs: number;
	endMs: number;
	priceToBeat: number;
	outcome: "UP" | "DOWN";
	ticks: BacktestTick[];
}

export interface BacktestTrade {
	side: "UP" | "DOWN";
	entryPrice: number;
	modelProb: number;
	marketProb: number;
	edge: number;
	won: boolean;
	pnl: number;
}

export function runBacktest(windows: BacktestWindow[], initialBalance = 10000): BacktestResult {
	const config = getConfig();
	let balance = initialBalance;
	const trades: BacktestTrade[] = [];

	for (const window of windows) {
		for (const tick of window.ticks) {
			const timeLeft = computeTimeLeftSeconds(tick.timestampMs, window.endMs);
			if (timeLeft <= 0) continue;

			const phase = computePhase(timeLeft, config.strategy.phaseEarlySeconds, config.strategy.phaseLateSeconds);
			const deviation = (tick.chainlinkPrice - window.priceToBeat) / window.priceToBeat;
			const volatility = 0.001; // Placeholder — would compute from prior ticks
			const modelProbUp = modelProbability(deviation, timeLeft, volatility, SIGNAL_PARAMS);
			const { bestEdge, bestSide } = computeEdge(modelProbUp, tick.marketProbUp);

			const decisionInput: DecisionInput = {
				modelProbUp,
				marketProbUp: tick.marketProbUp,
				timeLeftSeconds: timeLeft,
				phase,
				strategy: config.strategy,
				risk: config.risk.paper,
				hasPositionInWindow: trades.some(t => t.side === bestSide),
				todayLossUsdc: 0,
				openPositions: 0,
				tradesInWindow: 0,
			};

			const decision = makeTradeDecision(decisionInput);

			if (decision.decision.startsWith("ENTER")) {
				const entryPrice = bestSide === "UP" ? tick.marketProbUp : 1 - tick.marketProbUp;
				const size = config.risk.paper.maxTradeSizeUsdc;
				const won = window.outcome === bestSide;
				const pnl = won ? size * ((1 - entryPrice) / entryPrice) : -size;
				balance += pnl;
				trades.push({ side: bestSide, entryPrice, modelProb: modelProbUp, marketProb: tick.marketProbUp, edge: bestEdge, won, pnl });
			}
		}
	}

	const wins = trades.filter(t => t.won).length;
	const losses = trades.filter(t => !t.won).length;
	const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

	return {
		totalTrades: trades.length,
		wins,
		losses,
		winRate: trades.length > 0 ? wins / trades.length : 0,
		totalPnl,
		finalBalance: balance,
		trades,
	};
}
```

- [ ] **Step 2: Implement replay data fetcher**

```typescript
// packages/bot/src/backtest/replay.ts
import { createLogger } from "../core/logger.ts";
import { getConfig } from "../core/config.ts";
import { computeWindowBounds, computeSlug } from "../core/clock.ts";
import { fetchMarketBySlug } from "../data/polymarket.ts";

const log = createLogger("replay");

export interface BacktestTick {
	timestampMs: number;
	chainlinkPrice: number;
	marketProbUp: number;
}

export interface BacktestResult {
	totalTrades: number;
	wins: number;
	losses: number;
	winRate: number;
	totalPnl: number;
	finalBalance: number;
	trades: Array<{ side: "UP" | "DOWN"; entryPrice: number; modelProb: number; marketProb: number; edge: number; won: boolean; pnl: number }>;
}

export async function fetchWindowTicks(slug: string, startMs: number, endMs: number): Promise<BacktestTick[]> {
	// Primary: query bot's own signals table for high fidelity
	// Fallback: fetch from CLOB /prices-history for lower fidelity
	// This is a scaffold — full implementation would query DB or API
	log.debug("Fetching window ticks", { slug, startMs, endMs });
	return [];
}

export async function generateWindowsForRange(startDate: Date, endDate: Date): Promise<Array<{ slug: string; startMs: number; endMs: number; priceToBeat: number; outcome: "UP" | "DOWN" }>> {
	const config = getConfig();
	const windows = [];
	let current = new Date(startDate);

	while (current <= endDate) {
		const sec = Math.floor(current.getTime() / 1000);
		const { startSec, endSec } = computeWindowBounds(sec, config.infra.windowSeconds);
		const slug = computeSlug(endSec, config.infra.slugPrefix);

		const market = await fetchMarketBySlug(slug, config.infra.polymarketGammaUrl);
		if (market) {
			const outcome: "UP" | "DOWN" = "UP"; // Would come from market resolution state
			windows.push({ slug, startMs: startSec * 1000, endMs: endSec * 1000, priceToBeat: market.priceToBeat, outcome });
		}

		current = new Date((endSec + config.infra.windowSeconds) * 1000);
	}

	return windows;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/bot/src/backtest/
git commit -m "feat(bot): add backtest engine scaffold — replay and reporting"
```

---

### Task 26: Dockerfile update

**Files:**
- Modify: `packages/bot/Dockerfile`

- [ ] **Step 1: Update Dockerfile to include Polymarket CLI**

Add a build stage that downloads the pinned CLI binary:

```dockerfile
ARG POLYMARKET_CLI_VERSION=v0.1.5
RUN curl -sSL -o /usr/local/bin/polymarket \
    "https://github.com/Polymarket/polymarket-cli/releases/download/${POLYMARKET_CLI_VERSION}/polymarket-linux-amd64" \
    && chmod +x /usr/local/bin/polymarket
```

- [ ] **Step 2: Commit**

```bash
git add packages/bot/Dockerfile
git commit -m "feat(bot): add Polymarket CLI binary to Docker image"
```

---

### Task 27: Final verification

- [ ] **Step 1: Run all tests**

```bash
bunx vitest run --config packages/bot/vitest.config.ts
# Expected: all PASS
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
# Expected: packages/bot and packages/shared pass
# packages/web will fail — expected and documented as out of scope
```

- [ ] **Step 3: Run lint**

```bash
bun run lint
# Expected: no errors (warnings acceptable)
```

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address lint and typecheck issues from final verification"
```
