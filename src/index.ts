import fs from "node:fs";
import readline from "node:readline";
import { startApiServer } from "./api.ts";
import { CONFIG } from "./config.ts";
import { fetchKlines, fetchLastPrice } from "./data/binance.ts";
import { startMultiBinanceTradeStream } from "./data/binanceWs.ts";
import { fetchChainlinkPrice } from "./data/chainlink.ts";
import { startChainlinkPriceStream } from "./data/chainlinkWs.ts";
import {
	fetchClobPrice,
	fetchLiveEventsBySeriesId,
	fetchMarketBySlug,
	fetchOrderBook,
	flattenEventMarkets,
	pickLatestLiveMarket,
	summarizeOrderBook,
} from "./data/polymarket.ts";
import type { ClobWsHandle } from "./data/polymarketClobWs.ts";
import { startClobMarketWs } from "./data/polymarketClobWs.ts";
import { startMultiPolymarketPriceStream } from "./data/polymarketLiveWs.ts";
import { PERSIST_BACKEND, statements } from "./db.ts";
import { computeEdge, decide } from "./engines/edge.ts";
import {
	applyAdaptiveTimeDecay,
	blendProbabilities,
	computeRealizedVolatility,
	computeVolatilityImpliedProb,
	scoreDirection,
} from "./engines/probability.ts";
import { detectRegime } from "./engines/regime.ts";
import { computeHeikenAshi, countConsecutive } from "./indicators/heikenAshi.ts";
import { computeMacd } from "./indicators/macd.ts";
import { computeRsi, slopeLast } from "./indicators/rsi.ts";
import { computeVwapSeries } from "./indicators/vwap.ts";
import { createLogger } from "./logger.ts";
import { getActiveMarkets } from "./markets.ts";
import { OrderManager, type TrackedOrder } from "./orderManager.ts";
import { canAffordTradeWithStopCheck, getPaperStats, getPendingPaperTrades, resolvePaperTrades } from "./paperStats.ts";
import { redeemAll } from "./redeemer.ts";
import {
	clearLivePending,
	clearPaperPending,
	emitSignalNew,
	emitStateSnapshot,
	getUpdatedAt,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
	setLiveRunning,
	setPaperRunning,
	updateMarkets,
} from "./state.ts";
import { shouldTakeTrade } from "./strategyRefinement.ts";
import {
	executeTrade,
	getClientStatus,
	getWallet,
	registerOpenGtdOrder,
	startHeartbeat,
	stopHeartbeat,
	unregisterOpenGtdOrder,
	updatePnl,
} from "./trader.ts";
import type {
	Candle,
	CandleWindowTiming,
	MacdResult,
	MarketConfig,
	MarketSnapshot,
	OrderBookSummary,
	OrderTracker,
	PolymarketSnapshot,
	PriceTick,
	TradeDecision,
	TradeSignal,
	WsStreamHandle,
} from "./types.ts";
import { appendCsvRow, formatNumber, getCandleWindowTiming, sleep } from "./utils.ts";

const log = createLogger("bot");

const clobCircuitBreaker = {
	failures: 0,
	openUntil: 0,
	maxFailures: 5,
	cooldownMs: 60_000,
	isOpen(): boolean {
		if (this.failures < this.maxFailures) return false;
		return Date.now() < this.openUntil;
	},
	recordFailure(): void {
		this.failures++;
		if (this.failures >= this.maxFailures) {
			this.openUntil = Date.now() + this.cooldownMs;
			log.warn(`CLOB circuit breaker OPEN - ${this.failures} consecutive failures, cooldown ${this.cooldownMs}ms`);
		}
	},
	recordSuccess(): void {
		if (this.failures > 0) log.info(`CLOB circuit breaker reset after ${this.failures} failures`);
		this.failures = 0;
		this.openUntil = 0;
	},
};

interface ProcessMarketParams {
	market: MarketConfig;
	timing: CandleWindowTiming;
	streams: {
		binance: WsStreamHandle;
		polymarket: WsStreamHandle;
		chainlink: Map<string, WsStreamHandle>;
	};
	state: MarketState;
	// orderTracker removed from processMarket — only used in main loop
}

interface MarketState {
	prevSpotPrice: number | null;
	prevCurrentPrice: number | null;
	priceToBeatState: {
		slug: string | null;
		value: number | null;
		setAtMs: number | null;
	};
}

interface ProcessMarketResult {
	ok: boolean;
	market: MarketConfig;
	error?: string;
	rec?: TradeDecision;
	consec?: { color: string | null; count: number };
	rsiNow?: number | null;
	macd?: MacdResult | null;
	vwapSlope?: number | null;
	timeLeftMin?: number | null;
	currentPrice?: number | null;
	spotPrice?: number | null;
	priceToBeat?: number | null;
	volatility15m?: number | null;
	blendSource?: string;
	volImpliedUp?: number | null;
	binanceChainlinkDelta?: number | null;
	orderbookImbalance?: number | null;
	orderbook?: { up: OrderBookSummary | null; down: OrderBookSummary | null };
	marketUp?: number | null;
	marketDown?: number | null;
	rawSum?: number | null;
	arbitrage?: boolean;
	pLong?: string;
	pShort?: string;
	predictNarrative?: string;
	actionText?: string;
	marketSlug?: string;
	signalPayload?: TradeSignal | null;
}

interface SimpleOrderTracker {
	orders: Map<string, number>;
	lastTradeMs: number;
	cooldownMs: number;
	keyFor(marketId: string, windowSlug: string): string;
	hasOrder(marketId: string, windowSlug: string): boolean;
	totalActive(): number;
	record(marketId: string, windowSlug: string): void;
	prune(): void;
	onCooldown(): boolean;
}

interface PanelData {
	id: string;
	lines: string[];
}

