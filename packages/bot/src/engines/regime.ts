import { REGIME_DEFAULTS } from "../core/config.ts";
import type { RegimeConfig } from "../core/configTypes.ts";
import type { RegimeResult } from "../trading/tradeTypes.ts";

interface RegimeInput {
	price: number | null;
	vwap: number | null;
	vwapSlope: number | null;
	vwapCrossCount: number | null;
	volumeRecent: number | null;
	volumeAvg: number | null;
	regimeConfig?: Partial<RegimeConfig>;
}

export function detectRegime({
	price,
	vwap,
	vwapSlope,
	vwapCrossCount,
	volumeRecent,
	volumeAvg,
	regimeConfig,
}: RegimeInput): RegimeResult {
	const cfg = { ...REGIME_DEFAULTS, ...regimeConfig };
	if (price === null || vwap === null || vwapSlope === null) return { regime: "CHOP", reason: "missing_inputs" };

	const above = price > vwap;

	const lowVolume = volumeRecent !== null && volumeAvg !== null ? volumeRecent < cfg.lowVolumeRatio * volumeAvg : false;
	if (lowVolume && vwap !== 0 && Math.abs((price - vwap) / vwap) < cfg.vwapProximityThreshold) {
		return { regime: "CHOP", reason: "low_volume_flat" };
	}

	if (above && vwapSlope > 0) {
		return { regime: "TREND_UP", reason: "price_above_vwap_slope_up" };
	}

	if (!above && vwapSlope < 0) {
		return { regime: "TREND_DOWN", reason: "price_below_vwap_slope_down" };
	}

	if (vwapCrossCount !== null && vwapCrossCount >= cfg.vwapCrossCountThreshold) {
		return { regime: "CHOP", reason: "frequent_vwap_cross" };
	}

	return { regime: "RANGE", reason: "default" };
}
