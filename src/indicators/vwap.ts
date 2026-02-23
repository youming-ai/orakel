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

export function computeVwapSeries(candles: Candle[]): (number | null)[] {
  const series: (number | null)[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const sub = candles.slice(0, i + 1);
    series.push(computeSessionVwap(sub));
  }
  return series;
}
