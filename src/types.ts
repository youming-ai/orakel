export interface Candle {
	openTime: number;
	open: number | null;
	high: number | null;
	low: number | null;
	close: number | null;
	volume: number | null;
	closeTime: number;
}

export interface HaCandle {
	open: number;
	high: number;
	low: number;
	close: number;
	isGreen: boolean;
	body: number;
}

export interface MarketConfig {
	id: string;
	label: string;
	binanceSymbol: string;
	polymarket: {
		seriesId: string;
		seriesSlug: string;
		slugPrefix: string;
	};
	chainlink: {
		aggregator: string;
		decimals: number;
		wsSymbol: string;
	};
	pricePrecision: number;
}

export interface RiskConfig {
	maxTradeSizeUsdc: number;
	limitDiscount: number;
	dailyMaxLossUsdc: number;
	maxOpenPositions: number;
	minLiquidity: number;
	maxTradesPerWindow: number;
}

export interface StrategyConfig {
	edgeThresholdEarly: number;
	edgeThresholdMid: number;
	edgeThresholdLate: number;
	minProbEarly: number;
	minProbMid: number;
	minProbLate: number;
	blendWeights: { vol: number; ta: number };
	regimeMultipliers: {
		CHOP: number;
		RANGE: number;
		TREND_ALIGNED: number;
		TREND_OPPOSED: number;
	};
	skipMarkets?: string[];
	minConfidence?: number;
	downBiasMultiplier?: number;
}

export interface AppConfig {
	markets: MarketConfig[];
	binanceBaseUrl: string;
	gammaBaseUrl: string;
	clobBaseUrl: string;
	pollIntervalMs: number;
	candleWindowMinutes: number;
	vwapSlopeLookbackMinutes: number;
	rsiPeriod: number;
	rsiMaPeriod: number;
	macdFast: number;
	macdSlow: number;
	macdSignal: number;
	paperMode: boolean;
	persistBackend: StorageBackend;
	readBackend: Exclude<StorageBackend, "dual">;
	polymarket: {
		marketSlug: string;
		autoSelectLatest: boolean;
		liveDataWsUrl: string;
		upOutcomeLabel: string;
		downOutcomeLabel: string;
	};
	chainlink: {
		polygonRpcUrls: string[];
		polygonRpcUrl: string;
		polygonWssUrls: string[];
		polygonWssUrl: string;
		btcUsdAggregator: string;
	};
	strategy: StrategyConfig;
	risk: RiskConfig;
	paperRisk: RiskConfig;
	liveRisk: RiskConfig;
}

export interface EdgeResult {
	marketUp: number | null;
	marketDown: number | null;
	edgeUp: number | null;
	edgeDown: number | null;
	effectiveEdgeUp: number | null;
	effectiveEdgeDown: number | null;
	rawSum: number | null;
	arbitrage: boolean;
	overpriced: boolean;
	vigTooHigh?: boolean;
}

export type Phase = "EARLY" | "MID" | "LATE";
export type Regime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "CHOP";
export type Strength = "STRONG" | "GOOD" | "OPTIONAL";
export type Side = "UP" | "DOWN";
export type StorageBackend = "csv" | "dual" | "sqlite";

// Confidence scoring
export interface ConfidenceFactors {
	indicatorAlignment: number;
	volatilityScore: number;
	orderbookScore: number;
	timingScore: number;
	regimeScore: number;
}

export interface ConfidenceResult {
	score: number;
	factors: ConfidenceFactors;
	level: "HIGH" | "MEDIUM" | "LOW";
}

export interface TradeDecision {
	action: "ENTER" | "NO_TRADE";
	side: Side | null;
	phase: Phase;
	regime: Regime | null;
	strength?: Strength;
	edge?: number;
	reason?: string;
	confidence?: ConfidenceResult;
}

export interface RegimeResult {
	regime: Regime;
	reason: string;
}

export interface MacdResult {
	macd: number;
	signal: number;
	hist: number;
	histDelta: number | null;
}

export interface ScoreResult {
	upScore: number;
	downScore: number;
	rawUp: number;
}

export interface BlendResult {
	blendedUp: number;
	blendedDown: number;
	source: "blended" | "ta_only";
}

export interface CandleWindowTiming {
	startMs: number;
	endMs: number;
	elapsedMs: number;
	remainingMs: number;
	elapsedMinutes: number;
	remainingMinutes: number;
}

export interface PriceTick {
	price: number | null;
	ts?: number | null;
	updatedAt?: number | null;
	source?: string;
}

export interface OrderBookSummary {
	bestBid: number | null;
	bestAsk: number | null;
	spread: number | null;
	bidLiquidity: number | null;
	askLiquidity: number | null;
}

