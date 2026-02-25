import type { Candle } from "../types.ts";

export function computeSessionVwap(candles: Candle[]): number | null {
	if (!Array.isArray(candles) || candles.length === 0) return null;

	let pv = 0;
	let v = 0;
	for (const c of candles) {
		const tp = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
		pv += tp * Number(c.volume);
		v += Number(c.volume);
	}
	if (v === 0) return null;
	return pv / v;
}

export function computeVwapSeries(candles: Candle[]): number[] {
	const series: number[] = [];
	let pv = 0;
	let v = 0;
	for (const c of candles) {
		const tp = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
		pv += tp * Number(c.volume);
		v += Number(c.volume);
		series.push(v === 0 ? 0 : pv / v);
	}
	return series;
}