interface ANSIMap {
	reset: string;
	red: string;
	green: string;
	gray: string;
	yellow: string;
	white: string;
}

type AnyRecord = Record<string, unknown>;

const ANSI: ANSIMap = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	gray: "\x1b[90m",
	yellow: "\x1b[33m",
	white: "\x1b[97m",
};

function stripAnsi(s: unknown): string {
	const esc = String.fromCharCode(27);
	return String(s ?? "")
		.replaceAll(esc, "")
		.replace(/\[[0-9;]*m/g, "");
}

function padAnsi(s: unknown, width: number): string {
	const raw = String(s ?? "");
	const len = stripAnsi(raw).length;
	if (len >= width) return raw;
	return raw + " ".repeat(width - len);
}

function screenWidth(): number {
	const w = Number(process.stdout?.columns);
	return Number.isFinite(w) && w >= 80 ? w : 120;
}

function renderScreen(text: string): void {
	try {
		readline.cursorTo(process.stdout, 0, 0);
		readline.clearScreenDown(process.stdout);
	} catch (err) {
		log.debug("renderScreen cursor reset failed:", err);
	}
	process.stdout.write(text);
}

function colorForAction(action: TradeDecision["action"] | undefined, side: TradeDecision["side"] | undefined): string {
	if (action === "ENTER" && side === "UP") return ANSI.green;
	if (action === "ENTER" && side === "DOWN") return ANSI.red;
	return ANSI.gray;
}

function getBtcSession(now: Date = new Date()): string {
	const h = now.getUTCHours();
	const inAsia = h >= 0 && h < 8;
	const inEurope = h >= 7 && h < 16;
	const inUs = h >= 13 && h < 22;
	if (inEurope && inUs) return "Europe/US overlap";
	if (inAsia && inEurope) return "Asia/Europe overlap";
	if (inAsia) return "Asia";
	if (inEurope) return "Europe";
	if (inUs) return "US";
	return "Off-hours";
}

function fmtEtTime(now: Date = new Date()): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone: "America/New_York",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(now);
	} catch {
		return "-";
	}
}

function fmtTimeLeft(mins: number | null | undefined): string {
	if (!Number.isFinite(Number(mins))) return "--:--";
	const totalSeconds = Math.max(0, Math.floor(Number(mins) * 60));
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function countVwapCrosses(closes: number[], vwapSeries: number[], lookback: number): number | null {
	if (closes.length < lookback || vwapSeries.length < lookback) return null;
	let crosses = 0;
	for (let i = closes.length - lookback + 1; i < closes.length; i += 1) {
		const prevClose = closes[i - 1];
		const prevVwap = vwapSeries[i - 1];
		const curClose = closes[i];
		const curVwap = vwapSeries[i];
		if (prevClose === undefined || prevVwap === undefined || curClose === undefined || curVwap === undefined) continue;
		const prev = prevClose - prevVwap;
		const cur = curClose - curVwap;
		if (prev === 0) continue;
		if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) crosses += 1;
	}
	return crosses;
}

function parsePriceToBeat(market: unknown): number | null {
	const marketObj = market as AnyRecord | null;
	const text = String(marketObj?.question ?? marketObj?.title ?? "");
	if (!text) return null;
	const m = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
	if (!m || !m[1]) return null;
	const raw = m[1].replace(/,/g, "");
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

function extractNumericFromMarket(market: unknown): number | null {
	const directKeys = [
		"priceToBeat",
		"price_to_beat",
		"strikePrice",
		"strike_price",
		"strike",
		"threshold",
		"thresholdPrice",
		"threshold_price",
		"targetPrice",
		"target_price",
		"referencePrice",
		"reference_price",
	];

	const marketObj = market as AnyRecord | null;
	for (const k of directKeys) {
		const v = marketObj?.[k];
		const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
		if (Number.isFinite(n)) return n;
	}

	const seen = new Set<unknown>();
	const stack: Array<{ obj: unknown; depth: number }> = [{ obj: market, depth: 0 }];
	while (stack.length) {
		const item = stack.pop();
		if (!item) continue;
		const { obj, depth } = item;
		if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 6) continue;
		seen.add(obj);
		const entries = Array.isArray(obj) ? Array.from(obj.entries()) : Object.entries(obj as Record<string, unknown>);
		for (const [key, value] of entries) {
			const k = String(key).toLowerCase();
			if (value && typeof value === "object") {
				stack.push({ obj: value, depth: depth + 1 });
				continue;
			}
			if (!/(price|strike|threshold|target|beat)/i.test(k)) continue;
			const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
			if (Number.isFinite(n) && n > 1000 && n < 2_000_000) return n;
		}
	}

	return null;
}

function priceToBeatFromPolymarketMarket(market: unknown): number | null {
	const n = extractNumericFromMarket(market);
	if (n !== null) return n;
	return parsePriceToBeat(market);
}

function parseJsonArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value !== "string") return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

const polymarketMarketCache: Map<string, { market: unknown; fetchedAtMs: number }> = new Map();

async function resolveCurrent15mMarket(marketDef: MarketConfig): Promise<unknown> {
	const customSlug = marketDef.id === "BTC" ? CONFIG.polymarket.marketSlug : "";
	if (customSlug) {
		const bySlug = await fetchMarketBySlug(customSlug);
		return bySlug;
	}

	if (!CONFIG.polymarket.autoSelectLatest) return null;

	const now = Date.now();
	const cached = polymarketMarketCache.get(marketDef.id);
	if (cached?.market && now - cached.fetchedAtMs < CONFIG.pollIntervalMs) {
		return cached.market;
	}

	const events = await fetchLiveEventsBySeriesId({
		seriesId: marketDef.polymarket.seriesId,
		limit: 25,
	});
	const markets = flattenEventMarkets(events);
	const picked = pickLatestLiveMarket(markets);
	polymarketMarketCache.set(marketDef.id, { market: picked, fetchedAtMs: now });
	return picked;
}

