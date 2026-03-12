import type { PriceTick } from "../core/types.ts";

export interface SignalParams {
	sigmoidScale: number;
	minVolatility: number;
	epsilon: number;
}

export function sigmoid(z: number): number {
	return 1 / (1 + Math.exp(-z));
}

export function modelProbability(
	priceDeviation: number,
	timeLeftSeconds: number,
	recentVolatility: number,
	params: SignalParams,
): number {
	const timeDecay = timeLeftSeconds / 300;
	const volAdjust = Math.max(recentVolatility, params.minVolatility);
	const z = priceDeviation / (volAdjust * Math.sqrt(1 + timeDecay + params.epsilon));
	const raw = sigmoid(z * params.sigmoidScale);
	return Math.max(0.01, Math.min(0.99, raw));
}

export function computeVolatility(ticks: PriceTick[]): number {
	if (ticks.length < 2) return 0;
	const logReturns: number[] = [];
	for (let i = 1; i < ticks.length; i++) {
		const prev = ticks[i - 1];
		const curr = ticks[i];
		if (prev && curr && prev.price > 0) {
			logReturns.push(Math.log(curr.price / prev.price));
		}
	}
	if (logReturns.length === 0) return 0;
	const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
	const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
	return Math.sqrt(variance);
}
