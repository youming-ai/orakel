import type { EnhancedRegimeResult, Regime, RegimeResult } from "../types.ts";

interface RegimeInput {
	price: number | null;
	vwap: number | null;
	vwapSlope: number | null;
	vwapCrossCount: number | null;
	volumeRecent: number | null;
	volumeAvg: number | null;
}

export function detectRegime({
	price,
	vwap,
	vwapSlope,
	vwapCrossCount,
	volumeRecent,
	volumeAvg,
}: RegimeInput): RegimeResult {
	if (price === null || vwap === null || vwapSlope === null) return { regime: "CHOP", reason: "missing_inputs" };

	const above = price > vwap;

	const lowVolume = volumeRecent !== null && volumeAvg !== null ? volumeRecent < 0.6 * volumeAvg : false;
	if (lowVolume && Math.abs((price - vwap) / vwap) < 0.001) {
		return { regime: "CHOP", reason: "low_volume_flat" };
	}

	if (above && vwapSlope > 0) {
		return { regime: "TREND_UP", reason: "price_above_vwap_slope_up" };
	}

	if (!above && vwapSlope < 0) {
		return { regime: "TREND_DOWN", reason: "price_below_vwap_slope_down" };
	}

	if (vwapCrossCount !== null && vwapCrossCount >= 3) {
		return { regime: "CHOP", reason: "frequent_vwap_cross" };
	}

	return { regime: "RANGE", reason: "default" };
}

const REGIMES: Regime[] = ["TREND_UP", "TREND_DOWN", "RANGE", "CHOP"];

function clampConfidence(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function emptyTransitionProbabilities(): Record<Regime, number> {
	return {
		TREND_UP: 0,
		TREND_DOWN: 0,
		RANGE: 0,
		CHOP: 0,
	};
}

function computeVolumeRatio(volumeRecent: number | null, volumeAvg: number | null): number | null {
	if (volumeRecent === null || volumeAvg === null || volumeAvg <= 0) return null;
	return volumeRecent / volumeAvg;
}

export class RegimeTransitionTracker {
	private readonly maxHistory: number;
	private readonly observations: Regime[] = [];

	public constructor(maxHistory: number = 100) {
		this.maxHistory = Math.max(2, Math.floor(maxHistory));
	}

	public record(regime: Regime): void {
		this.observations.push(regime);
		if (this.observations.length > this.maxHistory) {
			this.observations.shift();
		}
	}

	public getTransitionProbabilities(currentRegime: Regime): Record<Regime, number> {
		const counts = emptyTransitionProbabilities();
		let total = 0;

		for (let i = 0; i < this.observations.length - 1; i += 1) {
			const from = this.observations[i];
			if (from !== currentRegime) continue;

			const to = this.observations[i + 1];
			if (to === undefined) continue;

			counts[to] += 1;
			total += 1;
		}

		if (total === 0) {
			return counts;
		}

		const probabilities = emptyTransitionProbabilities();
		for (const regime of REGIMES) {
			probabilities[regime] = counts[regime] / total;
		}

		return probabilities;
	}
}

export function detectEnhancedRegime(params: {
	price: number | null;
	vwap: number | null;
	vwapSlope: number | null;
	vwapCrossCount: number | null;
	volumeRecent: number | null;
	volumeAvg: number | null;
	rsi?: number | null;
	macdHist?: number | null;
	transitionTracker?: RegimeTransitionTracker | null;
}): EnhancedRegimeResult {
	const {
		price,
		vwap,
		vwapSlope,
		vwapCrossCount,
		volumeRecent,
		volumeAvg,
		rsi = null,
		macdHist = null,
		transitionTracker = null,
	} = params;

	const baseRegime = detectRegime({
		price,
		vwap,
		vwapSlope,
		vwapCrossCount,
		volumeRecent,
		volumeAvg,
	});

	const priceVsVwap = price !== null && vwap !== null && vwap !== 0 ? Math.abs((price - vwap) / vwap) : 0;
	const distanceScore = clampConfidence(priceVsVwap * 120);
	const slopeScore = clampConfidence(Math.abs(vwapSlope ?? 0) * 250);
	const volumeRatio = computeVolumeRatio(volumeRecent, volumeAvg);
	const volumeScore = volumeRatio === null ? 0.5 : clampConfidence((volumeRatio - 0.8) / 1.2);
	const lowVolumeScore = volumeRatio === null ? 0.5 : clampConfidence((1.1 - volumeRatio) / 0.8);
	const crossScore = clampConfidence((vwapCrossCount ?? 0) / 6);
	const rsiExtremeScore = rsi === null ? 0.5 : clampConfidence((Math.abs(rsi - 50) - 20) / 30);
	const macdMagnitudeScore = macdHist === null ? 0.5 : clampConfidence(Math.abs(macdHist) * 8);

	const trendStrength = clampConfidence(
		distanceScore * 0.28 + slopeScore * 0.24 + volumeScore * 0.18 + rsiExtremeScore * 0.14 + macdMagnitudeScore * 0.16,
	);
	const chopStrength = clampConfidence(
		crossScore * 0.45 + (1 - slopeScore) * 0.2 + (1 - distanceScore) * 0.2 + lowVolumeScore * 0.15,
	);

	let confidence = 0.5;
	if (baseRegime.regime === "TREND_UP" || baseRegime.regime === "TREND_DOWN") {
		confidence = 0.35 + trendStrength * 0.65;
	} else if (baseRegime.regime === "CHOP") {
		confidence = 0.3 + chopStrength * 0.7;
	} else {
		confidence = 0.35 + chopStrength * 0.25 + (1 - trendStrength) * 0.4;
	}

	const transitionProb = transitionTracker?.getTransitionProbabilities(baseRegime.regime);
	transitionTracker?.record(baseRegime.regime);

	return {
		regime: baseRegime.regime,
		confidence: clampConfidence(confidence),
		reason: baseRegime.reason,
		transitionProb,
	};
}

export function shouldTradeBasedOnRegimeConfidence(enhancedRegime: EnhancedRegimeResult): {
	shouldTrade: boolean;
	reason: string;
	useRangeMultiplier: boolean;
} {
	if (enhancedRegime.regime === "CHOP" && enhancedRegime.confidence > 0.6) {
		return { shouldTrade: false, reason: "high_confidence_chop", useRangeMultiplier: false };
	}

	if (
		(enhancedRegime.regime === "TREND_UP" || enhancedRegime.regime === "TREND_DOWN") &&
		enhancedRegime.confidence < 0.4
	) {
		return { shouldTrade: true, reason: "low_confidence_trend", useRangeMultiplier: true };
	}

	return { shouldTrade: true, reason: "ok", useRangeMultiplier: false };
}
