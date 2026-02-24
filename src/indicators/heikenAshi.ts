import type { Candle, HaCandle } from "../types.ts";

export function computeHeikenAshi(candles: Candle[]): HaCandle[] {
	if (!Array.isArray(candles) || candles.length === 0) return [];

	const ha: HaCandle[] = [];
	for (let i = 0; i < candles.length; i += 1) {
		const c = candles[i] as Candle;
		const haClose = (Number(c.open) + Number(c.high) + Number(c.low) + Number(c.close)) / 4;

		const prev = ha[i - 1];
		const haOpen = prev ? (prev.open + prev.close) / 2 : (Number(c.open) + Number(c.close)) / 2;

		const haHigh = Math.max(Number(c.high), haOpen, haClose);
		const haLow = Math.min(Number(c.low), haOpen, haClose);

		ha.push({
			open: haOpen,
			high: haHigh,
			low: haLow,
			close: haClose,
			isGreen: haClose >= haOpen,
			body: Math.abs(haClose - haOpen),
		});
	}
	return ha;
}

export function countConsecutive(haCandles: HaCandle[]): { color: string | null; count: number } {
	if (!Array.isArray(haCandles) || haCandles.length === 0) return { color: null, count: 0 };

	const last = haCandles[haCandles.length - 1] as HaCandle;
	const target = last.isGreen ? "green" : "red";

	let count = 0;
	for (let i = haCandles.length - 1; i >= 0; i -= 1) {
		const c = haCandles[i] as HaCandle;
		const color = c.isGreen ? "green" : "red";
		if (color !== target) break;
		count += 1;
	}

	return { color: target, count };
}
