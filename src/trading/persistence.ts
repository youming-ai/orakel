import { emitSignalNew } from "../core/state.ts";
// import { signalQueries } from "../db/queries.ts";
import type {
	CandleWindowTiming,
	EdgeResult,
	MarketConfig,
	PolymarketSnapshot,
	Regime,
	TradeDecision,
	TradeSignal,
} from "../types.ts";

interface PersistSignalParams {
	market: MarketConfig;
	timing: CandleWindowTiming;
	regimeInfo: { regime: Regime };
	edge: EdgeResult;
	scored: { rawUp: number };
	finalUp: number;
	finalDown: number;
	volatility15m: number | null;
	priceToBeat: number | null;
	binanceChainlinkDelta: number | null;
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

export function persistSignal({
	market,
	timing,
	regimeInfo,
	edge,
	scored,
	finalUp,
	finalDown,
	volatility15m,
	priceToBeat,
	binanceChainlinkDelta,
	orderbookImbalance,
	timeLeftMin,
	marketUp,
	marketDown,
	spotPrice,
	currentPrice,
	marketSlug,
	rec,
	poly,
}: PersistSignalParams): TradeSignal | null {
	const signalTimestamp = new Date().toISOString();
	const signalLabel = edge.arbitrage ? "ARBITRAGE" : rec.action === "ENTER" ? `BUY ${rec.side}` : "NO TRADE";
	const recommendation = edge.arbitrage
		? "ARBITRAGE_ALERT"
		: rec.action === "ENTER"
			? `${rec.side}:${rec.phase}:${rec.strength}`
			: "NO_TRADE";

	// NOTE: Signals logging disabled - too verbose
	// void signalQueries.insert({
	// 	timestamp: signalTimestamp,
	// 	market: market.id,
	// 	regime: regimeInfo.regime,
	// 	signal: signalLabel,
	// 	volImpliedUp: null,
	// 	taRawUp: scored.rawUp,
	// 	blendedUp: finalUp,
	// 	blendSource: "ta_only",
	// 	volatility15m: volatility15m,
	// 	priceToBeat: priceToBeat,
	// 	binanceChainlinkDelta: binanceChainlinkDelta,
	// 	orderbookImbalance: orderbookImbalance,
	// 	modelUp: finalUp,
	// 	modelDown: finalDown,
	// 	mktUp: marketUp,
	// 	mktDown: marketDown,
	// 	rawSum: edge.rawSum,
	// 	arbitrage: edge.arbitrage ? 1 : 0,
	// 	edgeUp: edge.edgeUp,
	// 	edgeDown: edge.edgeDown,
	// 	recommendation: recommendation,
	// 	entryMinute: timing.elapsedMinutes.toFixed(3),
	// 	timeLeftMin: Number(timeLeftMin),
	// });

	if (rec.action !== "ENTER") return null;

	const signalPayload: TradeSignal = {
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
		binanceChainlinkDelta,
		orderbookImbalance,
		rawSum: edge.rawSum,
		arbitrage: edge.arbitrage,
		tokens: poly.ok ? (poly.tokens ?? null) : null,
		conditionId: poly.ok && poly.market?.conditionId ? poly.market.conditionId : null,
	};

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

	return signalPayload;
}
