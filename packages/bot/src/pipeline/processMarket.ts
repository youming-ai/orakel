import { CONFIG, getStrategyForMarket } from "../core/config.ts";
import type { MarketConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import type { CandleWindowTiming, OrderBookSummary } from "../core/marketDataTypes.ts";
import { isLiveRunning } from "../core/state.ts";
import { persistSignal } from "../trading/persistence.ts";
import type { MacdResult, StreamHandles, TradeDecision, TradeSignal } from "../trading/tradeTypes.ts";
import { computeMarketDecision } from "./compute.ts";
import { fetchMarketData, priceToBeatFromPolymarketMarket } from "./fetch.ts";

const log = createLogger("process-market");

interface ProcessMarketParams {
	market: MarketConfig;
	timing: CandleWindowTiming;
	streams: StreamHandles;
	state: MarketState;
}

export interface MarketState {
	prevSpotPrice: number | null;
	prevCurrentPrice: number | null;
	prevMarketUp: number | null;
	prevMarketDown: number | null;
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
	spotChainlinkDelta?: number | null;
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

	const { marketSlug, currentPrice, poly } = data;
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

	const priceToBeat = state.priceToBeatState.slug === marketSlug ? state.priceToBeatState.value : null;
	const priceToBeatSource: "parsed" | "missing" = priceToBeat !== null ? "parsed" : "missing";
	const strategy = getStrategyForMarket(market.id);
	const result = computeMarketDecision(data, priceToBeat, CONFIG, strategy, isLiveRunning());
	if (result.edge.vigTooHigh) {
		log.info(
			`${market.id} vig too high: rawSum=${result.edge.rawSum?.toFixed(4)} (>${1.08}), skipping signal generation`,
		);
		return {
			ok: true,
			market,
			rec: result.rec,
		};
	}

	state.prevSpotPrice = data.spotPrice ?? state.prevSpotPrice;
	state.prevCurrentPrice = currentPrice ?? state.prevCurrentPrice;
	state.prevMarketUp = result.marketUp ?? state.prevMarketUp;
	state.prevMarketDown = result.marketDown ?? state.prevMarketDown;

	const signalParams = {
		market,
		regimeInfo: result.regimeInfo,
		edge: result.edge,
		finalUp: result.finalUp,
		finalDown: result.finalDown,
		volatility15m: result.volatility15m,
		priceToBeat,
		spotChainlinkDelta: result.spotChainlinkDelta,
		orderbookImbalance: result.orderbookImbalance,
		timeLeftMin: data.timeLeftMin,
		marketUp: result.marketUp,
		marketDown: result.marketDown,
		spotPrice: data.spotPrice,
		currentPrice,
		priceToBeatSource,
		marketSlug,
		rec: result.rec,
		poly,
	};
	const signalPayload = persistSignal(signalParams);

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
		blendSource: result.blendSource,
		volImpliedUp: result.volImpliedUp,
		spotChainlinkDelta: result.spotChainlinkDelta,
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