async function fetchPolymarketSnapshot(marketDef: MarketConfig): Promise<PolymarketSnapshot> {
	const market = await resolveCurrent15mMarket(marketDef);
	if (!market) return { ok: false, reason: "market_not_found" };

	const marketObj = market as AnyRecord;
	const outcomes = parseJsonArray(marketObj.outcomes);
	const outcomePrices = parseJsonArray(marketObj.outcomePrices);
	const clobTokenIds = parseJsonArray(marketObj.clobTokenIds);

	let upTokenId: string | null = null;
	let downTokenId: string | null = null;
	for (let i = 0; i < outcomes.length; i += 1) {
		const label = String(outcomes[i] ?? "").toLowerCase();
		const tokenRaw = clobTokenIds[i];
		const tokenId = tokenRaw ? String(tokenRaw) : null;
		if (!tokenId) continue;
		if (label === CONFIG.polymarket.upOutcomeLabel.toLowerCase()) upTokenId = tokenId;
		if (label === CONFIG.polymarket.downOutcomeLabel.toLowerCase()) downTokenId = tokenId;
	}

	const upIndex = outcomes.findIndex(
		(x) => String(x ?? "").toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase(),
	);
	const downIndex = outcomes.findIndex(
		(x) => String(x ?? "").toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase(),
	);
	const gammaYes = upIndex >= 0 ? Number(outcomePrices[upIndex]) : null;
	const gammaNo = downIndex >= 0 ? Number(outcomePrices[downIndex]) : null;

	if (!upTokenId || !downTokenId) {
		return {
			ok: false,
			reason: "missing_token_ids",
			market,
			outcomes: outcomes.map((x) => String(x)),
			clobTokenIds: clobTokenIds.map((x) => String(x)),
			outcomePrices: outcomePrices.map((x) => String(x)),
		};
	}

	let upBuy: number | null = null;
	let downBuy: number | null = null;
	let upBookSummary: OrderBookSummary = {
		bestBid: null,
		bestAsk: null,
		spread: null,
		bidLiquidity: null,
		askLiquidity: null,
	};
	let downBookSummary: OrderBookSummary = {
		bestBid: null,
		bestAsk: null,
		spread: null,
		bidLiquidity: null,
		askLiquidity: null,
	};

	if (clobCircuitBreaker.isOpen()) {
		log.warn(
			`CLOB fetch skipped for ${marketDef.id} - circuit breaker open until ${new Date(clobCircuitBreaker.openUntil).toISOString()}`,
		);
		upBookSummary = {
			bestBid: Number(marketObj.bestBid) || null,
			bestAsk: Number(marketObj.bestAsk) || null,
			spread: Number(marketObj.spread) || null,
			bidLiquidity: null,
			askLiquidity: null,
		};
		downBookSummary = {
			bestBid: null,
			bestAsk: null,
			spread: Number(marketObj.spread) || null,
			bidLiquidity: null,
			askLiquidity: null,
		};
	} else {
		try {
			const [yesBuy, noBuy, upBook, downBook] = await Promise.all([
				fetchClobPrice({ tokenId: upTokenId, side: "buy" }),
				fetchClobPrice({ tokenId: downTokenId, side: "buy" }),
				fetchOrderBook({ tokenId: upTokenId }),
				fetchOrderBook({ tokenId: downTokenId }),
			]);
			upBuy = yesBuy;
			downBuy = noBuy;
			upBookSummary = summarizeOrderBook(upBook);
			downBookSummary = summarizeOrderBook(downBook);
			clobCircuitBreaker.recordSuccess();
		} catch (err) {
			clobCircuitBreaker.recordFailure();
			log.warn(`CLOB fetch failed for ${marketDef.id}:`, err);
			upBookSummary = {
				bestBid: Number(marketObj.bestBid) || null,
				bestAsk: Number(marketObj.bestAsk) || null,
				spread: Number(marketObj.spread) || null,
				bidLiquidity: null,
				askLiquidity: null,
			};
			downBookSummary = {
				bestBid: null,
				bestAsk: null,
				spread: Number(marketObj.spread) || null,
				bidLiquidity: null,
				askLiquidity: null,
			};
		}
	}

	return {
		ok: true,
		market,
		tokens: { upTokenId, downTokenId },
		prices: { up: upBuy ?? gammaYes, down: downBuy ?? gammaNo },
		orderbook: { up: upBookSummary, down: downBookSummary },
	};
}

function compactMacdLabel(macd: MacdResult | null | undefined): string {
	if (!macd) return "flat";
	if (macd.hist < 0) return macd.histDelta !== null && macd.histDelta < 0 ? "bearish" : "red";
	if (macd.hist > 0) return macd.histDelta !== null && macd.histDelta > 0 ? "bullish" : "green";
	return "flat";
}

