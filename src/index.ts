import { startApiServer } from "./api.ts";
import { applyEvent, initAccountState, resetAccountState, updateFromSnapshot } from "./blockchain/accountState.ts";
import { startReconciler } from "./blockchain/reconciler.ts";
import { fetchRedeemablePositions, redeemAll, redeemByConditionId } from "./blockchain/redeemer.ts";
import { CONFIG, startConfigWatcher } from "./core/config.ts";
import { getDb, onchainStatements, statements } from "./core/db.ts";
import { env } from "./core/env.ts";
import { createLogger } from "./core/logger.ts";
import { getActiveMarkets } from "./core/markets.ts";
import {
	emitBalanceSnapshot,
	emitStateSnapshot,
	getUpdatedAt,
	isLiveRunning,
	isPaperRunning,
	setLiveRunning,
	setOnchainBalance,
	setPaperRunning,
	updateMarkets,
} from "./core/state.ts";
import { getCandleWindowTiming, sleep } from "./core/utils.ts";
import { startMultiBinanceTradeStream } from "./data/binanceWs.ts";
import { startChainlinkPriceStream } from "./data/chainlinkWs.ts";
import { startBalancePolling } from "./data/polygonBalance.ts";
import { startOnChainEventStream } from "./data/polygonEvents.ts";
import type { ClobWsHandle } from "./data/polymarketClobWs.ts";
import { startClobMarketWs } from "./data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "./data/polymarketLiveWs.ts";
import type { MarketState, ProcessMarketResult } from "./pipeline/processMarket.ts";
import { processMarket as processMarketPipeline } from "./pipeline/processMarket.ts";
import { getAccount, initAccountStats, liveAccount, paperAccount } from "./trading/accountStats.ts";
import { LiveSettler } from "./trading/liveSettler.ts";
import { OrderManager, type TrackedOrder } from "./trading/orderManager.ts";
import { shouldTakeTrade } from "./trading/strategyRefinement.ts";
import { renderDashboard } from "./trading/terminal.ts";
import {
	connectWallet,
	executeTrade,
	getClient,
	getOpenGtdOrderCount,
	getWallet,
	registerOpenGtdOrder,
	startHeartbeat,
	stopHeartbeat,
	unregisterOpenGtdOrder,
} from "./trading/trader.ts";
import type { MarketSnapshot, StreamHandles, WsStreamHandle } from "./types.ts";

export type { ProcessMarketResult } from "./pipeline/processMarket.ts";

const log = createLogger("bot");
const processMarket = processMarketPipeline;

interface SimpleOrderTracker {
	orders: Map<string, number>;
	lastTradeMs: number;
	cooldownMs: number;
	keyFor(marketId: string, windowSlug: string): string;
	hasOrder(marketId: string, windowSlug: string): boolean;
	totalActive(): number;
	record(marketId: string, windowSlug: string, recordedAtMs?: number): void;
	prune(): void;
	onCooldown(): boolean;
}

function createTradeTracker() {
	return {
		markets: new Set<string>(),
		windowStartMs: 0,
		globalCount: 0,
		clear() {
			this.markets.clear();
			this.globalCount = 0;
			this.windowStartMs = 0;
		},
		setWindow(startMs: number) {
			if (this.windowStartMs !== startMs) {
				this.clear();
				this.windowStartMs = startMs;
			}
		},
		has(marketId: string, startMs: number): boolean {
			return this.markets.has(`${marketId}:${startMs}`);
		},
		record(marketId: string, startMs: number) {
			this.markets.add(`${marketId}:${startMs}`);
			this.globalCount++;
		},
		canTradeGlobally(maxGlobal: number): boolean {
			return this.globalCount < maxGlobal;
		},
	};
}

const paperTracker = createTradeTracker();
const liveTracker = createTradeTracker();

let balancePollingHandle: { getLast(): unknown; close(): void } | null = null;
let eventStreamHandle: { close(): void } | null = null;
let reconcilerHandle: { runNow(): Promise<number>; close(): void } | null = null;
let redeemTimerHandle: ReturnType<typeof setInterval> | null = null;
let activeOnchainWallet: string | null = null;
let liveSettlerInstance: LiveSettler | null = null;

