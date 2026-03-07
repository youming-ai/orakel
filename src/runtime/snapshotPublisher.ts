import { buildStateSnapshotPayload } from "../app/api/statePayload.ts";
import type { MarketSnapshot } from "../contracts/stateTypes.ts";
import { emitStateSnapshot, updateMarkets } from "../core/state.ts";
import type { ProcessMarketResult } from "../pipeline/processMarket.ts";

export function buildMarketSnapshots(results: ProcessMarketResult[]): MarketSnapshot[] {
	return results.map(
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
		}),
	);
}

export function publishMarketSnapshots(results: ProcessMarketResult[]): void {
	const snapshots = buildMarketSnapshots(results);
	updateMarkets(snapshots);
	publishCurrentStateSnapshot();
}

export function publishCurrentStateSnapshot(): void {
	emitStateSnapshot(buildStateSnapshotPayload());
}
