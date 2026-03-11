import { CONFIG } from "../core/config.ts";
import type { AppConfig, StrategyConfig } from "../core/configTypes.ts";
import { createLogger } from "../core/logger.ts";
import type { Candle, RawMarketData } from "../core/marketDataTypes.ts";
import { computeEdge, decide } from "../engines/edge.ts";
import {
	aggregateCandles,
	applyTimeAwareness,
	blendProbabilities,
	computeAdaptiveTaWeight,
	computeRealizedVolatility,
	estimatePriceToBeatProbability,
	scoreDirection,
} from "../engines/probability.ts";
import { detectRegime } from "../engines/regime.ts";
import { computeHeikenAshi, countConsecutive } from "../indicators/heikenAshi.ts";
import { computeMacd } from "../indicators/macd.ts";
import { computeRsi, slopeLast } from "../indicators/rsi.ts";
import { computeVwapSeries } from "../indicators/vwap.ts";
import type { ComputeResult, MacdResult, TradeDecision } from "../trading/tradeTypes.ts";

const log = createLogger("pipeline-compute");

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

export function computeMarketDecision(
	data: RawMarketData,
	priceToBeat: number | null,
	config: AppConfig,
	strategy: StrategyConfig,
): ComputeResult {
	const { market, candles, currentPrice, lastPrice, spotPrice, poly, timeLeftMin, aggregatedPrice } = data;
	if (poly.ok && poly.degraded) {
		log.warn(`Polymarket snapshot degraded for ${market.id}; using fallback orderbook/price data`);
	}

	const divergenceThreshold = strategy.divergenceThreshold ?? 0.004;
	const priceDivergence = aggregatedPrice?.divergence?.maxDivergence ?? null;
	if (priceDivergence !== null && priceDivergence > divergenceThreshold) {
		log.info(`${market.id} price divergence: ${(priceDivergence * 100).toFixed(3)}% - confidence boost applied`);
	}
	const effectiveTimeLeftMin = timeLeftMin ?? market.candleWindowMinutes;
	const aggregationMinutes = Math.max(1, Number(strategy.candleAggregationMinutes ?? 1));
	const sampledCandles: Candle[] = aggregateCandles(candles, aggregationMinutes);
	const closes: number[] = sampledCandles.map((c) => Number(c.close));
	const fallbackClose = Number.isFinite(lastPrice) ? lastPrice : 0;
	for (let i = 0; i < closes.length; i += 1) {
		if (!Number.isFinite(closes[i])) {
			const prevClose = i > 0 ? closes[i - 1] : undefined;
			closes[i] = typeof prevClose === "number" && Number.isFinite(prevClose) ? prevClose : fallbackClose;
		}
	}
	const vwapSeries = computeVwapSeries(sampledCandles);
	const vwapNowRaw = vwapSeries[vwapSeries.length - 1];
	const vwapNow = vwapNowRaw === undefined ? null : vwapNowRaw;
	const lookback = Math.max(1, Math.round(config.vwapSlopeLookbackMinutes / aggregationMinutes));
	const vwapBack = vwapSeries[vwapSeries.length - lookback];
	const vwapSlope =
		vwapSeries.length >= lookback && vwapNow !== null && vwapBack !== undefined
			? (vwapNow - vwapBack) / lookback
			: null;

	const rsiPeriod = Math.max(2, Math.round(config.rsiPeriod / aggregationMinutes));
	const rsiNow = computeRsi(closes, rsiPeriod);
	const rsiForSlope: number[] = [];
	for (let offset = 2; offset >= 0; offset--) {
		if (offset === 0) {
			if (rsiNow !== null) rsiForSlope.push(rsiNow);
		} else {
			const subLen = closes.length - offset;
			if (subLen >= rsiPeriod + 1) {
				const r = computeRsi(closes.slice(0, subLen), rsiPeriod);
				if (r !== null) rsiForSlope.push(r);
			}
		}
	}
	const rsiSlope = slopeLast(rsiForSlope, 3);

	const macdFast = Math.max(2, Math.round(config.macdFast / aggregationMinutes));
	const macdSlow = Math.max(macdFast + 1, Math.round(config.macdSlow / aggregationMinutes));
	const macdSignal = Math.max(2, Math.round(config.macdSignal / aggregationMinutes));
	const macd = computeMacd(closes, macdFast, macdSlow, macdSignal) as MacdResult | null;
	const ha = computeHeikenAshi(sampledCandles);
	const consec = countConsecutive(ha);

	const recentBars = Math.max(1, Math.round(20 / aggregationMinutes));
	const avgBars = Math.max(recentBars, Math.round(120 / aggregationMinutes));
	const vwapCrossCount = countVwapCrosses(closes, vwapSeries, Math.max(3, recentBars));
	const volumeRecent = sampledCandles.slice(-recentBars).reduce((a, c) => a + Number(c.volume), 0);
	const volumeAvg =
		sampledCandles.slice(-avgBars).reduce((a, c) => a + Number(c.volume), 0) / Math.max(1, avgBars / recentBars);

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
		regimeConfig: CONFIG.regime,
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
		probabilityConfig: CONFIG.probability,
	});

	const volLookback = Math.max(5, Math.round(Math.max(30, market.candleWindowMinutes * 4) / aggregationMinutes));
	const volatility15m = computeRealizedVolatility(closes, volLookback);
	const spotChainlinkDelta =
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

	const timeAware = applyTimeAwareness(scored.rawUp, effectiveTimeLeftMin, market.candleWindowMinutes);
	const volImpliedUp = estimatePriceToBeatProbability({
		currentPrice: currentPrice ?? lastPrice,
		priceToBeat,
		remainingMinutes: effectiveTimeLeftMin,
		volatility15m,
		probabilityConfig: CONFIG.probability,
	});
	const priceToBeatMovePct =
		priceToBeat !== null &&
		Number.isFinite(priceToBeat) &&
		priceToBeat > 0 &&
		Number.isFinite(currentPrice ?? lastPrice)
			? ((currentPrice ?? lastPrice) - priceToBeat) / priceToBeat
			: null;
	const adaptiveTaWeight = computeAdaptiveTaWeight(
		effectiveTimeLeftMin,
		market.candleWindowMinutes,
		strategy.taWeightEarly ?? 0.7,
		strategy.taWeightLate ?? 0.3,
	);
	const blended = blendProbabilities(timeAware.adjustedUp, volImpliedUp, adaptiveTaWeight);
	const finalUp = blended.finalUp;
	const finalDown = blended.finalDown;

	const marketUp = poly.ok ? (poly.prices?.up ?? null) : null;
	const marketDown = poly.ok ? (poly.prices?.down ?? null) : null;
	const edge = computeEdge({
		modelUp: finalUp,
		modelDown: finalDown,
		marketYes: marketUp,
		marketNo: marketDown,
		edgeDownBias: strategy.edgeDownBias ?? 0,
		edgeConfig: CONFIG.edge,
	});

	// Apply directional divergence-based edge boost when cross-exchange price divergence exceeds threshold.
	// If Binance price > Bybit price, the primary exchange sees higher value → boost UP edge only.
	// If Binance price < Bybit price → boost DOWN edge only.
	let boostedEdge = edge;
	if (priceDivergence !== null && priceDivergence > divergenceThreshold && aggregatedPrice?.divergence) {
		const boostFactor = strategy.divergenceBoostFactor ?? 0.5;
		const boostMax = strategy.divergenceBoostMax ?? 0.02;
		const boost = Math.min(priceDivergence * boostFactor, boostMax);
		const { price1, price2 } = aggregatedPrice.divergence;
		const binanceHigher = price1 > price2;
		boostedEdge = {
			...edge,
			edgeUp: edge.edgeUp !== null ? edge.edgeUp + (binanceHigher ? boost : 0) : null,
			edgeDown: edge.edgeDown !== null ? edge.edgeDown + (binanceHigher ? 0 : boost) : null,
		};
	}

	const rec: TradeDecision = decide({
		remainingMinutes: effectiveTimeLeftMin,
		windowMinutes: market.candleWindowMinutes,
		edgeUp: boostedEdge.edgeUp,
		edgeDown: boostedEdge.edgeDown,
		modelUp: finalUp,
		modelDown: finalDown,
		volatility15m,
		priceToBeatMovePct,
		regime: regimeInfo.regime,
		strategy,
		edgeConfig: CONFIG.edge,
		marketId: market.id,
		marketYes: marketUp,
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
		spotChainlinkDelta,
		orderbookImbalance,
		marketUp,
		marketDown,
		edge,
		scored,
		regimeInfo,
		finalUp,
		finalDown,
		blendSource: blended.blendSource,
		volImpliedUp,
		pLong,
		pShort,
		predictNarrative,
		actionText,
	};
}
