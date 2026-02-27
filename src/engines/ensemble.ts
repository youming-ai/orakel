import type { Regime } from "../types.ts";
import { clamp } from "../utils.ts";

export interface ModelPrediction {
	name: string;
	probUp: number;
	weight: number;
	available: boolean;
}

export interface EnsembleResult {
	finalUp: number;
	finalDown: number;
	models: ModelPrediction[];
	dominantModel: string;
	agreement: number;
}

function isTrend(regime: Regime | null): boolean {
	return regime === "TREND_UP" || regime === "TREND_DOWN";
}

function confidenceToWeight(confidence: string): number {
	if (confidence === "HIGH") return 0.35;
	if (confidence === "MEDIUM") return 0.2;
	if (confidence === "LOW") return 0.1;
	return 0;
}

function computeAgreement(models: ModelPrediction[]): number {
	const probs = models.filter((model) => model.available).map((model) => model.probUp);
	if (probs.length <= 1) return 1;

	const mean = probs.reduce((sum, value) => sum + value, 0) / probs.length;
	const variance = probs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / probs.length;
	const stddev = Math.sqrt(variance);
	return clamp(1 - stddev * 2, 0, 1);
}

export function computeEnsemble(params: {
	volImpliedUp: number | null;
	taRawUp: number;
	blendedUp: number;
	blendSource: string;
	signalQualityWinRate: number | null;
	signalQualityConfidence: string;
	regime: Regime | null;
	volatility15m: number | null;
	orderbookImbalance: number | null;
}): EnsembleResult {
	const models: ModelPrediction[] = [
		{
			name: "vol_implied",
			probUp: clamp(params.volImpliedUp ?? 0.5, 0.01, 0.99),
			weight: params.volImpliedUp !== null ? 0.35 : 0,
			available: params.volImpliedUp !== null,
		},
		{
			name: "ta_score",
			probUp: clamp(params.taRawUp, 0.01, 0.99),
			weight: 0.3,
			available: true,
		},
		{
			name: "blended",
			probUp: clamp(params.blendedUp, 0.01, 0.99),
			weight: params.blendSource === "ta_only" ? 0 : 0.35,
			available: params.blendSource !== "ta_only",
		},
		{
			name: "signal_quality",
			probUp: clamp(params.signalQualityWinRate ?? 0.5, 0.01, 0.99),
			weight: params.signalQualityWinRate !== null ? confidenceToWeight(params.signalQualityConfidence) : 0,
			available: params.signalQualityWinRate !== null && params.signalQualityConfidence !== "INSUFFICIENT",
		},
	];

	for (const model of models) {
		if (!model.available || model.weight <= 0) continue;
		if (model.name === "signal_quality" && params.regime === "CHOP") {
			model.weight *= 1.3;
		}
		if (model.name === "vol_implied" && isTrend(params.regime)) {
			model.weight *= 1.2;
		}
		if (model.name === "vol_implied" && params.volatility15m !== null && params.volatility15m > 0.008) {
			model.weight *= 1.1;
		}
	}

	const totalWeight = models.reduce((sum, model) => sum + (model.available ? model.weight : 0), 0);
	if (totalWeight <= 0) {
		const fallbackUp = clamp(params.taRawUp, 0.01, 0.99);
		return {
			finalUp: fallbackUp,
			finalDown: 1 - fallbackUp,
			models,
			dominantModel: "ta_score",
			agreement: computeAgreement(models),
		};
	}

	let finalUp =
		models.reduce((sum, model) => {
			if (!model.available) return sum;
			const normalizedWeight = model.weight / totalWeight;
			model.weight = normalizedWeight;
			return sum + model.probUp * normalizedWeight;
		}, 0) ?? 0.5;

	if (params.orderbookImbalance !== null && Math.abs(params.orderbookImbalance) > 0.3) {
		finalUp += params.orderbookImbalance > 0 ? 0.01 : -0.01;
	}

	finalUp = clamp(finalUp, 0.01, 0.99);
	const sortedByWeight = [...models].sort((a, b) => b.weight - a.weight);

	return {
		finalUp,
		finalDown: 1 - finalUp,
		models,
		dominantModel: sortedByWeight[0]?.name ?? "ta_score",
		agreement: computeAgreement(models),
	};
}
