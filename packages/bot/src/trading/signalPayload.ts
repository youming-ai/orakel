import type { SignalNewPayload } from "../contracts/stateTypes.ts";
import type { MarketConfig } from "../core/configTypes.ts";
import type { PolymarketSnapshot } from "../core/marketDataTypes.ts";
import type { EdgeResult, Regime, TradeDecision, TradeSignal } from "./tradeTypes.ts";

export interface SignalPayloadParams {
	market: MarketConfig;
	regimeInfo: { regime: Regime };
	edge: EdgeResult;
	finalUp: number;
	finalDown: number;
	volatility15m: number | null;
	priceToBeat: number | null;
	spotChainlinkDelta: number | null;
	orderbookImbalance: number | null;
	timeLeftMin: number | null;
	marketUp: number | null;
	marketDown: number | null;
	spotPrice: number | null;
	currentPrice: number | null;
	marketSlug: string;
	rec: TradeDecision;
	poly: PolymarketSnapshot;
}

export function buildSignalRecommendation(rec: TradeDecision): string | null {
	return rec.action === "ENTER" ? `${rec.side}:${rec.phase}:${rec.strength}` : (rec.reason ?? null);
}

export function buildTradeSignalPayload(params: SignalPayloadParams): TradeSignal | null {
	const {
		market,
		edge,
		finalUp,
		finalDown,
		volatility15m,
		priceToBeat,
		spotChainlinkDelta,
		orderbookImbalance,
		timeLeftMin,
		marketUp,
		marketDown,
		spotPrice,
		currentPrice,
		marketSlug,
		rec,
		poly,
	} = params;

	if (rec.action !== "ENTER") return null;

	return {
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
		blendSource: "ta_only",
		volImpliedUp: null,
		volatility15m,
		spotChainlinkDelta,
		orderbookImbalance,
		rawSum: edge.rawSum,
		arbitrage: edge.arbitrage,
		tokens: poly.ok ? (poly.tokens ?? null) : null,
		conditionId: poly.ok && poly.market?.conditionId ? poly.market.conditionId : null,
	};
}

export function buildSignalNewPayload(params: SignalPayloadParams, signalPayload: TradeSignal): SignalNewPayload {
	return {
		marketId: params.market.id,
		timestamp: signalPayload.timestamp,
		regime: params.regimeInfo.regime,
		signal: "ENTER",
		modelUp: signalPayload.modelUp,
		modelDown: signalPayload.modelDown,
		edgeUp: signalPayload.edgeUp,
		edgeDown: signalPayload.edgeDown,
		recommendation: buildSignalRecommendation(params.rec),
	};
}
