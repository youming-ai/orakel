import fs from "node:fs";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { providers, Wallet } from "ethers";
import { enrichPosition } from "./accountState.ts";
import { storeSignalMetadata } from "./adaptiveState.ts";
import { CONFIG } from "./config.ts";
import { onchainStatements, PERSIST_BACKEND, statements } from "./db.ts";
import { calculateKellyPositionSize } from "./engines/positionSizing.ts";
import { env } from "./env.ts";
import { clearLiveStatsCache, getLiveStatsLegacy } from "./liveStats.ts";
import { createLogger } from "./logger.ts";
import { addPaperTrade, getPaperBalance } from "./paperStats.ts";
import { emitTradeExecuted, isLiveRunning, setLiveRunning } from "./state.ts";
import type { DailyState, MarketConfig, PositionSizeResult, RiskConfig, TradeResult, TradeSignal } from "./types.ts";
import { getCandleWindowTiming } from "./utils.ts";

const log = createLogger("trader");

const PAPER_DAILY_PATH = "./data/paper-daily-state.json";
const LIVE_DAILY_PATH = "./data/live-daily-state.json";
const CREDS_PATH = "./data/api-creds.json";

const HOST = CONFIG.clobBaseUrl;
const CHAIN_ID = 137;

const RPC_URLS: string[] = [
	env.POLYGON_RPC_URL,
	"https://polygon-bor-rpc.publicnode.com",
	"https://polygon-rpc.com",
	"https://rpc.ankr.com/polygon",
].filter((x): x is string => Boolean(x));

let wallet: Wallet | null = null;
let client: ClobClient | null = null;
let paperDailyState: DailyState = {
	date: new Date().toDateString(),
	pnl: 0,
	trades: 0,
};
let liveDailyState: DailyState = {
	date: new Date().toDateString(),
	pnl: 0,
	trades: 0,
};

// ============ Pending Live Trade Settlement ============
interface PendingLiveTrade {
	orderId: string;
	marketId: string;
	side: "UP" | "DOWN";
	buyPrice: number;
	size: number;
	priceToBeat: number;
	windowStartMs: number;
}
const pendingLiveTrades: PendingLiveTrade[] = [];

// ============ Heartbeat & Open Order Management ============
// Polymarket cancels all open orders if no heartbeat received within 10s (5s buffer).
// We send heartbeats every 5 seconds while live trading has active GTD orders.
// FOK orders fill immediately and don't need heartbeat.
const openGtdOrders = new Set<string>(); // Track open GTD order IDs
let heartbeatId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatFailures = 0;
const MAX_HEARTBEAT_FAILURES = 3;

// Reconnection state for heartbeat
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let heartbeatReconnecting = false;

export function startHeartbeat(): boolean {
	if (heartbeatTimer) return true; // already running
	if (!client) {
		// Client not initialized is expected when in paper mode or before wallet connection
		log.debug("Cannot start heartbeat: client not initialized");
		return false;
	}
	heartbeatFailures = 0;
	reconnectAttempts = 0;
	heartbeatReconnecting = false;
	heartbeatTimer = setInterval(async () => {
		if (!client) {
			stopHeartbeat();
			return;
		}
		// Only send heartbeat if we have open GTD orders
		if (openGtdOrders.size === 0) {
			return;
		}
		try {
			const resp = await client.postHeartbeat(heartbeatId ?? undefined);
			heartbeatId = resp.heartbeat_id;
			heartbeatFailures = 0;
			reconnectAttempts = 0; // Reset reconnect attempts on success
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			heartbeatFailures++;
			if (heartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
				log.error(`Heartbeat failed ${heartbeatFailures} consecutive times, stopping live trading:`, msg);
				stopHeartbeat();

				// Attempt reconnection with exponential backoff
				if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
					heartbeatReconnecting = true;
					const backoffMs = Math.min(30_000, 5_000 * 2 ** reconnectAttempts);
					reconnectAttempts++;
					log.info(
						`Attempting heartbeat reconnection ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${backoffMs}ms`,
					);
					// Keep liveRunning flag true during reconnection so the
					// reconnect callback can actually proceed.
					reconnectTimer = setTimeout(async () => {
						if (client && isLiveRunning()) {
							log.info("Attempting to restart heartbeat...");
							const success = startHeartbeat();
							if (success) {
								log.info("Heartbeat reconnection successful");
								reconnectAttempts = 0;
							}
						}
					}, backoffMs);
				} else {
					// All reconnect attempts exhausted — NOW stop live trading
					heartbeatReconnecting = false;
					setLiveRunning(false);
					log.error("Max heartbeat reconnection attempts reached, stopping live trading");
				}
			} else {
				log.warn(`Heartbeat failed (${heartbeatFailures}/${MAX_HEARTBEAT_FAILURES}):`, msg);
			}
		}
	}, 5_000);
	log.info("Heartbeat started");
	return true;
}

