import type { MacdResult } from "../types.ts";

export function computeMacd(closes: (number | null)[], fast: number, slow: number, signal: number): MacdResult | null {
	if (!Array.isArray(closes) || closes.length < slow + signal) return null;

	const kFast = 2 / (fast + 1);
	const kSlow = 2 / (slow + 1);

	let fastEma = Number(closes[0]);
	let slowEma = Number(closes[0]);
	const macdSeries: number[] = [];

	for (let i = 1; i < closes.length; i += 1) {
		const val = Number(closes[i]);
		fastEma = val * kFast + fastEma * (1 - kFast);
		slowEma = val * kSlow + slowEma * (1 - kSlow);
		if (i >= slow - 1) {
			macdSeries.push(fastEma - slowEma);
		}
	}

	const macdLine = fastEma - slowEma;

	if (macdSeries.length < signal) return null;

	const kSignal = 2 / (signal + 1);
	let signalEma = Number(macdSeries[0]);
	let prevSignalEma = signalEma;
	for (let i = 1; i < macdSeries.length; i += 1) {
		prevSignalEma = signalEma;
		signalEma = Number(macdSeries[i]) * kSignal + signalEma * (1 - kSignal);
	}

	const hist = macdLine - signalEma;
	const prevMacd = macdSeries.length >= 2 ? Number(macdSeries[macdSeries.length - 2]) : null;
	const prevHist = prevMacd !== null ? prevMacd - prevSignalEma : null;

	return {
		macd: macdLine,
		signal: signalEma,
		hist,
		histDelta: prevHist === null ? null : hist - prevHist,
	};
}