// Auto-redeem configuration
const AUTO_REDEEM_ENABLED = env.AUTO_REDEEM_ENABLED;
const AUTO_REDEEM_INTERVAL_MS = env.AUTO_REDEEM_INTERVAL_MS;

interface KnownTokenRow {
	token_id?: string;
}

interface LivePendingOrderRow {
	order_id?: string;
	market_id?: string;
	window_start_ms?: number;
	side?: string;
	price?: number;
	size?: number;
	price_to_beat?: number | null;
	current_price_at_entry?: number | null;
	token_id?: string | null;
	placed_at?: number;
	status?: string;
}

function collectLatestPrices(
	markets: ReadonlyArray<{ id: string }>,
	states: Map<string, MarketState>,
): Map<string, number> {
	const prices = new Map<string, number>();
	for (const market of markets) {
		const marketState = states.get(market.id);
		const p = marketState?.prevCurrentPrice;
		if (p !== null && p !== undefined) {
			prices.set(market.id, p);
		}
	}
	return prices;
}

function readKnownTokenIds(): string[] {
	try {
		const rows = onchainStatements.getKnownCtfTokens().all({}) as KnownTokenRow[];
		if (!Array.isArray(rows)) return [];
		return rows.map((row) => String(row?.token_id ?? "").trim()).filter((tokenId) => tokenId.length > 0);
	} catch {
		return [];
	}
}