export function stopHeartbeat(): void {
	const wasRunning = heartbeatTimer !== null;
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	heartbeatId = null;
	heartbeatFailures = 0;
	reconnectAttempts = 0;
	openGtdOrders.clear(); // Clear open order tracking
	heartbeatReconnecting = false;
	if (wasRunning) log.info("Heartbeat stopped");
}

/** Register a GTD order for heartbeat tracking (FOK orders should not be tracked) */
export function registerOpenGtdOrder(orderId: string): void {
	openGtdOrders.add(orderId);
	log.debug(`Registered GTD order ${orderId.slice(0, 12)}... (total open: ${openGtdOrders.size})`);
}

/** Unregister a GTD order (e.g., when filled, cancelled, or expired) */
export function unregisterOpenGtdOrder(orderId: string): void {
	const deleted = openGtdOrders.delete(orderId);
	if (deleted) {
		log.debug(`Unregistered GTD order ${orderId.slice(0, 12)}... (total open: ${openGtdOrders.size})`);
	}
}

/** Get count of currently open GTD orders */
export function getOpenGtdOrderCount(): number {
	return openGtdOrders.size;
}

/** Check if heartbeat is in reconnection — live trades should be blocked */
export function isHeartbeatReconnecting(): boolean {
	return heartbeatReconnecting;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return {};
}

function asSignalConfidence(signal: TradeSignal): number {
	const signalRecord = asRecord(signal);
	const confidenceValue = signalRecord.confidence;

	if (typeof confidenceValue === "number" && Number.isFinite(confidenceValue)) {
		return confidenceValue;
	}

	if (confidenceValue && typeof confidenceValue === "object") {
		const confidenceRecord = asRecord(confidenceValue);
		const scoreValue = confidenceRecord.score;
		if (typeof scoreValue === "number" && Number.isFinite(scoreValue)) {
			return scoreValue;
		}
	}

	return 0.5;
}

function asSignalRegime(signal: TradeSignal): string | null {
	const signalRecord = asRecord(signal);
	const regimeValue = signalRecord.regime;
	if (typeof regimeValue === "string" && regimeValue.length > 0) {
		return regimeValue;
	}
	return null;
}

function normalizedMarketPrice(price: number | null): number {
	if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price >= 1) {
		return 0.5;
	}
	return price;
}

function computeTradeSize(signal: TradeSignal, riskConfig: RiskConfig, balance: number): PositionSizeResult {
	const configuredMaxSize = Number(riskConfig.maxTradeSizeUsdc || 0);
	if (!Number.isFinite(configuredMaxSize) || configuredMaxSize <= 0) {
		return {
			size: 0,
			rawKelly: 0,
			adjustedKelly: 0,
			reason: "max_size_zero",
		};
	}

	const marketPrice =
		signal.side === "UP" ? normalizedMarketPrice(signal.marketUp) : normalizedMarketPrice(signal.marketDown);
	const winProbability = signal.side === "UP" ? signal.modelUp : signal.modelDown;
	const avgWinPayout = 1 - marketPrice;
	const avgLossPayout = marketPrice;

	const result = calculateKellyPositionSize({
		winProbability,
		avgWinPayout,
		avgLossPayout,
		bankroll: balance,
		maxSize: configuredMaxSize,
		confidence: asSignalConfidence(signal),
		regime: asSignalRegime(signal),
		side: signal.side,
	});

	log.info(
		`Kelly sizing ${signal.marketId} ${signal.side}: size=${result.size.toFixed(4)} raw=${result.rawKelly.toFixed(4)} adjusted=${result.adjustedKelly.toFixed(4)} reason=${result.reason}`,
	);

	return result;
}