function buildPanelData(result: ProcessMarketResult): PanelData {
	if (!result?.ok) {
		return {
			id: result?.market?.id || "-",
			lines: [
				`${ANSI.gray}Predict: --% / --%${ANSI.reset}`,
				`${ANSI.gray}HA: -   RSI: -${ANSI.reset}`,
				`${ANSI.gray}MACD: -   VWAP: -${ANSI.reset}`,
				`${ANSI.gray}⏱ --:--  Price: -${ANSI.reset}`,
				`${ANSI.gray}UP - / DOWN -${ANSI.reset}`,
				`${ANSI.gray}NO DATA${ANSI.reset}`,
			],
		};
	}

	const longColor = result.predictNarrative === "LONG" ? ANSI.green : ANSI.gray;
	const shortColor = result.predictNarrative === "SHORT" ? ANSI.red : ANSI.gray;
	const actionColor = colorForAction(result.rec?.action, result.rec?.side);

	const vwapArrow =
		result.vwapSlope === null || result.vwapSlope === undefined
			? "-"
			: result.vwapSlope > 0
				? "↑"
				: result.vwapSlope < 0
					? "↓"
					: "→";
	const priceDigits = Number(result.market.pricePrecision ?? 2);

	return {
		id: result.market.id,
		lines: [
			`Predict: ${longColor}LONG ${result.pLong ?? "-"}%${ANSI.reset} / ${shortColor}SHORT ${result.pShort ?? "-"}%${ANSI.reset}`,
			`HA: ${result.consec?.color ?? "-"} x${result.consec?.count ?? 0}  RSI: ${formatNumber(result.rsiNow ?? null, 1)}`,
			`MACD: ${compactMacdLabel(result.macd)}  VWAP: ${vwapArrow}`,
			`⏱ ${fmtTimeLeft(result.timeLeftMin)}  Spot: $${formatNumber(result.spotPrice ?? null, priceDigits)}  PTB: ${result.priceToBeat === null || result.priceToBeat === undefined ? "-" : `$${formatNumber(result.priceToBeat, priceDigits)}`}`,
			`UP ${formatNumber(result.marketUp ?? null, 2)}¢ / DOWN ${formatNumber(result.marketDown ?? null, 2)}¢`,
			`${actionColor}${result.actionText ?? "NO TRADE"}${ANSI.reset}`,
		],
	};
}

function headerCell(title: string, width: number): string {
	const label = ` ${title} `;
	const fill = Math.max(0, width - label.length);
	return `─${label}${"─".repeat(fill)}`;
}

function renderGrid(panels: PanelData[]): string {
	const width = screenWidth();
	const cellWidth = Math.max(30, Math.floor((width - 3) / 2));
	const defaultPanel: PanelData = { id: "-", lines: ["", "", "", "", "", ""] };
	const slots: [PanelData, PanelData, PanelData, PanelData] = [
		panels[0] ?? defaultPanel,
		panels[1] ?? defaultPanel,
		panels[2] ?? defaultPanel,
		panels[3] ?? defaultPanel,
	];

	const top = `┌${headerCell(slots[0].id, cellWidth - 1)}┬${headerCell(slots[1].id, cellWidth - 1)}┐`;
	const mid = `├${headerCell(slots[2].id, cellWidth - 1)}┼${headerCell(slots[3].id, cellWidth - 1)}┤`;
	const bot = `└${"─".repeat(cellWidth)}┴${"─".repeat(cellWidth)}┘`;

	const lines: string[] = [top];
	for (let i = 0; i < 6; i += 1) {
		lines.push(`│${padAnsi(slots[0].lines[i] ?? "", cellWidth)}│${padAnsi(slots[1].lines[i] ?? "", cellWidth)}│`);
	}
	lines.push(mid);
	for (let i = 0; i < 6; i += 1) {
		lines.push(`│${padAnsi(slots[2].lines[i] ?? "", cellWidth)}│${padAnsi(slots[3].lines[i] ?? "", cellWidth)}│`);
	}
	lines.push(bot);

	const now = new Date();
	if (isPaperRunning() || isLiveRunning()) {
		const paper = isPaperRunning() ? "ON" : "OFF";
		const live = isLiveRunning() ? "ON" : "OFF";
		lines.push(`${ANSI.yellow}[MODES]${ANSI.reset} PAPER ${paper} | LIVE ${live}`);
	}
	lines.push(
		`${ANSI.white}ET${ANSI.reset} ${fmtEtTime(now)} | ${ANSI.white}Session${ANSI.reset} ${getBtcSession(now)}`,
	);
	return `${lines.join("\n")}\n`;
}

function writeLatestSignal(marketId: string, payload: TradeSignal): void {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			fs.mkdirSync("./data", { recursive: true });
			fs.writeFileSync(`./data/latest-signal-${marketId}.json`, JSON.stringify(payload));
			return;
		} catch (err) {
			log.warn(`writeLatestSignal attempt ${attempt}/3 failed for ${marketId}:`, err);
		}
	}
	log.error(`writeLatestSignal failed after 3 attempts for market ${marketId}`);
}

