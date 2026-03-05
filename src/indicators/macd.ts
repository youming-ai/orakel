import type { MacdResult } from "../types.ts";

export function computeMacd(closes: (number | null)[], fast: number, slow: number, signal: number): MacdResult | null {
	if (fast <= 0 || slow <= 0 || signal <= 0 || fast >= slow) return null;
	if (!Array.isArray(closes) || closes.length < slow + signal) return null;

	const kFast = 2 / (fast + 1);
	const kSlow = 2 / (slow + 1);

	let fastSum = 0;
	let slowSum = 0;
	for (let i = 0; i < slow; i += 1) {
		const val = Number(closes[i]);
		if (i < fast) fastSum += val;
		slowSum += val;
	}
	let fastEma = fastSum / fast;
	let slowEma = slowSum / slow;
	// Warm up fast EMA through the gap between fast and slow periods
	for (let i = fast; i < slow; i += 1) {
		const val = Number(closes[i]);
		fastEma = val * kFast + fastEma * (1 - kFast);
	}

	const macdSeries: number[] = [];
	for (let i = slow; i < closes.length; i += 1) {
		const val = Number(closes[i]);
		fastEma = val * kFast + fastEma * (1 - kFast);
		slowEma = val * kSlow + slowEma * (1 - kSlow);
		macdSeries.push(fastEma - slowEma);
	}

	if (macdSeries.length < signal) return null;
	const macdLine = macdSeries[macdSeries.length - 1];
	if (macdLine === undefined) return null;

	const kSignal = 2 / (signal + 1);
	let signalSmaSum = 0;
	for (let i = 0; i < signal; i += 1) {
		const value = macdSeries[i];
		if (value === undefined) return null;
		signalSmaSum += value;
	}
	let signalEma = signalSmaSum / signal;
	let prevSignalEma = signalEma;
	for (let i = signal; i < macdSeries.length; i += 1) {
		const value = macdSeries[i];
		if (value === undefined) return null;
		prevSignalEma = signalEma;
		signalEma = value * kSignal + signalEma * (1 - kSignal);
	}

	const hist = macdLine - signalEma;
	const prevMacdValue = macdSeries.length >= 2 ? macdSeries[macdSeries.length - 2] : undefined;
	const prevMacd = prevMacdValue === undefined ? null : prevMacdValue;
	const prevHist = prevMacd !== null ? prevMacd - prevSignalEma : null;

	return {
		macd: macdLine,
		signal: signalEma,
		hist,
		histDelta: prevHist === null ? null : hist - prevHist,
	};
}