function isApiCreds(value: unknown): value is ApiKeyCreds {
	const record = asRecord(value);
	return (
		typeof record.key === "string" &&
		record.key.length > 0 &&
		typeof record.secret === "string" &&
		record.secret.length > 0 &&
		typeof record.passphrase === "string" &&
		record.passphrase.length > 0
	);
}

// Restore daily state from SQLite or JSON
export function initTraderState(): void {
	if (PERSIST_BACKEND === "sqlite" || PERSIST_BACKEND === "dual") {
		try {
			const today = new Date().toDateString();
			const paperRow = statements.getDailyStats().get({ $date: today, $mode: "paper" }) as {
				pnl?: number;
				trades?: number;
			} | null;
			if (paperRow) {
				paperDailyState = { date: today, pnl: Number(paperRow.pnl ?? 0), trades: Number(paperRow.trades ?? 0) };
			}
			const liveRow = statements.getDailyStats().get({ $date: today, $mode: "live" }) as {
				pnl?: number;
				trades?: number;
			} | null;
			if (liveRow) {
				liveDailyState = { date: today, pnl: Number(liveRow.pnl ?? 0), trades: Number(liveRow.trades ?? 0) };
			}
		} catch (err) {
			log.warn("Failed to load daily state from SQLite:", err);
		}
	} else {
		try {
			const saved: DailyState = JSON.parse(fs.readFileSync(PAPER_DAILY_PATH, "utf8"));
			if (saved.date === new Date().toDateString()) paperDailyState = saved;
		} catch (err) {
			log.warn("Failed to load paper daily state from JSON:", err);
		}
		try {
			const saved: DailyState = JSON.parse(fs.readFileSync(LIVE_DAILY_PATH, "utf8"));
			if (saved.date === new Date().toDateString()) liveDailyState = saved;
		} catch (err) {
			log.warn("Failed to load live daily state from JSON:", err);
		}
	}
}
// Call at module scope for backward compat
initTraderState();

function saveDailyState(mode: "paper" | "live"): void {
	const dirPath = mode === "paper" ? "./data/paper" : "./data/live";
	const filePath = mode === "paper" ? PAPER_DAILY_PATH : LIVE_DAILY_PATH;
	const state = mode === "paper" ? paperDailyState : liveDailyState;

	if (PERSIST_BACKEND === "csv" || PERSIST_BACKEND === "dual") {
		fs.mkdirSync(dirPath, { recursive: true });
		fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
	}

	if (PERSIST_BACKEND === "dual" || PERSIST_BACKEND === "sqlite") {
		const existing = statements.getDailyStats().get({
			$date: state.date,
			$mode: mode,
		}) as { wins?: number | null; losses?: number | null } | null;

		statements.upsertDailyStats().run({
			$date: state.date,
			$mode: mode,
			$pnl: state.pnl,
			$trades: state.trades,
			$wins: Number(existing?.wins ?? 0),
			$losses: Number(existing?.losses ?? 0),
		});
	}
}

async function createProvider(): Promise<providers.JsonRpcProvider | null> {
	for (const url of RPC_URLS) {
		try {
			const p = new providers.JsonRpcProvider(url);
			await p.getNetwork();
			log.info("Connected to Polygon RPC:", url);
			return p;
		} catch {
			log.info("RPC failed:", url);
		}
	}
	return null;
}

export async function initTrader(): Promise<void> {
	log.info("initTrader() is deprecated - use connectWallet() instead");
}

export async function connectWallet(privateKey: string): Promise<{ address: string }> {
	if (!privateKey || privateKey.length !== 64) {
		throw new Error("Private key must be 64 hex characters (without 0x prefix)");
	}

	wallet = new Wallet(`0x${privateKey}`);
	log.info("Wallet connected:", wallet.address);

	const provider = await createProvider();
	if (provider && wallet) {
		wallet = wallet.connect(provider);
	}
	const address = wallet.address;

	let savedCreds: unknown = null;
	try {
		if (fs.existsSync(CREDS_PATH)) {
			savedCreds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
		}
	} catch (err) {
		log.warn("Failed to load saved API credentials:", err);
	}

	await initClient(savedCreds);
	return { address };
}