export interface PolymarketSnapshot {
	ok: boolean;
	reason?: string;
	market?: unknown;
	tokens?: { upTokenId: string; downTokenId: string };
	prices?: { up: number | null; down: number | null };
	orderbook?: { up: OrderBookSummary; down: OrderBookSummary };
	outcomes?: string[];
	clobTokenIds?: string[];
	outcomePrices?: string[];
}

export interface TradeSignal {
	timestamp: string;
	marketId: string;
	marketSlug: string;
	side: Side;
	phase: Phase;
	strength: Strength;
	edgeUp: number | null;
	edgeDown: number | null;
	modelUp: number;
	modelDown: number;
	marketUp: number | null;
	marketDown: number | null;
	timeLeftMin: number | null;
	spotPrice: number | null;
	priceToBeat: number | null;
	currentPrice: number | null;
	blendSource: string;
	volImpliedUp: number | null;
	volatility15m: number | null;
	binanceChainlinkDelta: number | null;
	orderbookImbalance: number | null;
	rawSum: number | null;
	arbitrage: boolean;
	tokens: { upTokenId: string; downTokenId: string } | null;
}

export interface TradeResult {
	success: boolean;
	order?: unknown;
	reason?: string;
	error?: string;
}

export interface DailyState {
	date: string;
	pnl: number;
	trades: number;
}

export interface OrderTracker {
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

export interface WsStreamHandle {
	getLast(symbol?: string): PriceTick;
	close(): void;
}

export interface RedeemResult {
	conditionId: string;
	txHash?: string;
	value?: number;
	status?: number;
	error?: string;
}

export interface MarketSnapshot {
	id: string;
	label: string;
	ok: boolean;
	error?: string;
	spotPrice: number | null;
	currentPrice: number | null;
	priceToBeat: number | null;
	marketUp: number | null;
	marketDown: number | null;
	rawSum: number | null;
	arbitrage: boolean;
	predictLong: number | null;
	predictShort: number | null;
	predictDirection: "LONG" | "SHORT" | "NEUTRAL";
	haColor: string | null;
	haConsecutive: number;
	rsi: number | null;
	macd: { macd: number; signal: number; hist: number; histDelta: number | null } | null;
	vwapSlope: number | null;
	timeLeftMin: number | null;
	phase: string | null;
	action: string;
	side: string | null;
	edge: number | null;
	strength: string | null;
	reason: string | null;
	volatility15m: number | null;
	blendSource: string | null;
	volImpliedUp: number | null;
	binanceChainlinkDelta: number | null;
	orderbookImbalance: number | null;
	confidence?: ConfidenceResult;
}

export interface PaperTradeEntry {
	id: string;
	marketId: string;
	windowStartMs: number;
	side: Side;
	price: number;
	size: number;
	priceToBeat: number;
	currentPriceAtEntry: number | null;
	timestamp: string;
	resolved: boolean;
	won: boolean | null;
	pnl: number | null;
	settlePrice: number | null;
}

export interface PaperStats {
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}

export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed";

export interface WsMessage<T = unknown> {
	type: WsEventType;
	data: T;
	ts: number;
	version: number;
}

export interface StateSnapshotPayload {
	markets: MarketSnapshot[];
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperPendingStart: boolean;
	paperPendingStop: boolean;
	livePendingStart: boolean;
	livePendingStop: boolean;
	paperStats: {
		totalTrades: number;
		wins: number;
		losses: number;
		pending: number;
		winRate: number;
		totalPnl: number;
	} | null;
}

export interface SignalNewPayload {
	marketId: string;
	timestamp: string;
	regime: string | null;
	signal: "ENTER" | "HOLD";
	modelUp: number;
	modelDown: number;
	edgeUp: number | null;
	edgeDown: number | null;
	recommendation: string | null;
}

export interface TradeExecutedPayload {
	marketId: string;
	mode: "paper" | "live";
	side: "UP" | "DOWN";
	price: number;
	size: number;
	timestamp: string;
	orderId: string;
	status: string;
}

// === Account Separation Types ===

export type AccountMode = "paper" | "live";

export interface LiveWalletState {
	address: string;
	connected: boolean;
	clientReady: boolean;
}

export interface PaperAccountState {
	initialBalance: number;
	currentBalance: number;
	maxDrawdown: number;
}

export interface AccountDailyState {
	paper: DailyState;
	live: DailyState;
}

export interface PerAccountConfig {
	paper: { risk: RiskConfig };
	live: { risk: RiskConfig };
	strategy: StrategyConfig;
}