const paperTracker = {
	markets: new Set<string>(), // per-market dedup: `${marketId}:${windowStartMs}`
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

const liveTracker = {
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

const MAX_PRICE_AGE_MS = 60_000;

async function processMarket({
	market,
	timing,
	streams,
	state,
}: Omit<ProcessMarketParams, "orderTracker">): Promise<ProcessMarketResult> {
	const wsTick = streams.binance.getLast(market.binanceSymbol);
	const wsPrice = wsTick?.price ?? null;

	const polyWsTick = streams.polymarket.getLast(market.chainlink.wsSymbol);
	const polyWsPrice = polyWsTick?.price ?? null;

	const chainlinkWsTick: PriceTick = streams.chainlink.get(market.id)?.getLast?.() ?? {
		price: null,
		updatedAt: null,
		source: "chainlink_ws",
	};
	const chainlinkWsPrice = chainlinkWsTick?.price ?? null;

	const chainlinkPromise: Promise<PriceTick> =
		polyWsPrice !== null
			? Promise.resolve({
					price: polyWsPrice,
					updatedAt: polyWsTick?.updatedAt ?? null,
					source: "polymarket_ws",
				})
			: chainlinkWsPrice !== null
				? Promise.resolve({
						price: chainlinkWsPrice,
						updatedAt: chainlinkWsTick?.updatedAt ?? null,
						source: "chainlink_ws",
					})
				: fetchChainlinkPrice({
						aggregator: market.chainlink.aggregator,
						decimals: market.chainlink.decimals,
					});

	const [klines1mRaw, lastPriceRaw, chainlink, poly] = await Promise.all([
		fetchKlines({ symbol: market.binanceSymbol, interval: "1m", limit: 240 }),
		fetchLastPrice({ symbol: market.binanceSymbol }),
		chainlinkPromise,
		fetchPolymarketSnapshot(market),
	]);

	const settlementMs =
		poly.ok && (poly.market as AnyRecord | undefined)?.endDate
			? new Date(String((poly.market as AnyRecord).endDate)).getTime()
			: null;
	const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;
	const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;
	const lastPrice = Number(lastPriceRaw);
	const spotPrice = wsPrice ?? lastPrice;
	const currentPrice = chainlink?.price ?? null;
	const priceUpdatedAt = chainlink?.updatedAt ?? null;
	if (priceUpdatedAt !== null && Date.now() - priceUpdatedAt > MAX_PRICE_AGE_MS) {
		log.warn(`Stale price for ${market.id}: ${(Date.now() - priceUpdatedAt) / 1000}s old — skipping`);
		return { ok: false, market, error: `stale_price_${(Date.now() - priceUpdatedAt) / 1000}s` };
	}
	const marketSlug = poly.ok ? String((poly.market as AnyRecord | undefined)?.slug ?? "") : "";
	const marketStartMs =
		poly.ok && (poly.market as AnyRecord | undefined)?.eventStartTime
			? new Date(String((poly.market as AnyRecord).eventStartTime)).getTime()
			: null;

	const candles = klines1mRaw as Candle[];
	const closes: number[] = candles.map((c) => Number(c.close));
	const vwapSeries = computeVwapSeries(candles);
	const vwapNowRaw = vwapSeries[vwapSeries.length - 1];
	const vwapNow = vwapNowRaw === undefined ? null : vwapNowRaw;
	const lookback = CONFIG.vwapSlopeLookbackMinutes;
	const vwapBack = vwapSeries[vwapSeries.length - lookback];
	const vwapSlope =
		vwapSeries.length >= lookback && vwapNow !== null && vwapBack !== undefined
			? (vwapNow - vwapBack) / lookback
			: null;

	const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
	// Only compute last 3 RSI values for slope (O(3×period) instead of O(n×period))
	const rsiForSlope: number[] = [];
	for (let offset = 2; offset >= 0; offset--) {
		const subLen = closes.length - offset;
		if (subLen >= CONFIG.rsiPeriod + 1) {
			const r = computeRsi(closes.slice(0, subLen), CONFIG.rsiPeriod);
			if (r !== null) rsiForSlope.push(r);
		}
	}
	const rsiSlope = slopeLast(rsiForSlope, 3);

	const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal) as MacdResult | null;
	const ha = computeHeikenAshi(candles);
	const consec = countConsecutive(ha);

	const vwapCrossCount = countVwapCrosses(closes, vwapSeries, 20);
	const volumeRecent = candles.slice(-20).reduce((a, c) => a + Number(c.volume), 0);
	const volumeAvg = candles.slice(-120).reduce((a, c) => a + Number(c.volume), 0) / 6;

	const failedVwapReclaim =
		vwapNow !== null && vwapSeries.length >= 3
			? Number(closes[closes.length - 1]) < vwapNow &&
				Number(closes[closes.length - 2]) > Number(vwapSeries[vwapSeries.length - 2])
			: false;

	const regimeInfo = detectRegime({
		price: lastPrice,
		vwap: vwapNow,
		vwapSlope,
		vwapCrossCount,
		volumeRecent,
		volumeAvg,
	});

	if (marketSlug && state.priceToBeatState.slug !== marketSlug) {
		state.priceToBeatState = { slug: marketSlug, value: null, setAtMs: null };
		const parsedPrice = poly.ok ? priceToBeatFromPolymarketMarket(poly.market) : null;
		if (parsedPrice !== null) {
			state.priceToBeatState = {
				slug: marketSlug,
				value: parsedPrice,
				setAtMs: Date.now(),
			};
		}
	}

	if (state.priceToBeatState.slug && state.priceToBeatState.value === null && currentPrice !== null) {
		const nowMs = Date.now();
		const okToLatch = marketStartMs === null ? true : nowMs >= marketStartMs;
		if (okToLatch) {
			state.priceToBeatState = {
				slug: state.priceToBeatState.slug,
				value: Number(currentPrice),
				setAtMs: nowMs,
			};
		}
	}

	const scored = scoreDirection({
		price: currentPrice ?? lastPrice,
		vwap: vwapNow,
		vwapSlope,
		rsi: rsiNow,
		rsiSlope,
		macd,
		heikenColor: consec.color,
		heikenCount: consec.count,
		failedVwapReclaim,
	});

	const volatility15m = computeRealizedVolatility(closes, 60);
	const priceToBeat = state.priceToBeatState.slug === marketSlug ? state.priceToBeatState.value : null;
	const binanceChainlinkDelta =
		spotPrice !== null && currentPrice !== null && currentPrice > 0 ? (spotPrice - currentPrice) / currentPrice : null;
	const upBookSummary = poly.ok ? (poly.orderbook?.up ?? null) : null;
	const downBookSummary = poly.ok ? (poly.orderbook?.down ?? null) : null;

	const upImbalance =
		upBookSummary?.bidLiquidity != null &&
		upBookSummary?.askLiquidity != null &&
		upBookSummary.bidLiquidity + upBookSummary.askLiquidity > 0
			? (upBookSummary.bidLiquidity - upBookSummary.askLiquidity) /
				(upBookSummary.bidLiquidity + upBookSummary.askLiquidity)
			: null;
	const downImbalance =
		downBookSummary?.bidLiquidity != null &&
		downBookSummary?.askLiquidity != null &&
		downBookSummary.bidLiquidity + downBookSummary.askLiquidity > 0
			? (downBookSummary.bidLiquidity - downBookSummary.askLiquidity) /
				(downBookSummary.bidLiquidity + downBookSummary.askLiquidity)
			: null;

	let netImbalance: number | null = null;
	if (upImbalance !== null && downImbalance !== null) {
		netImbalance = upImbalance - downImbalance;
	} else if (upImbalance !== null) {
		netImbalance = upImbalance;
	} else if (downImbalance !== null) {
		netImbalance = -downImbalance;
	}
	const orderbookImbalance = netImbalance;

	const volImplied = computeVolatilityImpliedProb({
		currentPrice,
		priceToBeat,
		volatility15m,
		timeLeftMin,
		windowMin: CONFIG.candleWindowMinutes,
	});

	const blended = blendProbabilities({
		volImpliedUp: volImplied,
		taRawUp: scored.rawUp,
		binanceLeadSignal: binanceChainlinkDelta,
		orderbookImbalance,
		weights: CONFIG.strategy.blendWeights,
	});

	const finalUp =
		blended.source === "blended"
			? blended.blendedUp
			: applyAdaptiveTimeDecay(scored.rawUp, timeLeftMin, CONFIG.candleWindowMinutes, volatility15m).adjustedUp;
	const finalDown = 1 - finalUp;

	const marketUp = poly.ok ? (poly.prices?.up ?? null) : null;
	const marketDown = poly.ok ? (poly.prices?.down ?? null) : null;
	const edge = computeEdge({
		modelUp: finalUp,
		modelDown: finalDown,
		marketYes: marketUp,
		marketNo: marketDown,
		orderbookImbalance,
		orderbookSpreadUp: upBookSummary?.spread ?? null,
		orderbookSpreadDown: downBookSummary?.spread ?? null,
	});

	if (edge.vigTooHigh) {
		return {
			ok: true,
			market,
			rec: {
				action: "NO_TRADE",
				side: null,
				phase: null,
				regime: regimeInfo.regime,
				reason: `vig_too_high_${edge.rawSum?.toFixed(3)}`,
			} as unknown as TradeDecision,
		};
	}

	const rec = decide({
		remainingMinutes: timeLeftMin,
		edgeUp: edge.edgeUp,
		edgeDown: edge.edgeDown,
		effectiveEdgeUp: edge.effectiveEdgeUp,
		effectiveEdgeDown: edge.effectiveEdgeDown,
		modelUp: finalUp,
		modelDown: finalDown,
		regime: regimeInfo.regime,
		modelSource: blended.source,
		strategy: CONFIG.strategy,
		marketId: market.id,
		volatility15m,
		orderbookImbalance,
		vwapSlope,
		rsi: rsiNow,
		macdHist: macd?.hist ?? null,
		haColor: consec.color,
		minConfidence: CONFIG.strategy.minConfidence ?? 0.5,
	});

	state.prevSpotPrice = spotPrice ?? state.prevSpotPrice;
	state.prevCurrentPrice = currentPrice ?? state.prevCurrentPrice;

	const pLong = Number.isFinite(finalUp) ? (finalUp * 100).toFixed(0) : "-";
	const pShort = Number.isFinite(finalDown) ? (finalDown * 100).toFixed(0) : "-";
	const predictNarrative =
		Number(finalUp) > Number(finalDown) ? "LONG" : Number(finalDown) > Number(finalUp) ? "SHORT" : "NEUTRAL";

	const actionText =
		rec.action === "ENTER"
			? `Edge: ${(Number(rec.edge) * 100).toFixed(1)}% -> BUY ${rec.side}`
			: `NO TRADE (${rec.reason || rec.phase})`;

	const signalTimestamp = new Date().toISOString();
	const signalLabel = edge.arbitrage ? "ARBITRAGE" : rec.action === "ENTER" ? `BUY ${rec.side}` : "NO TRADE";
	const recommendation = edge.arbitrage
		? "ARBITRAGE_ALERT"
		: rec.action === "ENTER"
			? `${rec.side}:${rec.phase}:${rec.strength}`
			: "NO_TRADE";

	if (PERSIST_BACKEND === "csv" || PERSIST_BACKEND === "dual") {
		appendCsvRow(
			`./data/signals-${market.id}.csv`,
			[
				"timestamp",
				"entry_minute",
				"time_left_min",
				"regime",
				"signal",
				"vol_implied_up",
				"ta_raw_up",
				"blended_up",
				"blend_source",
				"volatility_15m",
				"price_to_beat",
				"binance_chainlink_delta",
				"orderbook_imbalance",
				"model_up",
				"model_down",
				"mkt_up",
				"mkt_down",
				"raw_sum",
				"arbitrage",
				"edge_up",
				"edge_down",
				"recommendation",
			],
			[
				signalTimestamp,
				timing.elapsedMinutes.toFixed(3),
				Number(timeLeftMin).toFixed(3),
				regimeInfo.regime,
				signalLabel,
				volImplied,
				scored.rawUp,
				blended.blendedUp,
				blended.source,
				volatility15m,
				priceToBeat,
				binanceChainlinkDelta,
				orderbookImbalance,
				finalUp,
				finalDown,
				marketUp,
				marketDown,
				edge.rawSum,
				edge.arbitrage ? 1 : 0,
				edge.edgeUp,
				edge.edgeDown,
				recommendation,
			],
		);
	}

	if (PERSIST_BACKEND === "dual" || PERSIST_BACKEND === "sqlite") {
		statements.insertSignal().run({
			$timestamp: signalTimestamp,
			$market: market.id,
			$regime: regimeInfo.regime,
			$signal: signalLabel,
			$vol_implied_up: volImplied,
			$ta_raw_up: scored.rawUp,
			$blended_up: blended.blendedUp,
			$blend_source: blended.source,
			$volatility_15m: volatility15m,
			$price_to_beat: priceToBeat,
			$binance_chainlink_delta: binanceChainlinkDelta,
			$orderbook_imbalance: orderbookImbalance,
			$model_up: finalUp,
			$model_down: finalDown,
			$mkt_up: marketUp,
			$mkt_down: marketDown,
			$raw_sum: edge.rawSum,
			$arbitrage: edge.arbitrage ? 1 : 0,
			$edge_up: edge.edgeUp,
			$edge_down: edge.edgeDown,
			$recommendation: recommendation,
			$entry_minute: timing.elapsedMinutes.toFixed(3),
			$time_left_min: Number(timeLeftMin).toFixed(3),
		});
	}

	let signalPayload: TradeSignal | null = null;
	if (rec.action === "ENTER") {
		signalPayload = {
			timestamp: new Date().toISOString(),
			marketId: market.id,
			marketSlug,
			side: rec.side as "UP" | "DOWN",
			phase: rec.phase,
			strength: rec.strength as "STRONG" | "GOOD" | "OPTIONAL",
			edgeUp: edge.edgeUp,
			edgeDown: edge.edgeDown,
			modelUp: finalUp,
			modelDown: finalDown,
			marketUp,
			marketDown,
			timeLeftMin,
			spotPrice,
			priceToBeat,
			currentPrice,
			blendSource: blended.source,
			volImpliedUp: volImplied,
			volatility15m,
			binanceChainlinkDelta,
			orderbookImbalance,
			rawSum: edge.rawSum,
			arbitrage: edge.arbitrage,
			tokens: poly.ok ? (poly.tokens ?? null) : null,
		};
		writeLatestSignal(market.id, signalPayload);
		emitSignalNew({
			marketId: market.id,
			timestamp: signalPayload.timestamp,
			regime: regimeInfo.regime,
			signal: "ENTER",
			modelUp: signalPayload.modelUp,
			modelDown: signalPayload.modelDown,
			edgeUp: signalPayload.edgeUp,
			edgeDown: signalPayload.edgeDown,
			recommendation: rec.action === "ENTER" ? `${rec.side}:${rec.phase}:${rec.strength}` : (rec.reason ?? null),
		});
	}

	return {
		ok: true,
		market,
		marketSlug,
		signalPayload,
		rec,
		consec,
		rsiNow,
		macd,
		vwapSlope,
		timeLeftMin,
		currentPrice,
		spotPrice,
		priceToBeat,
		volatility15m,
		blendSource: blended.source,
		volImpliedUp: volImplied,
		binanceChainlinkDelta,
		orderbookImbalance,
		orderbook: { up: upBookSummary, down: downBookSummary },
		marketUp,
		marketDown,
		rawSum: edge.rawSum,
		arbitrage: edge.arbitrage,
		pLong,
		pShort,
		predictNarrative,
		actionText,
	};
}

async function main(): Promise<void> {
	startApiServer();

	const orderManager = new OrderManager();

	// Set up order status change callback for heartbeat tracking
	orderManager.onOrderStatusChange((orderId: string, status: TrackedOrder["status"]) => {
		// Unregister from heartbeat tracking when order is filled, cancelled, or expired
		if (status === "filled" || status === "cancelled" || status === "expired") {
			unregisterOpenGtdOrder(orderId);
		}
	});

	const markets = getActiveMarkets();
	const binanceSymbols = markets.map((m) => m.binanceSymbol);
	const polymarketSymbols = markets.map((m) => m.chainlink.wsSymbol);

	const streams: {
		binance: WsStreamHandle;
		polymarket: WsStreamHandle;
		chainlink: Map<string, WsStreamHandle>;
	} = {
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

	// CLOB WebSocket for real-time best_bid_ask, tick_size_change, and market_resolved events
	const clobWs: ClobWsHandle = startClobMarketWs();
	// Token IDs are subscribed dynamically as markets are resolved in fetchPolymarketSnapshot

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
		record(marketId: string, windowSlug: string): void {
			this.orders.set(this.keyFor(marketId, windowSlug), Date.now());
			this.lastTradeMs = Date.now();
		},
		prune(): void {
			const cutoff = Date.now() - 16 * 60_000;
			for (const [key, ts] of this.orders) {
				if (ts < cutoff) this.orders.delete(key);
			}
		},
		onCooldown(): boolean {
			return false;
		},
	};

	const typedOrderTracker: OrderTracker = orderTracker;
	void typedOrderTracker;

	let prevWindowStartMs: number | null = null;

	const shutdown = () => {
		log.info("Shutdown signal received, stopping bot...");
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
		setTimeout(() => process.exit(0), 2000);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	// P1-2: Safe mode — pause trading when all markets fail consecutively
	let consecutiveAllFails = 0;
	const SAFE_MODE_THRESHOLD = 3;

	while (true) {
		// Check if we should be in the main loop:
		// - Running (paper or live)
		// - Pending start (waiting for next cycle)
		const shouldRunLoop = isPaperRunning() || isLiveRunning() || isPaperPendingStart() || isLivePendingStart();
		if (!shouldRunLoop) {
			await sleep(1000);
			continue;
		}

		const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
		if (prevWindowStartMs !== null && timing.startMs !== prevWindowStartMs) {
			// NEW CYCLE DETECTED - Handle pending start/stop transitions

			// 1. Handle pending start: transition to running at new cycle
			if (isPaperPendingStart()) {
				log.info("Pending start detected, starting at new cycle boundary");
				setPaperRunning(true);
				clearPaperPending();
			}
			if (isLivePendingStart()) {
				const status = getClientStatus();
				if (status.walletLoaded && status.clientReady) {
					// Set up orderManager with client
					const wallet = getWallet();
					if (wallet) {
						const { ClobClient } = await import("@polymarket/clob-client");
						const client = new ClobClient(CONFIG.clobBaseUrl, 137, wallet);
						orderManager.setClient(client);
						orderManager.startPolling(5_000);
						log.info("OrderManager started polling");
					}
					const heartbeatOk = startHeartbeat();
					if (heartbeatOk) {
						log.info("Pending start detected, starting at new cycle boundary");
						setLiveRunning(true);
					} else {
						log.error("Live start aborted: heartbeat failed to start");
					}
				} else {
					log.info("Pending start cancelled - wallet not ready");
				}
				clearLivePending();
			}

			paperTracker.setWindow(timing.startMs);
			liveTracker.setWindow(timing.startMs);

			// 2. Settlement logic (resolve paper trades, redeem live positions)
			if (isPaperRunning()) {
				const finalPrices = new Map<string, number>();
				for (const market of markets) {
					const st = states.get(market.id);
					if (st?.prevCurrentPrice !== null && st?.prevCurrentPrice !== undefined) {
						finalPrices.set(market.id, st.prevCurrentPrice);
					}
				}
				const prevPnl = getPaperStats().totalPnl;
				const resolved = resolvePaperTrades(prevWindowStartMs, finalPrices);
				if (resolved > 0) {
					const stats = getPaperStats();
					const pnlDelta = stats.totalPnl - prevPnl;
					updatePnl(pnlDelta, "paper");
					log.info(
						`Resolved ${resolved} trade(s) | W:${stats.wins} L:${stats.losses} | WR:${(stats.winRate * 100).toFixed(0)}% | PnL:${stats.totalPnl.toFixed(2)}`,
					);
				}
			}
			if (isLiveRunning()) {
				const wallet = getWallet();
				if (wallet) {
					log.info("Window changed, checking for redeemable positions...");
					redeemAll(wallet)
						.then((results) => {
							if (results.length) {
								log.info(`Redeemed ${results.length} position(s)`);
								// TODO: Credit PnL from redemption results once CLOB order status
								// API integration is available. Current approach is conservative:
								// treats all open trades as worst-case loss until daily reset.
							}
						})
						.catch((err: unknown) => {
							const message = err instanceof Error ? err.message : String(err);
							log.error("Redemption error:", message);
						});
				}
			}

			// 3. Handle pending stop: stop AFTER settlement completes
			if (isPaperPendingStop()) {
				log.info("Pending stop detected, stopping after cycle settlement");
				setPaperRunning(false);
				clearPaperPending();
			}
			if (isLivePendingStop()) {
				log.info("Pending stop detected, stopping after cycle settlement");
				setLiveRunning(false);
				stopHeartbeat();
				orderManager.stopPolling();
				clearLivePending();
			}
		}
		prevWindowStartMs = timing.startMs;

		orderTracker.prune();
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

		// P1-2: Track consecutive all-market failures for safe mode
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

		// Subscribe discovered token IDs to CLOB WebSocket for real-time events
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
			const slug = candidate.marketSlug ?? "";
			const sideBook = sig.side === "UP" ? (candidate.orderbook?.up ?? null) : (candidate.orderbook?.down ?? null);
			const sideLiquidity = sideBook?.askLiquidity ?? sideBook?.bidLiquidity ?? null;

			if (isPaperRunning()) {
				const tradeSize = Number(CONFIG.paperRisk.maxTradeSizeUsdc || 0);
				const affordCheck = canAffordTradeWithStopCheck(tradeSize);
				const minPaperLiquidity = Number(CONFIG.paperRisk.minLiquidity || 0);
				const hasPaperLiquidity = sideLiquidity !== null && sideLiquidity >= minPaperLiquidity;
				if (
					!paperTracker.has(mkt.id, timing.startMs) &&
					affordCheck.canTrade &&
					hasPaperLiquidity &&
					paperTracker.canTradeGlobally(Math.min(maxGlobalTrades, CONFIG.paperRisk.maxTradesPerWindow)) &&
					getPendingPaperTrades().length < CONFIG.paperRisk.maxOpenPositions
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
				const minLiveLiquidity = Number(CONFIG.liveRisk.minLiquidity || 0);
				const hasLiveLiquidity = sideLiquidity !== null && sideLiquidity >= minLiveLiquidity;
				if (!hasLiveLiquidity) {
					log.info(
						`Skip ${mkt.id} live: liquidity ${sideLiquidity === null ? "n/a" : sideLiquidity.toFixed(0)} < ${minLiveLiquidity.toFixed(0)}`,
					);
					continue;
				}

				const liveWindowLimit = Math.min(maxGlobalTrades, CONFIG.liveRisk.maxTradesPerWindow);
				const canPlace =
					orderTracker &&
					!orderTracker.hasOrder(mkt.id, slug) &&
					!orderTracker.onCooldown() &&
					orderTracker.totalActive() < CONFIG.liveRisk.maxOpenPositions &&
					successfulTradesThisTick < liveWindowLimit &&
					!liveTracker.has(mkt.id, timing.startMs) &&
					liveTracker.canTradeGlobally(liveWindowLimit);

				if (!canPlace) continue;

				const result = await executeTrade(sig, { marketConfig: mkt, riskConfig: CONFIG.liveRisk }, "live");
				if (result?.success) {
					orderTracker.record(mkt.id, slug);
					liveTracker.record(mkt.id, timing.startMs);
					successfulTradesThisTick += 1;
				} else {
					log.warn(`Live trade failed for ${mkt.id}: ${result?.reason ?? result?.error ?? "unknown_error"}`);
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
			paperPendingStart: isPaperPendingStart(),
			paperPendingStop: isPaperPendingStop(),
			livePendingStart: isLivePendingStart(),
			livePendingStop: isLivePendingStop(),
			paperStats: getPaperStats(),
		});

		const panelData = results.map((r) => buildPanelData(r));
		renderScreen(renderGrid(panelData));
		await sleep(CONFIG.pollIntervalMs);
	}
}

main();