export function disconnectWallet(): void {
	stopHeartbeat();
	wallet = null;
	client = null;
	log.info("Wallet disconnected");
}

async function initClient(savedCreds: unknown): Promise<void> {
	if (!wallet) return;

	try {
		const signatureType = 0;

		log.info("EOA mode:", wallet.address);

		let creds: ApiKeyCreds | null = isApiCreds(savedCreds) ? savedCreds : null;

		if (!creds) {
			log.info("Deriving API credentials from EOA...");
			try {
				const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
				creds = await tempClient.deriveApiKey();
				if (isApiCreds(creds)) {
					fs.mkdirSync("./data", { recursive: true });
					fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
					// P0-4: Restrict file permissions to owner-only read/write
					try {
						fs.chmodSync(CREDS_PATH, 0o600);
					} catch {
						/* ignore on Windows */
					}
					log.info("Derived and saved creds, key:", creds.key);
				}
			} catch (deriveErr: unknown) {
				const msg = deriveErr instanceof Error ? deriveErr.message : String(deriveErr);
				log.error("Derive failed:", msg);
			}
		}

		if (!isApiCreds(creds)) {
			log.error("No API credentials available");
			client = null;
			return;
		}

		client = new ClobClient(HOST, CHAIN_ID, wallet, creds, signatureType);
		log.info("Client ready (key:", creds.key, ")");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Failed to initialize client:", msg);
		client = null;
	}
}

function canTrade(riskConfig: RiskConfig, mode: "paper" | "live"): boolean {
	if (mode === "live") {
		if (!client) {
			log.error("Client not initialized");
			return false;
		}

		if (!wallet) {
			log.error("No wallet available");
			return false;
		}

		if (heartbeatReconnecting) {
			log.warn("Heartbeat reconnecting — blocking live trade");
			return false;
		}
	}

	// Reset daily state before checking limits — otherwise yesterday's exceeded
	// limit would block the first trade of a new day
	const today = new Date().toDateString();
	const daily = mode === "paper" ? paperDailyState : liveDailyState;
	if (daily.date !== today) {
		if (mode === "paper") {
			paperDailyState = { date: today, pnl: 0, trades: 0 };
		} else {
			liveDailyState = { date: today, pnl: 0, trades: 0 };
		}
		saveDailyState(mode);
	}

	const currentDaily = mode === "paper" ? paperDailyState : liveDailyState;
	if (currentDaily.pnl <= -Number(riskConfig.dailyMaxLossUsdc || 0)) {
		log.error(`${mode} daily ${mode === "live" ? "spending cap" : "loss limit"} reached`);
		return false;
	}

	return true;
}

function tradeLogPath(marketId: string | null | undefined, mode: "paper" | "live"): string {
	const id = String(marketId || "GLOBAL").toUpperCase();
	return `./data/${mode}/trades-${id}.csv`;
}

/**
 * Log trade to local storage (CSV and SQLite).
 *
 * IMPORTANT: This is for LOGGING ONLY.
 *
 * - Paper mode: Local DB is the primary data source
 * - Live mode: Local DB is ONLY for logging and reconciliation debugging.
 *              All live stats (win rate, PnL, etc.) are fetched from on-chain data
 *              via getLiveStats() -> liveStats.ts (CLOB API).
 */