async function main(): Promise<void> {
	startApiServer();
	startConfigWatcher();
	initAccountStats();

	// Auto-connect wallet if PRIVATE_KEY is configured
	if (env.PRIVATE_KEY) {
		try {
			const { address } = await connectWallet(env.PRIVATE_KEY);
			log.info(`Auto-connected wallet: ${address}`);

			// Start auto-redeem timer if enabled
			if (AUTO_REDEEM_ENABLED) {
				log.info(`Auto-redeem enabled: checking every ${AUTO_REDEEM_INTERVAL_MS / 60_000} minutes`);
				redeemTimerHandle = setInterval(async () => {
					try {
						const wallet = getWallet();
						if (!wallet) {
							log.warn("Auto-redeem skipped: wallet not connected");
							return;
						}

						const positions = await fetchRedeemablePositions(wallet.address);
						if (positions.length === 0) {
							log.debug("Auto-redeem: no redeemable positions found");
							return;
						}

						const totalValue = positions.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
						log.info(
							`Auto-redeem: found ${positions.length} position(s) worth $${totalValue.toFixed(2)}, redeeming...`,
						);

						const results = await redeemAll(wallet);
						const successCount = results.filter((r) => !r.error).length;
						const redeemedValue = results
							.filter((r) => r.value !== undefined)
							.reduce((sum, r) => sum + (r.value ?? 0), 0);

						if (successCount > 0) {
							log.info(
								`Auto-redeem success: ${successCount}/${results.length} redeemed, total value: $${redeemedValue.toFixed(2)}`,
							);
						} else {
							log.warn(`Auto-redeem failed: all ${results.length} redemption(s) failed`);
						}

						// Log individual failures
						for (const result of results) {
							if (result.error) {
								log.warn(`Redeem failed for ${result.conditionId.slice(0, 10)}...: ${result.error}`);
							}
						}
					} catch (err) {
						log.error("Auto-redeem error:", err instanceof Error ? err.message : String(err));
					}
				}, AUTO_REDEEM_INTERVAL_MS);

				// Run once on startup to check for any pending redemptions
				setTimeout(async () => {
					try {
						const wallet = getWallet();
						if (!wallet) return;

						const positions = await fetchRedeemablePositions(wallet.address);
						if (positions.length > 0) {
							const totalValue = positions.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
							log.info(`Startup auto-redeem check: ${positions.length} position(s) worth $${totalValue.toFixed(2)}`);
						}
					} catch (err) {
						log.error("Startup redeem check failed:", err instanceof Error ? err.message : String(err));
					}
				}, 5000); // Check after 5 seconds to ensure RPC is ready
			}
		} catch (err) {
			log.error("Failed to auto-connect wallet:", err instanceof Error ? err.message : String(err));
		}
	}

	// Periodic WAL checkpoint to prevent database corruption
	const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
	log.info(`WAL checkpoint enabled: running every ${WAL_CHECKPOINT_INTERVAL_MS / 60_000} minutes`);
	setInterval(() => {
		try {
			const db = getDb();
			db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
			log.debug("WAL checkpoint completed");
		} catch (err) {
			log.error("WAL checkpoint failed:", err instanceof Error ? err.message : String(err));
		}
	}, WAL_CHECKPOINT_INTERVAL_MS);

	const orderManager = new OrderManager();

	orderManager.onOrderStatusChange(
		(order: TrackedOrder, status: TrackedOrder["status"], previousStatus: TrackedOrder["status"]) => {
			try {
				statements.updateTradeStatus().run({
					$orderId: order.orderId,
					$mode: "live",
					$status: status,
				});
			} catch (err) {
				log.warn(`Failed to update live trade status for ${order.orderId.slice(0, 12)}...`, err);
			}

			try {
				statements.updateLivePendingOrderStatus().run({
					$orderId: order.orderId,
					$status: status,
				});
			} catch {
				// Best-effort: row may not exist (e.g. FOK orders or already cleaned up)
			}

			if (status === "filled" && previousStatus !== "filled") {
				const parsedWindowStartMs = Number(order.windowSlug);
				const windowStartMs = Number.isFinite(parsedWindowStartMs)
					? parsedWindowStartMs
					: getCandleWindowTiming(CONFIG.candleWindowMinutes).startMs;
				let recorded = false;

				try {
					liveAccount.addTrade(
						{
							marketId: order.marketId,
							windowStartMs,
							side: order.side === "DOWN" ? "DOWN" : "UP",
							price: order.price,
							size: order.size,
							priceToBeat: order.priceToBeat ?? 0,
							currentPriceAtEntry: order.currentPriceAtEntry ?? null,
							timestamp: new Date(order.placedAt).toISOString(),
						},
						order.orderId,
					);
					log.info(`Recorded filled live trade ${order.orderId.slice(0, 12)}...`);
					recorded = true;
				} catch (err) {
					log.error(
						`Failed to record filled live trade ${order.orderId.slice(0, 12)}...:`,
						err instanceof Error ? err.message : String(err),
					);
				}

				if (recorded) {
					try {
						statements.deleteLivePendingOrder().run({ $orderId: order.orderId });
					} catch {
						// Best-effort cleanup
					}
				}
			}

			if (status === "cancelled" || status === "expired") {
				try {
					statements.deleteLivePendingOrder().run({ $orderId: order.orderId });
				} catch {
					// Best-effort cleanup
				}
				orderTracker.orders.delete(orderTracker.keyFor(order.marketId, order.windowSlug));
			}

			if (status === "filled" || status === "cancelled" || status === "expired") {
				unregisterOpenGtdOrder(order.orderId);
			}
		},
	);

	const markets = getActiveMarkets();
	const binanceSymbols = markets.map((m) => m.binanceSymbol);
	const polymarketSymbols = markets.map((m) => m.chainlink.wsSymbol);

	const streams: StreamHandles = {
		binance: startMultiBinanceTradeStream(binanceSymbols),
		polymarket: startMultiPolymarketPriceStream(polymarketSymbols),
		chainlink: new Map<string, WsStreamHandle>(),
	};

	for (const market of markets) {
		streams.chainlink.set(
			market.id,
			startChainlinkPriceStream({
				aggregator: market.chainlink.aggregator,
				decimals: market.chainlink.decimals,
			}),
		);
	}

	const clobWs: ClobWsHandle = startClobMarketWs();

	function lookupTokenId(marketId: string, side: string): string | null {
		try {
			const row = onchainStatements.getCtfTokenByMarketSide().get({
				$marketId: marketId,
				$side: side,
			}) as { token_id: string } | null;
			return row?.token_id ?? null;
		} catch {
			return null;
		}
	}

	function lookupConditionId(tokenId: string): string | null {
		try {
			const row = onchainStatements.getKnownCtfToken().get({
				$tokenId: tokenId,
			}) as { condition_id: string | null } | null;
			return row?.condition_id ?? null;
		} catch {
			return null;
		}
	}

	function ensureLiveSettler(): void {
		if (liveSettlerInstance?.isRunning()) return;
		if (!isLiveRunning()) return;

		liveSettlerInstance = new LiveSettler({
			clobWs,
			liveAccount,
			wallet: getWallet(),
			lookupTokenId,
			lookupConditionId,
			redeemFn: redeemByConditionId,
		});
		liveSettlerInstance.start();
	}

	const states = new Map<string, MarketState>(
		markets.map((m) => [
			m.id,
			{
				prevSpotPrice: null,
				prevCurrentPrice: null,
				priceToBeatState: { slug: null, value: null, setAtMs: null },
			},
		]),
	);

	const orderTracker: SimpleOrderTracker = {
		orders: new Map<string, number>(),
		lastTradeMs: 0,
		cooldownMs: 30_000,
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
	};

	// Restore tracker state from DB to prevent duplicate orders after restart.
	// Without this, a restart mid-window could allow re-placing orders.
	const currentTiming = getCandleWindowTiming(CONFIG.candleWindowMinutes);
	const pendingLive = liveAccount.getPendingTrades();
	let restoredCount = 0;
	for (const trade of pendingLive) {
		// Restore orderTracker — use windowStartMs as slug proxy for position counting.
		// The exact Polymarket slug isn't stored, but this ensures totalActive() is correct
		// and hasOrder() blocks the same market in the same window.
		const slugProxy = String(trade.windowStartMs);
		const tradeTsMs = Date.parse(trade.timestamp);
		orderTracker.record(trade.marketId, slugProxy, Number.isFinite(tradeTsMs) ? tradeTsMs : trade.windowStartMs);

		// Restore liveTracker — only for trades in the current window
		if (trade.windowStartMs === currentTiming.startMs) {
			liveTracker.record(trade.marketId, trade.windowStartMs);
		}
		restoredCount++;
	}
	if (restoredCount > 0) {
		log.info(
			`Restored ${restoredCount} pending live trades into trackers (window active: ${liveTracker.canTradeGlobally(1) ? 0 : "≥1"})`,
		);
	}

	const pendingOrderRows = statements.getAllLivePendingOrders().all({}) as LivePendingOrderRow[];
	let restoredPendingOrderCount = 0;
	let recoveredFilledPendingCount = 0;
	for (const row of pendingOrderRows) {
		const orderId = String(row.order_id ?? "").trim();
		const marketId = String(row.market_id ?? "").trim();
		const windowStartMs = Number(row.window_start_ms ?? Number.NaN);
		if (!orderId || !marketId || !Number.isFinite(windowStartMs)) continue;
		const price = Number(row.price ?? Number.NaN);
		const size = Number(row.size ?? Number.NaN);
		if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) {
			log.warn(`Skipping invalid live_pending_orders row ${orderId.slice(0, 12)}...`);
			continue;
		}

		const rowStatus = String(row.status ?? "placed").toLowerCase();
		if (rowStatus === "cancelled" || rowStatus === "expired") {
			try {
				statements.deleteLivePendingOrder().run({ $orderId: orderId });
			} catch {
				// Best-effort cleanup
			}
			continue;
		}
		const side = String(row.side ?? "UP").toUpperCase() === "DOWN" ? "DOWN" : "UP";

		if (rowStatus === "filled") {
			let recorded = false;
			try {
				liveAccount.addTrade(
					{
						marketId,
						windowStartMs,
						side,
						price,
						size,
						priceToBeat: Number(row.price_to_beat ?? 0),
						currentPriceAtEntry:
							row.current_price_at_entry === null || row.current_price_at_entry === undefined
								? null
								: Number(row.current_price_at_entry),
						timestamp: new Date(Number(row.placed_at ?? Date.now())).toISOString(),
					},
					orderId,
				);
				recorded = true;
			} catch (err) {
				log.warn(`Failed to recover filled pending order ${orderId.slice(0, 12)}...`, err);
			}

			if (recorded) {
				try {
					statements.updateTradeStatus().run({
						$orderId: orderId,
						$mode: "live",
						$status: "filled",
					});
				} catch {
					// Best-effort
				}
				const windowKey = String(windowStartMs);
				if (!orderTracker.hasOrder(marketId, windowKey)) {
					orderTracker.record(marketId, windowKey, Number(row.placed_at ?? windowStartMs));
				}
				if (windowStartMs === currentTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
					liveTracker.record(marketId, windowStartMs);
				}
				try {
					statements.deleteLivePendingOrder().run({ $orderId: orderId });
				} catch {
					// Best-effort cleanup
				}
				recoveredFilledPendingCount++;
			}
			continue;
		}

		const windowKey = String(windowStartMs);
		if (!orderTracker.hasOrder(marketId, windowKey)) {
			orderTracker.record(marketId, windowKey, Number(row.placed_at ?? windowStartMs));
		}
		if (windowStartMs === currentTiming.startMs && !liveTracker.has(marketId, windowStartMs)) {
			liveTracker.record(marketId, windowStartMs);
		}

		orderManager.addOrderWithTracking(
			{
				orderId,
				marketId,
				windowSlug: windowKey,
				side,
				tokenId: row.token_id ? String(row.token_id) : undefined,
				price,
				size,
				priceToBeat: row.price_to_beat ?? null,
				currentPriceAtEntry: row.current_price_at_entry ?? null,
				placedAt: Number(row.placed_at ?? Date.now()),
			},
			true,
		);
		registerOpenGtdOrder(orderId);
		restoredPendingOrderCount++;
	}
	if (restoredPendingOrderCount > 0) {
		log.info(`Restored ${restoredPendingOrderCount} live pending GTD order(s) for status polling`);
	}
	if (recoveredFilledPendingCount > 0) {
		log.info(`Recovered ${recoveredFilledPendingCount} previously-filled pending live order(s)`);
	}

	const closeOnchainPipelines = () => {
		if (balancePollingHandle) {
			balancePollingHandle.close();
			balancePollingHandle = null;
		}
		if (eventStreamHandle) {
			eventStreamHandle.close();
			eventStreamHandle = null;
		}
		if (reconcilerHandle) {
			reconcilerHandle.close();
			reconcilerHandle = null;
		}
		activeOnchainWallet = null;
		resetAccountState();
	};

	const ensureOrderPolling = () => {
		const clobClient = getClient();
		if (clobClient) {
			orderManager.setClient(clobClient);
			orderManager.startPolling();
			if (getOpenGtdOrderCount() > 0) {
				startHeartbeat();
			}
			return;
		}
		orderManager.setClient(null);
		if (!isLiveRunning()) {
			orderManager.stopPolling();
		}
	};

	const ensureOnchainPipelines = () => {
		const wallet = getWallet();
		if (!wallet) {
			if (activeOnchainWallet !== null) {
				log.info("Wallet disconnected, stopping on-chain pipelines");
				closeOnchainPipelines();
			}
			return;
		}

		const walletAddress = wallet.address.toLowerCase();
		const walletChanged = activeOnchainWallet !== null && activeOnchainWallet !== walletAddress;
		if (walletChanged) {
			log.info(`Wallet changed (${activeOnchainWallet} -> ${walletAddress}), restarting on-chain pipelines`);
			closeOnchainPipelines();
		}

		if (activeOnchainWallet === walletAddress && balancePollingHandle && eventStreamHandle && reconcilerHandle) {
			return;
		}

		initAccountState(walletAddress);
		balancePollingHandle = startBalancePolling({
			wallet: walletAddress,
			knownTokenIds: readKnownTokenIds,
			onUpdate: (snapshot) => {
				updateFromSnapshot(snapshot);
				setOnchainBalance(snapshot);
				emitBalanceSnapshot(snapshot);
			},
		});
		eventStreamHandle = startOnChainEventStream({
			wallet: walletAddress,
			onEvent: (event) => {
				applyEvent(event);
				try {
					onchainStatements.insertOnchainEvent().run({
						$txHash: event.txHash,
						$logIndex: event.logIndex,
						$blockNumber: event.blockNumber,
						$eventType: event.type,
						$fromAddr: event.from,
						$toAddr: event.to,
						$tokenId: event.tokenId,
						$value: event.value,
						$rawData: JSON.stringify(event),
					});
				} catch (err) {
					log.warn("Failed to persist on-chain event", err);
				}
			},
		});
		reconcilerHandle = startReconciler({ wallet: walletAddress });
		activeOnchainWallet = walletAddress;
		log.info("On-chain balance/events/reconciler pipelines started");
	};

	let prevWindowStartMs: number | null = null;
	const shutdown = () => {
		log.info("Shutdown signal received, stopping bot...");
		if (liveSettlerInstance) {
			liveSettlerInstance.stop();
			liveSettlerInstance = null;
		}
		orderManager.stopPolling();
		stopHeartbeat();
		setPaperRunning(false);
		setLiveRunning(false);
		streams.binance.close();
		streams.polymarket.close();
		clobWs.close();
		for (const [, handle] of streams.chainlink) {
			handle.close();
		}
		closeOnchainPipelines();
		if (redeemTimerHandle) {
			clearInterval(redeemTimerHandle);
			redeemTimerHandle = null;
			log.info("Auto-redeem timer stopped");
		}
		setTimeout(() => process.exit(0), 2000);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	let consecutiveAllFails = 0;
	const SAFE_MODE_THRESHOLD = 3;

	while (true) {
		ensureOrderPolling();
		ensureOnchainPipelines();

		const shouldRunLoop = isPaperRunning() || isLiveRunning();
		if (!shouldRunLoop) {
			await sleep(1000);
			continue;
		}

		const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
		const latestPrices = collectLatestPrices(markets, states);

		if (latestPrices.size > 0) {
			const paperRecovered = paperAccount.resolveExpiredTrades(latestPrices, CONFIG.candleWindowMinutes);
			if (paperRecovered > 0) {
				log.info(`Recovered expired paper trades: ${paperRecovered}`);
			}
		}

		if (prevWindowStartMs !== null && prevWindowStartMs !== timing.startMs) {
			if (latestPrices.size > 0) {
				const paperResolved = paperAccount.resolveTrades(prevWindowStartMs, latestPrices);
				if (paperResolved > 0) {
					log.info(`Paper window settled: ${paperResolved}`);
				}
			}
		}

		ensureLiveSettler();
		prevWindowStartMs = timing.startMs;

		orderTracker.prune();
		paperTracker.setWindow(timing.startMs);
		liveTracker.setWindow(timing.startMs);
		const results: ProcessMarketResult[] = await Promise.all(
			markets.map(async (market) => {
				try {
					const state = states.get(market.id);
					if (!state) {
						throw new Error(`missing_state_${market.id}`);
					}
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

		const allFailed = results.every((r) => !r.ok);
		if (allFailed && results.length > 0) {
			consecutiveAllFails++;
			log.warn(`All markets failed (${consecutiveAllFails}/${SAFE_MODE_THRESHOLD})`);
			if (consecutiveAllFails >= SAFE_MODE_THRESHOLD) {
				log.error("Safe mode: all markets failed consecutively, skipping trade execution this tick");
				await sleep(1000);
				continue;
			}
		} else {
			if (consecutiveAllFails >= SAFE_MODE_THRESHOLD) {
				log.info("Exiting safe mode: at least one market recovered");
			}
			consecutiveAllFails = 0;
		}

		const newTokenIds = results
			.filter((r) => r.ok && r.signalPayload?.tokens)
			.flatMap((r) => {
				const t = r.signalPayload?.tokens;
				return t ? [t.upTokenId, t.downTokenId] : [];
			});
		if (newTokenIds.length > 0) {
			clobWs.subscribe(newTokenIds);
		}

		const maxGlobalTrades = Number(
			(CONFIG.strategy as { maxGlobalTradesPerWindow?: number }).maxGlobalTradesPerWindow ?? 1,
		);
		const candidates = results
			.filter((r) => r.ok && r.rec?.action === "ENTER" && r.signalPayload)
			.filter((r) => {
				const sig = r.signalPayload;
				if (!sig) return false;
				if (sig.priceToBeat === null || sig.priceToBeat === undefined || sig.priceToBeat === 0) return false;
				if (sig.currentPrice === null || sig.currentPrice === undefined) return false;
				return true;
			})
			.filter((r) => {
				const tl = r.timeLeftMin ?? 0;
				const windowMin = CONFIG.candleWindowMinutes ?? 15;
				const elapsed = windowMin - tl;
				if (elapsed < 3) return false;
				if (tl < 3) return false;
				return true;
			})
			.filter((r) => {
				const sig = r.signalPayload;
				if (!sig) return false;
				const result = shouldTakeTrade({
					market: r.market.id,
					regime: r.rec?.regime ?? null,
					volatility: r.volatility15m ?? 0,
				});
				if (!result.shouldTrade) {
					log.info(`Skip ${r.market.id}: ${result.reason}`);
				}
				return result.shouldTrade;
			})
			.sort((a, b) => {
				const edgeA = Number(a.rec?.edge ?? 0);
				const edgeB = Number(b.rec?.edge ?? 0);
				if (edgeB !== edgeA) return edgeB - edgeA;
				return Number(a.rawSum ?? 1) - Number(b.rawSum ?? 1);
			});

		let successfulTradesThisTick = 0;
		for (const candidate of candidates) {
			const sig = candidate.signalPayload;
			if (!sig) continue;
			const mkt = candidate.market;
			const windowKey = String(timing.startMs);
			const sideBook = sig.side === "UP" ? (candidate.orderbook?.up ?? null) : (candidate.orderbook?.down ?? null);
			const sideLiquidity = sideBook?.askLiquidity ?? sideBook?.bidLiquidity ?? null;

			if (isPaperRunning()) {
				const paperAcc = getAccount("paper");
				const tradeSize = Number(CONFIG.paperRisk.maxTradeSizeUsdc || 0);
				const affordCheck = paperAcc.canAffordTradeWithStopCheck(tradeSize);
				const minPaperLiquidity = Number(CONFIG.paperRisk.minLiquidity || 0);
				const hasPaperLiquidity = sideLiquidity !== null && sideLiquidity >= minPaperLiquidity;
				if (
					!paperTracker.has(mkt.id, timing.startMs) &&
					affordCheck.canTrade &&
					hasPaperLiquidity &&
					paperTracker.canTradeGlobally(Math.min(maxGlobalTrades, CONFIG.paperRisk.maxTradesPerWindow)) &&
					paperAcc.getPendingTrades().length < CONFIG.paperRisk.maxOpenPositions
				) {
					const result = await executeTrade(sig, { marketConfig: mkt, riskConfig: CONFIG.paperRisk }, "paper");
					if (result?.success) {
						paperTracker.record(mkt.id, timing.startMs);
					} else {
						log.warn(`Paper trade failed for ${mkt.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
					}
				} else if (!hasPaperLiquidity) {
					log.info(
						`Skip ${mkt.id} paper: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minPaperLiquidity.toFixed(0)}`,
					);
				} else if (!affordCheck.canTrade) {
					log.warn(`Trade rejected for ${mkt.id}: ${affordCheck.reason}`);
				}
			}

			if (isLiveRunning()) {
				const liveAcc = getAccount("live");
				const minLiveLiquidity = Number(CONFIG.liveRisk.minLiquidity || 0);
				const hasLiveLiquidity = sideLiquidity !== null && sideLiquidity >= minLiveLiquidity;
				if (!hasLiveLiquidity) {
					log.info(
						`Skip ${mkt.id} live: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minLiveLiquidity.toFixed(0)}`,
					);
				} else {
					const liveWindowLimit = Math.min(maxGlobalTrades, CONFIG.liveRisk.maxTradesPerWindow);
					const liveTradeSize = Number(CONFIG.liveRisk.maxTradeSizeUsdc || 0);
					const liveAffordCheck = liveAcc.canAffordTradeWithStopCheck(liveTradeSize);
					const canPlace =
						orderTracker &&
						!orderTracker.hasOrder(mkt.id, windowKey) &&
						!orderTracker.onCooldown() &&
						orderTracker.totalActive() < CONFIG.liveRisk.maxOpenPositions &&
						successfulTradesThisTick < liveWindowLimit &&
						!liveTracker.has(mkt.id, timing.startMs) &&
						liveTracker.canTradeGlobally(liveWindowLimit) &&
						liveAffordCheck.canTrade;

					if (canPlace) {
						const result = await executeTrade(sig, { marketConfig: mkt, riskConfig: CONFIG.liveRisk }, "live");
						if (result?.success) {
							orderTracker.record(mkt.id, windowKey);
							liveTracker.record(mkt.id, timing.startMs);
							successfulTradesThisTick += 1;

							if (result.orderId && (result.isGtdOrder ?? true)) {
								const tradeTokenId = sig.tokens
									? sig.side === "UP"
										? sig.tokens.upTokenId
										: sig.tokens.downTokenId
									: undefined;
								orderManager.addOrderWithTracking(
									{
										orderId: result.orderId,
										marketId: mkt.id,
										windowSlug: windowKey,
										side: sig.side ?? "UP",
										tokenId: tradeTokenId,
										price: result.tradePrice ?? 0,
										size: Number(CONFIG.liveRisk.maxTradeSizeUsdc || 0),
										priceToBeat: sig.priceToBeat ?? null,
										currentPriceAtEntry: sig.currentPrice ?? null,
										placedAt: Date.now(),
									},
									true,
								);
							}
						} else {
							log.warn(`Live trade failed for ${mkt.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
						}
					}
				}
			}
		}

		const snapshots = results.map(
			(r): MarketSnapshot => ({
				id: r.market.id,
				label: r.market.label,
				ok: r.ok,
				error: r.error,
				spotPrice: r.spotPrice ?? null,
				currentPrice: r.currentPrice ?? null,
				priceToBeat: r.priceToBeat ?? null,
				marketUp: r.marketUp ?? null,
				marketDown: r.marketDown ?? null,
				rawSum: r.rawSum ?? null,
				arbitrage: r.arbitrage ?? false,
				predictLong: r.pLong ? Number(r.pLong) : null,
				predictShort: r.pShort ? Number(r.pShort) : null,
				predictDirection: (r.predictNarrative as "LONG" | "SHORT" | "NEUTRAL") ?? "NEUTRAL",
				haColor: r.consec?.color ?? null,
				haConsecutive: r.consec?.count ?? 0,
				rsi: r.rsiNow ?? null,
				macd: r.macd
					? {
							macd: r.macd.macd,
							signal: r.macd.signal,
							hist: r.macd.hist,
							histDelta: r.macd.histDelta,
						}
					: null,
				vwapSlope: r.vwapSlope ?? null,
				timeLeftMin: r.timeLeftMin ?? null,
				phase: r.rec?.phase ?? null,
				action: r.rec?.action ?? "NO_TRADE",
				side: r.rec?.side ?? null,
				edge: r.rec?.edge ?? null,
				strength: r.rec?.strength ?? null,
				reason: r.rec?.reason ?? null,
				volatility15m: r.volatility15m ?? null,
				blendSource: r.blendSource ?? null,
				volImpliedUp: r.volImpliedUp ?? null,
				binanceChainlinkDelta: r.binanceChainlinkDelta ?? null,
				orderbookImbalance: r.orderbookImbalance ?? null,
				confidence: r.rec?.confidence ?? undefined,
			}),
		);
		updateMarkets(snapshots);
		emitStateSnapshot({
			markets: snapshots,
			updatedAt: getUpdatedAt(),
			paperRunning: isPaperRunning(),
			liveRunning: isLiveRunning(),
			paperPendingStart: false,
			paperPendingStop: false,
			livePendingStart: false,
			livePendingStop: false,
			paperStats: paperAccount.getStats(),
			liveStats: liveAccount.getStats(),
			liveTodayStats: liveAccount.getTodayStats(),
		});

		renderDashboard(results);
		await sleep(CONFIG.pollIntervalMs);
	}
}

main();
