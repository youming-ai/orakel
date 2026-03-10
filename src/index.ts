import { bootstrapApp } from "./app/bootstrap.ts";
import { registerShutdownHandlers } from "./app/shutdown.ts";
import { CONFIG } from "./core/config.ts";
import { createLogger } from "./core/logger.ts";
import { getActiveMarkets } from "./core/markets.ts";
import { createTradeTracker } from "./core/tradeTracker.ts";
import { onchainQueries } from "./db/queries.ts";
import { processMarket as processMarketPipeline } from "./pipeline/processMarket.ts";
import { createLiveSettlerController, type LiveSettlerController } from "./runtime/liveSettlerRuntime.ts";
import { type RuntimeOrderTracker, runMainLoop } from "./runtime/mainLoop.ts";
import { createMarketStateMap } from "./runtime/marketState.ts";
import { createOnchainRuntime } from "./runtime/onchainRuntime.ts";
import { restoreRuntimeState } from "./runtime/orderRecovery.ts";
import { createOrderStatusHandler } from "./runtime/orderStatusSync.ts";
import { createMarketStreams } from "./runtime/streamFactory.ts";
import { liveAccount, paperAccount } from "./trading/accountStats.ts";
import { OrderManager } from "./trading/orderManager.ts";
import { renderDashboard } from "./trading/terminal.ts";
import type { StreamHandles } from "./trading/tradeTypes.ts";

export type { ProcessMarketResult } from "./pipeline/processMarket.ts";

const processMarket = processMarketPipeline;
const log = createLogger("main");

const paperTracker = createTradeTracker();

let redeemTimerHandle: ReturnType<typeof setInterval> | null = null;

async function readKnownTokenIds(): Promise<string[]> {
	try {
		const rows = await onchainQueries.getKnownCtfTokens();
		return rows.map((row) => String(row?.tokenId ?? "").trim()).filter((tokenId) => tokenId.length > 0);
	} catch {
		return [];
	}
}

async function main(): Promise<void> {
	let liveSettler: LiveSettlerController | null = null;
	const bootstrapResult = await bootstrapApp({
		isLiveSettlerRunning: () => liveSettler?.getInstance()?.isRunning() ?? false,
	});
	redeemTimerHandle = bootstrapResult.redeemTimerHandle;

	const orderManager = new OrderManager();
	const markets = getActiveMarkets();
	const states = createMarketStateMap(markets);
	const onchainRuntime = createOnchainRuntime({ readKnownTokenIds });
	const { streams, clobWs }: { streams: StreamHandles; clobWs: ReturnType<typeof createMarketStreams>["clobWs"] } =
		createMarketStreams(markets);
	liveSettler = createLiveSettlerController({
		liveAccount,
	});
	const orderTracker: RuntimeOrderTracker = {
		orders: new Map<string, number>(),
		lastTradeMs: 0,
		cooldownMs: 0,
		keyFor(marketId: string, windowSlug: string): string {
			return `${marketId}:${windowSlug}`;
		},
		hasOrder(marketId: string, windowSlug: string): boolean {
			return this.orders.has(this.keyFor(marketId, windowSlug));
		},
		totalActive(): number {
			return this.orders.size;
		},
		record(marketId: string, windowSlug: string, recordedAtMs?: number): void {
			const normalizedTs =
				typeof recordedAtMs === "number" && Number.isFinite(recordedAtMs) ? Math.floor(recordedAtMs) : Date.now();
			const ts = Math.min(normalizedTs, Date.now());
			this.orders.set(this.keyFor(marketId, windowSlug), ts);
			this.lastTradeMs = Math.max(this.lastTradeMs, ts);
		},
		clear(): void {
			this.orders.clear();
			this.lastTradeMs = 0;
		},
		prune(): void {
			const cutoff = Date.now() - 16 * 60_000;
			for (const [key, ts] of this.orders) {
				if (ts < cutoff) this.orders.delete(key);
			}
		},
		onCooldown(): boolean {
			if (this.cooldownMs <= 0) return false;
			return Date.now() - this.lastTradeMs < this.cooldownMs;
		},
		canTradeGlobally(maxGlobal: number): boolean {
			return this.orders.size < maxGlobal;
		},
	};

	orderManager.onOrderStatusChange(
		createOrderStatusHandler({
			markets,
			states,
			liveAccount,
			orderTracker,
		}),
	);

	await restoreRuntimeState({
		orderTracker,
		liveAccount,
		orderManager,
	});

	const prevWindowStartMs = new Map<string, number>();
	registerShutdownHandlers({
		getLiveSettler: () => liveSettler.getInstance(),
		clearLiveSettler: () => {
			liveSettler.clearInstance();
		},
		orderManager,
		streams,
		clobWs,
		onchainRuntime,
		getRedeemTimerHandle: () => redeemTimerHandle,
		clearRedeemTimerHandle: () => {
			redeemTimerHandle = null;
		},
	});

	await runMainLoop({
		markets,
		states,
		streams,
		clobWs,
		orderManager,
		onchainRuntime,
		liveSettler,
		prevWindowStartMs,
		paperTracker,
		liveTracker: orderTracker,
		paperAccount,
		liveAccount,
		processMarket,
		renderDashboard,
		onLiveOrderPlaced: ({
			orderId,
			marketId,
			windowKey,
			side,
			tokenId,
			price,
			size,
			priceToBeat,
			currentPriceAtEntry,
		}) => {
			orderManager.addOrderWithTracking(
				{
					orderId,
					marketId,
					windowSlug: windowKey,
					side,
					tokenId,
					price,
					size,
					priceToBeat,
					currentPriceAtEntry,
					placedAt: Date.now(),
				},
				true,
			);
		},
		enableTakeProfit: (CONFIG.paperRisk.takeProfitPercent ?? 0) > 0 || (CONFIG.liveRisk.takeProfitPercent ?? 0) > 0,
		takeProfitConfig: {
			takeProfitPercent:
				Math.max(CONFIG.paperRisk.takeProfitPercent ?? 0, CONFIG.liveRisk.takeProfitPercent ?? 0) || 0.15,
			checkIntervalMs: 5_000,
		},
	});
}

void main().catch((err: unknown) => {
	log.error("Fatal startup error", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
