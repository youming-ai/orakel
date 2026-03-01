import { signalQualityModel as defaultSignalQualityModel, getRegimeTransitionTracker } from "../adaptiveState.ts";
import { computeEdge, decide } from "../engines/edge.ts";
import { computeEnsemble } from "../engines/ensemble.ts";
import {
	applyAdaptiveTimeDecay,
	blendProbabilities,
	computeVolatilityImpliedProb,
	scoreDirection,
} from "../engines/probability.ts";
import { detectEnhancedRegime, detectRegime } from "../engines/regime.ts";
import type { SignalFeatures, SignalQualityModel } from "../engines/signalQuality.ts";
import { computeHeikenAshi, countConsecutive } from "../indicators/heikenAshi.ts";
import { IncrementalRSI } from "../indicators/incremental.ts";
import { computeMacd } from "../indicators/macd.ts";
import { slopeLast } from "../indicators/rsi.ts";
import { RollingVolatilityCalculator } from "../indicators/volatilityBuffer.ts";
import { computeVwapSeries } from "../indicators/vwap.ts";
import { createLogger } from "../logger.ts";
import type { AppConfig, ComputeResult, MacdResult, RawMarketData, TradeDecision } from "../types.ts";

const log = createLogger("compute");

export function countVwapCrosses(closes: number[], vwapSeries: number[], lookback: number): number | null {
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

export function computeMarketDecision(
	data: RawMarketData,
	priceToBeat: number | null,
	config: AppConfig,
	signalQualityModel?: SignalQualityModel | null,
): ComputeResult {
	const { market, candles, currentPrice, lastPrice, spotPrice, poly, timeLeftMin } = data;
	const effectiveTimeLeftMin = timeLeftMin ?? config.candleWindowMinutes;
	const closes: number[] = candles.map((c) => Number(c.close));
	const vwapSeries = computeVwapSeries(candles);
	const vwapNowRaw = vwapSeries[vwapSeries.length - 1];
	const vwapNow = vwapNowRaw === undefined ? null : vwapNowRaw;
	const lookback = config.vwapSlopeLookbackMinutes;
	const vwapBack = vwapSeries[vwapSeries.length - lookback];
	const vwapSlope =
		vwapSeries.length >= lookback && vwapNow !== null && vwapBack !== undefined
			? (vwapNow - vwapBack) / lookback
			: null;

	// Single-pass RSI with trailing values for slope (replaces 4× computeRsi calls)
	const rsiCalc = new IncrementalRSI(config.rsiPeriod);
	const rsiTrailing = rsiCalc.initFromClosesWithTrailing(closes, 3);
	const rsiNow = rsiCalc.value;
	const rsiSlope = slopeLast(rsiTrailing, 3);

	const macd = computeMacd(closes, config.macdFast, config.macdSlow, config.macdSignal) as MacdResult | null;
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
	const enhancedRegimeInfo = detectEnhancedRegime({
		price: lastPrice,
		vwap: vwapNow,
		vwapSlope,
		vwapCrossCount,
		volumeRecent,
		volumeAvg,
		rsi: rsiNow,
		macdHist: macd?.hist ?? null,
		transitionTracker: getRegimeTransitionTracker(market.id),
	});

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

	// Ring-buffer volatility (avoids array slice + copy)
	const volCalc = new RollingVolatilityCalculator(60, config.candleWindowMinutes);
	const volatility15m = volCalc.initFromCloses(closes);
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
		windowMin: config.candleWindowMinutes,
	});

	const blended = blendProbabilities({
		volImpliedUp: volImplied,
		taRawUp: scored.rawUp,
		binanceLeadSignal: binanceChainlinkDelta,
		orderbookImbalance,
		weights: config.strategy.blendWeights,
	});

	const baseFinalUp =
		blended.source === "blended"
			? blended.blendedUp
			: applyAdaptiveTimeDecay(scored.rawUp, effectiveTimeLeftMin, config.candleWindowMinutes, volatility15m)
					.adjustedUp;

	const phase = effectiveTimeLeftMin > 10 ? "EARLY" : effectiveTimeLeftMin > 5 ? "MID" : "LATE";

	const qualityModel = signalQualityModel === undefined ? defaultSignalQualityModel : signalQualityModel;
	let signalQuality: ComputeResult["signalQuality"] = null;
	let ensembleResult: ComputeResult["ensembleResult"] = null;
	let finalUp = baseFinalUp;

	if (qualityModel) {
		const features: SignalFeatures = {
			marketId: market.id,
			edge: Math.abs(baseFinalUp - 0.5) * 2,
			confidence: Math.abs(scored.rawUp - 0.5) * 2,
			volatility15m: volatility15m ?? 0,
			phase,
			regime: regimeInfo.regime,
			modelUp: baseFinalUp,
			orderbookImbalance,
			rsi: rsiNow,
			vwapSlope,
		};

		signalQuality = qualityModel.predictWinRate(features);
		ensembleResult = computeEnsemble({
			volImpliedUp: volImplied,
			taRawUp: scored.rawUp,
			blendedUp: blended.blendedUp,
			blendSource: blended.source,
			signalQualityWinRate: signalQuality.confidence === "INSUFFICIENT" ? null : signalQuality.predictedWinRate,
			signalQualityConfidence: signalQuality.confidence,
			regime: regimeInfo.regime,
			volatility15m,
			orderbookImbalance,
		});
		finalUp = ensembleResult.finalUp;
	}
	const pipelineMode = ensembleResult !== null ? "V8-full" : "V8-degraded";
	if (ensembleResult !== null) {
		log.debug(
			`[${data.market.id}] pipeline=${pipelineMode} ensemble.agreement=${ensembleResult.agreement.toFixed(2)} dominant=${ensembleResult.dominantModel}`,
		);
	} else {
		log.debug(`[${data.market.id}] pipeline=${pipelineMode} using blend-only (finalUp=${finalUp.toFixed(3)})`);
	}

	const finalDown = 1 - finalUp;

	const marketUp = poly.ok ? (poly.prices?.up ?? null) : null;
	const marketDown = poly.ok ? (poly.prices?.down ?? null) : null;
	const edge = computeEdge({
		modelUp: finalUp,
		modelDown: finalDown,
		marketYes: marketUp,
		marketNo: marketDown,
		marketId: market.id,
		binanceChainlinkDelta,
		orderbookImbalance,
		orderbookSpreadUp: upBookSummary?.spread ?? null,
		orderbookSpreadDown: downBookSummary?.spread ?? null,
	});

	const rec = edge.vigTooHigh
		? ({
				action: "NO_TRADE",
				side: null,
				phase: null,
				regime: regimeInfo.regime,
				reason: `vig_too_high_${edge.rawSum?.toFixed(3)}`,
			} as unknown as TradeDecision)
		: decide({
				remainingMinutes: effectiveTimeLeftMin,
				edgeUp: edge.edgeUp,
				edgeDown: edge.edgeDown,
				effectiveEdgeUp: edge.effectiveEdgeUp,
				effectiveEdgeDown: edge.effectiveEdgeDown,
				modelUp: finalUp,
				modelDown: finalDown,
				regime: regimeInfo.regime,
				strategy: config.strategy,
				marketId: market.id,
				volatility15m,
				orderbookImbalance,
				vwapSlope,
				rsi: rsiNow,
				macdHist: macd?.hist ?? null,
				haColor: consec.color,
			});

	const pLong = Number.isFinite(finalUp) ? (finalUp * 100).toFixed(0) : "-";
	const pShort = Number.isFinite(finalDown) ? (finalDown * 100).toFixed(0) : "-";
	const predictNarrative =
		Number(finalUp) > Number(finalDown) ? "LONG" : Number(finalDown) > Number(finalUp) ? "SHORT" : "NEUTRAL";

	const actionText =
		rec.action === "ENTER"
			? `Edge: ${(Number(rec.edge) * 100).toFixed(1)}% -> BUY ${rec.side}`
			: `NO TRADE (${rec.reason || rec.phase})`;

	return {
		rec,
		consec,
		rsiNow,
		macd,
		vwapSlope,
		volatility15m,
		binanceChainlinkDelta,
		orderbookImbalance,
		marketUp,
		marketDown,
		edge,
		scored,
		blended,
		ensembleResult,
		signalQuality,
		regimeInfo,
		enhancedRegime: enhancedRegimeInfo,
		finalUp,
		finalDown,
		volImplied,
		pLong,
		pShort,
		predictNarrative,
		actionText,
	};
}
