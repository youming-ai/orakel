import { clamp } from "../core/utils.ts";

export function computeRsi(closes: (number | null)[], period: number): number | null {
	if (period <= 0) return null;
	if (!Array.isArray(closes) || closes.length < period + 1) return null;

	let avgGain = 0;
	let avgLoss = 0;
	for (let i = 1; i <= period; i += 1) {
		const diff = Number(closes[i]) - Number(closes[i - 1]);
		if (diff > 0) avgGain += diff;
		else avgLoss += -diff;
	}
	avgGain /= period;
	avgLoss /= period;

	for (let i = period + 1; i < closes.length; i += 1) {
		const diff = Number(closes[i]) - Number(closes[i - 1]);
		const gain = diff > 0 ? diff : 0;
		const loss = diff < 0 ? -diff : 0;
		avgGain = (avgGain * (period - 1) + gain) / period;
		avgLoss = (avgLoss * (period - 1) + loss) / period;
	}

	if (avgLoss === 0) return 100;
	const rs = avgGain / avgLoss;
	const rsi = 100 - 100 / (1 + rs);
	return clamp(rsi, 0, 100);
}

export function sma(values: number[], period: number): number | null {
	if (!Array.isArray(values) || values.length < period) return null;
	const slice = values.slice(values.length - period);
	const sum = slice.reduce((a, b) => a + b, 0);
	return sum / period;
}

export function slopeLast(values: number[], points: number): number | null {
	if (points <= 1) return null;
	if (!Array.isArray(values) || values.length < points) return null;
	const slice = values.slice(values.length - points);
	const first = Number(slice[0]);
	const last = Number(slice[slice.length - 1]);
	return (last - first) / (points - 1);
}
