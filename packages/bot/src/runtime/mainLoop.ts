import { CONFIG } from "../core/config.ts";
import type { MarketConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import type { CandleWindowTiming } from "../core/marketDataTypes.ts";
import { applyPendingStarts, applyPendingStops, isLiveRunning, isPaperRunning } from "../core/state.ts";
import type { TradeTracker } from "../core/tradeTracker.ts";
import { getCandleWindowTiming, sleep } from "../core/utils.ts";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import { pruneDatabase } from "../db/queries.ts";
import type { MarketState, ProcessMarketResult } from "../pipeline/processMarket.ts";
import type { AccountStatsManager } from "../trading/accountStats.ts";
import type { OrderManager } from "../trading/orderManager.ts";
import type { StreamHandles } from "../trading/tradeTypes.ts";
import type { LiveSettlerController } from "./liveSettlerRuntime.ts";
import type { OnchainRuntime } from "./onchainRuntime.ts";
import { ensureOrderPolling } from "./orderPolling.ts";
import { runSettlementCycle } from "./settlementCycle.ts";
import { publishCurrentStateSnapshot, publishMarketSnapshots } from "./snapshotPublisher.ts";
import { dispatchTradeCandidates } from "./tradeDispatch.ts";

const log = createLogger("main-loop");

export interface RuntimeOrderTracker {
	orders: Map<string, number>;
	lastTradeMs: number;
	cooldownMs: number;
	keyFor(marketId: string, windowSlug: string): string;
	hasOrder(marketId: string, windowSlug: string): boolean;
	totalActive(): number;
	record(marketId: string, windowSlug: string, recordedAtMs?: number): void;
	clear(): void;
	prune(): void;
	onCooldown(): boolean;
	canTradeGlobally(maxGlobal: number): boolean;
}

interface MainLoopParams {
	markets: MarketConfig[];
	states: Map<string, MarketState>;
	streams: StreamHandles;
	clobWs: ClobWsHandle;
	orderManager: OrderManager;
	onchainRuntime: OnchainRuntime;
	liveSettler: LiveSettlerController;
	prevWindowStartMs: Map<string, number>;
	paperTracker: TradeTracker;
	liveTracker: RuntimeOrderTracker;
	paperAccount: AccountStatsManager;
	liveAccount: AccountStatsManager;
	processMarket: (params: {
		market: MarketConfig;
		timing: CandleWindowTiming;
		streams: StreamHandles;
		state: MarketState;
	}) => Promise<ProcessMarketResult>;
	renderDashboard: (results: ProcessMarketResult[]) => void;
	onLiveOrderPlaced: (result: {
		orderId: string;
		marketId: string;
		windowKey: string;
		side: "UP" | "DOWN";
		tokenId?: string;
		price: number;
		size: number;
		priceToBeat: number | null;
		currentPriceAtEntry: number | null;
	}) => void;
}

async function runMaintenance(paperAccount: AccountStatsManager, liveAccount: AccountStatsManager): Promise<void> {
	try {
		const result = await pruneDatabase();
		const total = Object.values(result.pruned).reduce((acc: number, value: number) => acc + value, 0);
		if (total > 0) {
			log.info("DB pruned", result.pruned);
		}
		paperAccount.pruneTrades(CONFIG.maintenance.accountPruneTradesCount);
		liveAccount.pruneTrades(CONFIG.maintenance.accountPruneTradesCount);
	} catch (err) {
		log.warn("DB prune failed", { error: err instanceof Error ? err.message : String(err) });
	}
}

function pruneTrackers(markets: MarketConfig[], paperTracker: TradeTracker, liveTracker: RuntimeOrderTracker): void {
	const oldestActiveWindow = Math.min(
		...markets.map((market) => getCandleWindowTiming(market.candleWindowMinutes).startMs),
	);
	paperTracker.prune(oldestActiveWindow);
	liveTracker.prune();
}

async function processMarkets(
	markets: MarketConfig[],
	states: Map<string, MarketState>,
	streams: StreamHandles,
	processMarket: MainLoopParams["processMarket"],
): Promise<ProcessMarketResult[]> {
	return Promise.all(
		markets.map(async (market) => {
			try {
				const state = states.get(market.id);
				if (!state) {
					throw new Error(`missing_state_${market.id}`);
				}
				const timing = getCandleWindowTiming(market.candleWindowMinutes);
				return await processMarket({
					market,
					timing,
					streams,
					state,
				});
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return { ok: false, market, error: message };
			}
		}),
	);
}

function handleSafeMode(results: ProcessMarketResult[], consecutiveAllFails: number): number {
	const allFailed = results.every((result) => !result.ok);
	if (!allFailed || results.length === 0) {
		if (consecutiveAllFails >= CONFIG.maintenance.safeModeThreshold) {
			log.info("Exiting safe mode: at least one market recovered");
		}
		return 0;
	}

	const nextCount = consecutiveAllFails + 1;
	log.warn(`All markets failed (${nextCount}/${CONFIG.maintenance.safeModeThreshold})`);
	for (const result of results) {
		if (!result.ok) {
			log.warn(`  ${result.market.id}: ${result.error}`);
		}
	}
	return nextCount;
}

function subscribeNewTokenIds(clobWs: ClobWsHandle, results: ProcessMarketResult[]): void {
	const tokenIds = results
		.filter((result) => result.ok && result.signalPayload?.tokens)
		.flatMap((result) => {
			const tokens = result.signalPayload?.tokens;
			return tokens ? [tokens.upTokenId, tokens.downTokenId] : [];
		});

	if (tokenIds.length > 0) {
		clobWs.subscribe(tokenIds);
	}
}

export async function runMainLoop({
	markets,
	states,
	streams,
	clobWs,
	orderManager,
	onchainRuntime,
	liveSettler,
	prevWindowStartMs,
	paperTracker,
	liveTracker,
	paperAccount,
	liveAccount,
	processMarket,
	renderDashboard,
	onLiveOrderPlaced,
}: MainLoopParams): Promise<never> {
	let consecutiveAllFails = 0;
	let lastPruneMs = 0;

	await runMaintenance(paperAccount, liveAccount);
	lastPruneMs = Date.now();

	while (true) {
		ensureOrderPolling({ orderManager });
		onchainRuntime.ensurePipelines();
		if (applyPendingStarts()) {
			publishCurrentStateSnapshot();
		}

		const shouldRunLoop = isPaperRunning() || isLiveRunning();
		if (!shouldRunLoop) {
			if (Date.now() - lastPruneMs >= CONFIG.maintenance.pruneIntervalMs) {
				await runMaintenance(paperAccount, liveAccount);
				lastPruneMs = Date.now();
			}
			await sleep(1000);
			continue;
		}

		await runSettlementCycle({
			markets,
			states,
			prevWindowStartMs,
			paperAccount,
			liveAccount,
		});
		if (applyPendingStops()) {
			publishCurrentStateSnapshot();
		}

		if (!isPaperRunning() && !isLiveRunning()) {
			await sleep(1000);
			continue;
		}

		liveSettler.ensure();
		pruneTrackers(markets, paperTracker, liveTracker);

		const results = await processMarkets(markets, states, streams, processMarket);
		consecutiveAllFails = handleSafeMode(results, consecutiveAllFails);
		if (consecutiveAllFails >= CONFIG.maintenance.safeModeThreshold) {
			log.error("Safe mode: all markets failed consecutively, skipping trade execution this tick");
			await sleep(1000);
			continue;
		}

		subscribeNewTokenIds(clobWs, results);

		await dispatchTradeCandidates({
			results,
			paperTracker,
			liveTracker,
			onLiveOrderPlaced,
		});

		publishMarketSnapshots(results);
		renderDashboard(results);

		if (Date.now() - lastPruneMs >= CONFIG.maintenance.pruneIntervalMs) {
			await runMaintenance(paperAccount, liveAccount);
			lastPruneMs = Date.now();
		}

		await sleep(CONFIG.pollIntervalMs);
	}
}