function logTrade(
	trade: {
		timestamp?: string;
		market?: string;
		side: string;
		amount: number;
		price: number;
		orderId?: string;
		status: string;
	},
	marketId: string | null | undefined,
	mode: "paper" | "live",
): void {
	const header = ["timestamp", "market", "side", "amount", "price", "orderId", "status", "mode"];
	const timestamp = trade.timestamp ?? new Date().toISOString();
	const row = [
		timestamp,
		trade.market || "",
		trade.side,
		trade.amount,
		trade.price,
		trade.orderId || "",
		trade.status,
		mode,
	];

	const line = `${row.join(",")}\n`;

	if (PERSIST_BACKEND === "csv" || PERSIST_BACKEND === "dual") {
		const dirPath = `./data/${mode}`;
		if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

		const logPath = tradeLogPath(marketId, mode);
		if (!fs.existsSync(logPath)) {
			fs.writeFileSync(logPath, `${header.join(",")}\n`);
		}

		fs.appendFileSync(logPath, line);
	}

	if (PERSIST_BACKEND === "dual" || PERSIST_BACKEND === "sqlite") {
		statements.insertTrade().run({
			$timestamp: timestamp,
			$market: marketId ?? trade.market ?? "",
			$side: trade.side,
			$amount: trade.amount,
			$price: trade.price,
			$orderId: trade.orderId ?? "",
			$status: trade.status,
			$mode: mode,
			$pnl: null,
			$won: null,
		});
	}
}

