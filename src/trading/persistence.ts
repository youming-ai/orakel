import fs from "node:fs";
import { PERSIST_BACKEND, statements } from "./db.ts";
import { createLogger } from "./logger.ts";
import { emitSignalNew } from "./state.ts";
import type {
	BlendResult,
	CandleWindowTiming,
	EdgeResult,
	MarketConfig,
	PolymarketSnapshot,
	Regime,
	TradeDecision,
	TradeSignal,
} from "./types.ts";
import { appendCsvRow } from "./utils.ts";

const log = createLogger("bot");

interface PersistSignalParams {
	market: MarketConfig;
	timing: CandleWindowTiming;
	regimeInfo: { regime: Regime };
	edge: EdgeResult;
	scored: { rawUp: number };
	blended: BlendResult;
	finalUp: number;
	finalDown: number;
	volatility15m: number | null;
	priceToBeat: number | null;
	volImplied: number | null;
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

export function persistSignal({
	market,
	timing,
	regimeInfo,
	edge,
	scored,
	blended,
	finalUp,
	finalDown,
	volatility15m,
	priceToBeat,
	volImplied,
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

	// @deprecated CSV persistence — scheduled for removal. SQLite is the primary backend.
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

	return signalPayload;
}
