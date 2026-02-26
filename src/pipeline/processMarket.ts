import { CONFIG } from "../config.ts";
import { persistSignal } from "../persistence.ts";
import type {
	CandleWindowTiming,
	MacdResult,
	MarketConfig,
	OrderBookSummary,
	StreamHandles,
	TradeDecision,
	TradeSignal,
} from "../types.ts";
import { computeMarketDecision } from "./compute.ts";
import { fetchMarketData, priceToBeatFromPolymarketMarket } from "./fetch.ts";

interface ProcessMarketParams {
	market: MarketConfig;
	timing: CandleWindowTiming;
	streams: StreamHandles;
	state: MarketState;
}

export interface MarketState {
	prevSpotPrice: number | null;
	prevCurrentPrice: number | null;
	priceToBeatState: {
		slug: string | null;
		value: number | null;
		setAtMs: number | null;
	};
}

export interface ProcessMarketResult {
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

export async function processMarket({
	market,
	timing,
	streams,
	state,
}: Omit<ProcessMarketParams, "orderTracker">): Promise<ProcessMarketResult> {
	const data = await fetchMarketData(market, timing, streams);
	if (!data.ok) return { ok: false, market, error: data.error };

	const { marketSlug, marketStartMs, currentPrice, poly } = data;
	if (marketSlug && state.priceToBeatState.slug !== marketSlug) {
		state.priceToBeatState = { slug: marketSlug, value: null, setAtMs: null };
		const parsedPrice = poly.ok && poly.market ? priceToBeatFromPolymarketMarket(poly.market) : null;
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

	const priceToBeat = state.priceToBeatState.slug === marketSlug ? state.priceToBeatState.value : null;
	const result = computeMarketDecision(data, priceToBeat, CONFIG);
	if (result.edge.vigTooHigh) {
		return {
			ok: true,
			market,
			rec: result.rec,
		};
	}

	state.prevSpotPrice = data.spotPrice ?? state.prevSpotPrice;
	state.prevCurrentPrice = currentPrice ?? state.prevCurrentPrice;

	const signalPayload = persistSignal({
		market,
		timing,
		regimeInfo: result.regimeInfo,
		edge: result.edge,
		scored: result.scored,
		blended: result.blended,
		finalUp: result.finalUp,
		finalDown: result.finalDown,
		volatility15m: result.volatility15m,
		priceToBeat,
		volImplied: result.volImplied,
		binanceChainlinkDelta: result.binanceChainlinkDelta,
		orderbookImbalance: result.orderbookImbalance,
		timeLeftMin: data.timeLeftMin,
		marketUp: result.marketUp,
		marketDown: result.marketDown,
		spotPrice: data.spotPrice,
		currentPrice,
		marketSlug,
		rec: result.rec,
		poly,
	});

	return {
		ok: true,
		market,
		marketSlug,
		signalPayload,
		rec: result.rec,
		consec: result.consec,
		rsiNow: result.rsiNow,
		macd: result.macd,
		vwapSlope: result.vwapSlope,
		timeLeftMin: data.timeLeftMin,
		currentPrice,
		spotPrice: data.spotPrice,
		priceToBeat,
		volatility15m: result.volatility15m,
		blendSource: result.blended.source,
		volImpliedUp: result.volImplied,
		binanceChainlinkDelta: result.binanceChainlinkDelta,
		orderbookImbalance: result.orderbookImbalance,
		orderbook: poly.ok
			? { up: poly.orderbook?.up ?? null, down: poly.orderbook?.down ?? null }
			: { up: null, down: null },
		marketUp: result.marketUp,
		marketDown: result.marketDown,
		rawSum: result.edge.rawSum,
		arbitrage: result.edge.arbitrage,
		pLong: result.pLong,
		pShort: result.pShort,
		predictNarrative: result.predictNarrative,
		actionText: result.actionText,
	};
}
