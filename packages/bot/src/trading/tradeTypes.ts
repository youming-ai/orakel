import type { PriceTick } from "../core/marketDataTypes.ts";

export type Phase = "EARLY" | "MID" | "LATE";
export type Regime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "CHOP";
export type Strength = "STRONG" | "GOOD" | "OPTIONAL";
export type Side = "UP" | "DOWN";

export interface EdgeResult {
	marketUp: number | null;
	marketDown: number | null;
	edgeUp: number | null;
	edgeDown: number | null;
	rawSum: number | null;
	arbitrage: boolean;
	overpriced: boolean;
	vigTooHigh?: boolean;
	feeEstimateUp?: number;
	feeEstimateDown?: number;
}

export interface TradeDecision {
	action: "ENTER" | "NO_TRADE";
	side: Side | null;
	phase: Phase;
	regime: Regime | null;
	strength?: Strength;
	edge?: number;
	reason?: string;
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
	spotChainlinkDelta: number | null;
	orderbookImbalance: number | null;
	rawSum: number | null;
	arbitrage: boolean;
	tokens: { upTokenId: string; downTokenId: string } | null;
	conditionId: string | null;
	/** Source of priceToBeat value for auditability */
	priceToBeatSource?: "parsed" | "missing";
	/** Best bid-ask spread for the traded side */
	spread?: number | null;
}

export interface TradeResult {
	success: boolean;
	order?: unknown;
	reason?: string;
	error?: string;
	orderId?: string;
	tradePrice?: number;
	isGtdOrder?: boolean;
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

export interface StreamHandles {
	spot: WsStreamHandle;
	polymarket: WsStreamHandle;
	chainlink: Map<string, WsStreamHandle>;
}

export interface ComputeResult {
	rec: TradeDecision;
	consec: { color: string | null; count: number };
	rsiNow: number | null;
	macd: MacdResult | null;
	vwapSlope: number | null;
	volatility15m: number | null;
	spotChainlinkDelta: number | null;
	orderbookImbalance: number | null;
	marketUp: number | null;
	marketDown: number | null;
	edge: EdgeResult;
	scored: ScoreResult;
	regimeInfo: RegimeResult;
	finalUp: number;
	finalDown: number;
	blendSource: string;
	volImpliedUp: number | null;
	pLong: string;
	pShort: string;
	predictNarrative: string;
	actionText: string;
}