export async function executeTrade(
	signal: TradeSignal,
	options: { marketConfig?: MarketConfig | null; riskConfig: RiskConfig },
	mode: "paper" | "live" = "paper",
): Promise<TradeResult> {
	const { marketConfig = null, riskConfig } = options;

	if (mode === "paper") {
		const { side, marketUp, marketDown, marketSlug } = signal;
		const paperBalance = getPaperBalance().current;
		const paperSizing = computeTradeSize(signal, riskConfig, paperBalance);
		const tradeSize = paperSizing.size;
		if (tradeSize <= 0) {
			log.warn(`Skipping paper trade for ${signal.marketId}: ${paperSizing.reason}`);
			return { success: false, reason: "size_zero" };
		}
		const isUp = side === "UP";
		const marketPrice = isUp ? parseFloat(String(marketUp)) : parseFloat(String(marketDown));
		// P0-1: Guard against NaN/Infinity propagation into trades
		if (!Number.isFinite(marketPrice)) {
			log.warn(`Non-finite market price for ${signal.marketId}, aborting paper trade`);
			return { success: false, reason: "price_not_finite" };
		}
		const limitDiscount = Number(riskConfig.limitDiscount ?? 0.1);
		const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
		const price = Math.round(priceRaw * 100) / 100;
		const arbitrageDetected = signal.arbitrageDetected === true;
		const arbitrageDirection = signal.arbitrageDirection ?? (side === "UP" ? "BUY_UP" : "BUY_DOWN");
		const arbitrageSpread =
			typeof signal.arbitrageSpread === "number" && Number.isFinite(signal.arbitrageSpread)
				? signal.arbitrageSpread
				: null;
		const arbitrageStatusMarker =
			arbitrageDetected && arbitrageSpread !== null
				? `ARB:${arbitrageDirection}:spread=${arbitrageSpread.toFixed(4)}`
				: arbitrageDetected
					? `ARB:${arbitrageDirection}:spread=n/a`
					: null;

		if (price < 0.02 || price > 0.98) {
			log.info(`Price ${price} out of tradeable range`);
			return { success: false, reason: "price_out_of_range" };
		}

		const timing = getCandleWindowTiming(15);
		const paperId = addPaperTrade({
			marketId: signal.marketId,
			windowStartMs: timing.startMs,
			side: signal.side,
			price,
			size: tradeSize,
			priceToBeat: signal.priceToBeat ?? 0,
			currentPriceAtEntry: signal.currentPrice,
			timestamp: new Date().toISOString(),
		});

		storeSignalMetadata(paperId, {
			edge: Math.max(Number(signal.edgeUp ?? 0), Number(signal.edgeDown ?? 0)),
			confidence: signal.confidence ?? 0.5,
			phase: signal.phase,
			regime: signal.regime ?? null,
			volatility15m: Number(signal.volatility15m ?? 0),
			modelUp: Number(signal.modelUp ?? 0.5),
			orderbookImbalance: signal.orderbookImbalance ?? null,
			rsi: null,
			vwapSlope: null,
		});

		if (arbitrageDetected) {
			log.info(
				`[ARBITRAGE][PAPER] ${signal.marketId} ${arbitrageDirection} spread=${arbitrageSpread?.toFixed(4) ?? "n/a"}`,
			);
		}

		log.info(`Simulated fill: ${side} at ${price}¢ | ${marketSlug} (${paperId})`);

		const paperTradeTimestamp = new Date().toISOString();

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: tradeSize,
				price,
				orderId: paperId,
				status: arbitrageStatusMarker === null ? "paper_filled" : `paper_filled|${arbitrageStatusMarker}`,
			},
			signal.marketId || marketConfig?.id,
			mode,
		);

		emitTradeExecuted({
			marketId: signal.marketId,
			mode,
			side,
			price,
			size: tradeSize,
			timestamp: paperTradeTimestamp,
			orderId: paperId,
			status: "paper_filled",
		});

		paperDailyState.trades++;
		saveDailyState("paper");

		return {
			success: true,
			order: { orderID: paperId, status: "paper_filled" },
		};
	}

	if (!canTrade(riskConfig, "live")) {
		return { success: false, reason: "trading_disabled" };
	}

	const liveSizing = computeTradeSize(signal, riskConfig, Number(riskConfig.maxTradeSizeUsdc || 0) * 10);
	const tradeSize = liveSizing.size;
	if (tradeSize <= 0) {
		log.warn(`Skipping live trade for ${signal.marketId}: ${liveSizing.reason}`);
		return { success: false, reason: "size_zero" };
	}

	const { side, marketUp, marketDown, marketSlug, tokens } = signal;

	const isUp = side === "UP";
	const marketPrice = isUp ? parseFloat(String(marketUp)) : parseFloat(String(marketDown));
	// P0-1: Guard against NaN/Infinity propagation into live trades
	if (!Number.isFinite(marketPrice)) {
		log.warn(`Non-finite market price for ${signal.marketId}, aborting live trade`);
		return { success: false, reason: "price_not_finite" };
	}
	const limitDiscount = Number(riskConfig.limitDiscount ?? 0.1);
	const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
	const price = Math.round(priceRaw * 100) / 100;
	const tokenId = tokens ? (isUp ? tokens.upTokenId : tokens.downTokenId) : null;

	if (!tokenId) {
		log.error("No token ID available for", side);
		return { success: false, reason: "no_token_id" };
	}

	if (price < 0.02 || price > 0.98) {
		log.info(`Price ${price} out of tradeable range`);
		return { success: false, reason: "price_out_of_range" };
	}

	const oppositePrice = isUp ? parseFloat(String(marketDown)) : parseFloat(String(marketUp));
	if (price > 0.95 && oppositePrice < 0.05) {
		log.info("Market too confident, skipping");
		return { success: false, reason: "market_too_confident" };
	}

	log.info(`Executing ${side} trade: market ${marketPrice}¢ -> limit ${price}¢ (token: ${tokenId})`);

	if (!client) {
		return { success: false, reason: "trading_disabled" };
	}

	try {
		const negRisk = false;
		const isLatePhase = signal.phase === "LATE";
		const isHighConfidence = signal.strength === "STRONG" || signal.strength === "GOOD";

		let result: unknown;

		if (isLatePhase && isHighConfidence) {
			// LATE phase + high confidence → FOK for immediate fill
			log.info(`Posting FOK market order: ${side} amount=${tradeSize} worst-price=${price} (token: ${tokenId})`);
			result = await client.createAndPostMarketOrder(
				{
					tokenID: tokenId,
					side: Side.BUY,
					amount: tradeSize,
					price, // worst-price limit (slippage protection)
				},
				{ negRisk },
				OrderType.FOK,
			);
			// FOK is fill-or-kill: if no liquidity at worst-price, order is rejected.
			// Check for empty result indicating rejection.
			const fokResult = asRecord(result);
			if (!fokResult.orderID && !fokResult.id) {
				log.warn(`FOK order rejected (no fill): ${side} amount=${tradeSize} worst-price=${price}`);
				return { success: false, reason: "fok_no_fill" };
			}
		} else {
			// EARLY/MID phase → GTD with post-only for maker rebate.
			// postOnly guarantees maker status; if order would take, it is rejected.
			// No taker fallback — conservative: skip rather than pay taker fees.
			const timing = getCandleWindowTiming(15);
			// Dynamic expiration buffer: minimum 10s, max 50% of remaining time
			// This ensures orders don't expire too early in LATE phase
			const bufferMs = Math.max(10_000, Math.min(timing.remainingMs / 2, 60_000));
			const expiration = Math.floor((timing.endMs - bufferMs) / 1000);
			const nowSec = Math.floor(Date.now() / 1000);
			if (expiration <= nowSec) {
				log.warn(`GTD expiration in the past (${expiration} <= ${nowSec}), skipping trade`);
				return { success: false, reason: "gtd_expiration_invalid" };
			}

			const orderArgs = {
				tokenID: tokenId,
				price,
				size: tradeSize,
				side: Side.BUY,
				expiration,
			};

			log.info(
				`Posting GTD+postOnly order: ${side} size=${tradeSize} price=${price} exp=${expiration}s (token: ${tokenId})`,
			);
			result = await client.createAndPostOrder(
				orderArgs,
				{ negRisk }, // tickSize auto-resolved by SDK
				OrderType.GTD,
				false, // deferExec
				true, // postOnly — guarantee maker, get 20% fee rebate
			);
		}
		const resultObj = asRecord(result);
		const resultOrderId = typeof resultObj.orderID === "string" ? resultObj.orderID : undefined;
		const resultId = typeof resultObj.id === "string" ? resultObj.id : undefined;
		const resultStatus = typeof resultObj.status === "string" ? resultObj.status : undefined;

		log.info("Order result:", JSON.stringify(result));
		const liveTradeTimestamp = new Date().toISOString();

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: tradeSize,
				price,
				orderId: resultOrderId || resultId || "unknown",
				status: resultStatus || "placed",
			},
			signal.marketId || marketConfig?.id,
			mode,
		);

		if (resultOrderId || resultId) {
			const finalOrderId = resultOrderId || resultId || "unknown";
			emitTradeExecuted({
				marketId: signal.marketId,
				mode,
				side,
				price,
				size: tradeSize,
				timestamp: liveTradeTimestamp,
				orderId: finalOrderId,
				status: resultStatus || "placed",
			});
			liveDailyState.trades++;
			saveDailyState("live");

			// Clear stats cache after new trade
			clearLiveStatsCache();

			if (tokenId && tokenId.length > 0) {
				try {
					onchainStatements.upsertKnownCtfToken().run({
						$tokenId: tokenId,
						$marketId: signal.marketId ?? "",
						$side: side,
						$conditionId: null,
					});
					enrichPosition(tokenId, signal.marketId ?? "", side);
				} catch (err) {
					log.warn("Failed to persist known CTF token:", err);
				}
			}

			// Start heartbeat and track order ONLY for GTD orders
			// FOK orders fill immediately and don't need heartbeat
			if (!isLatePhase || !isHighConfidence) {
				registerOpenGtdOrder(finalOrderId);
				startHeartbeat();
			}

			// Conservative PnL: debit full trade cost as worst-case loss.
			// Daily loss limit in canTrade() now acts as a spending cap for live mode.
			const liveTradeSize = tradeSize;
			updatePnl(-liveTradeSize * price, "live");

			// Track for settlement at window boundary
			if (signal.priceToBeat && signal.priceToBeat > 0) {
				const liveTiming = getCandleWindowTiming(15);
				pendingLiveTrades.push({
					orderId: finalOrderId,
					marketId: signal.marketId ?? "",
					side,
					buyPrice: price,
					size: liveTradeSize,
					priceToBeat: signal.priceToBeat,
					windowStartMs: liveTiming.startMs,
				});
			}
		}

		const isGtdOrder = !isLatePhase || !isHighConfidence;
		return {
			success: !!(resultOrderId || resultId),
			order: result,
			orderId: resultOrderId || resultId,
			tradePrice: price,
			isGtdOrder,
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Order error:", msg);

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: tradeSize,
				price,
				orderId: "error",
				status: `error: ${msg}`,
			},
			signal.marketId || marketConfig?.id,
			mode,
		);

		return {
			success: false,
			error: msg,
		};
	}
}

export function getWalletAddress(): string | null {
	return wallet?.address || null;
}

export function getWallet(): Wallet | null {
	return wallet;
}

export function getClientStatus(): {
	walletLoaded: boolean;
	clientReady: boolean;
	walletAddress: string | undefined;
} {
	return {
		walletLoaded: !!wallet,
		clientReady: !!client,
		walletAddress: wallet?.address,
	};
}

export function getConfig(): {
	paperRisk: RiskConfig;
	liveRisk: RiskConfig;
	strategy: typeof CONFIG.strategy;
} {
	return {
		paperRisk: CONFIG.paperRisk,
		liveRisk: CONFIG.liveRisk,
		strategy: CONFIG.strategy,
	};
}

export function getDailyState(): DailyState {
	return { ...paperDailyState };
}

export function getPaperDailyState(): DailyState {
	return { ...paperDailyState };
}

export function getLiveDailyState(): DailyState {
	return { ...liveDailyState };
}

export function updatePnl(amount: number, mode: "paper" | "live"): void {
	if (mode === "paper") {
		paperDailyState.pnl += amount;
	} else {
		liveDailyState.pnl += amount;
	}
	saveDailyState(mode);
}

/**
 * Resolve pending live trades for a completed window.
 * Mirrors paper trade settlement logic: compare finalPrice vs priceToBeat,
 * determine win/loss, calculate PnL, and update the DB.
 * Returns the number of trades resolved.
 */
export function resolveLiveTrades(windowStartMs: number, finalPrices: Map<string, number>): number {
	let resolved = 0;
	const remaining: PendingLiveTrade[] = [];

	for (const trade of pendingLiveTrades) {
		if (trade.windowStartMs !== windowStartMs) {
			remaining.push(trade);
			continue;
		}

		const finalPrice = finalPrices.get(trade.marketId);
		if (finalPrice === undefined || trade.priceToBeat <= 0) {
			remaining.push(trade);
			continue;
		}

		// Polymarket rule: price === PTB → DOWN wins
		const upWon = finalPrice > trade.priceToBeat;
		const downWon = finalPrice <= trade.priceToBeat;
		const won = trade.side === "UP" ? upWon : downWon;
		const pnl = won ? trade.size * (1 - trade.buyPrice) : -(trade.size * trade.buyPrice);

		try {
			statements.updateTradeOutcome().run({
				$pnl: pnl,
				$won: won ? 1 : 0,
				$orderId: trade.orderId,
				$mode: "live",
			});
		} catch (err) {
			log.warn(`Failed to update trade outcome for ${trade.orderId}:`, err);
		}

		// Correct daily PnL: at trade time we debited worst-case (-size*price).
		// If won, actual PnL is +size*(1-price). Correction = actual - worstCase = size.
		if (won) {
			updatePnl(trade.size, "live");
		}

		log.info(
			`Live settle: ${trade.marketId} ${trade.side} ${won ? "WON" : "LOST"} | PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} | final=${finalPrice.toFixed(2)} ptb=${trade.priceToBeat.toFixed(2)}`,
		);
		resolved++;
	}

	pendingLiveTrades.length = 0;
	pendingLiveTrades.push(...remaining);
	return resolved;
}

/**
 * Get live trading stats from on-chain data.
 *
 * This function now fetches stats from Polymarket CLOB API (chain data)
 * instead of local SQLite database. Local DB is used only for logging.
 *
 * @deprecated Use getLiveStatsFromChain() directly for more details
 */
export async function getLiveStats(): Promise<{
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}> {
	if (!client) {
		// Client not initialized is expected when in paper mode or before wallet connection
		log.debug("Cannot get live stats: client not initialized");
		return { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, totalPnl: 0 };
	}

	try {
		return await getLiveStatsLegacy(client);
	} catch (err) {
		log.error("Failed to get live stats from chain:", err);
		return { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, totalPnl: 0 };
	}
}

export function getLiveTodayStats(): { pnl: number; trades: number; limit: number } {
	return {
		pnl: liveDailyState.pnl,
		trades: liveDailyState.trades,
		limit: CONFIG.liveRisk.dailyMaxLossUsdc,
	};
}
