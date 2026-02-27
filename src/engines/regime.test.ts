import { describe, expect, it } from "vitest";
import {
	detectEnhancedRegime,
	detectRegime,
	RegimeTransitionTracker,
	shouldTradeBasedOnRegimeConfidence,
} from "./regime.ts";

describe("detectRegime", () => {
	it("should return CHOP with 'missing_inputs' when price is null", () => {
		const result = detectRegime({
			price: null,
			vwap: 100,
			vwapSlope: 0.5,
			vwapCrossCount: 1,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("CHOP");
		expect(result.reason).toBe("missing_inputs");
	});

	it("should return CHOP with 'missing_inputs' when vwap is null", () => {
		const result = detectRegime({
			price: 100,
			vwap: null,
			vwapSlope: 0.5,
			vwapCrossCount: 1,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("CHOP");
		expect(result.reason).toBe("missing_inputs");
	});

	it("should return CHOP with 'missing_inputs' when vwapSlope is null", () => {
		const result = detectRegime({
			price: 100,
			vwap: 100,
			vwapSlope: null,
			vwapCrossCount: 1,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("CHOP");
		expect(result.reason).toBe("missing_inputs");
	});

	it("should return CHOP with 'low_volume_flat' when volume is low and price near vwap", () => {
		const result = detectRegime({
			price: 100.05,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 1,
			volumeRecent: 500,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("CHOP");
		expect(result.reason).toBe("low_volume_flat");
	});

	it("should return TREND_UP when price > vwap and slope > 0", () => {
		const result = detectRegime({
			price: 105,
			vwap: 100,
			vwapSlope: 0.5,
			vwapCrossCount: 1,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("TREND_UP");
		expect(result.reason).toBe("price_above_vwap_slope_up");
	});

	it("should return TREND_DOWN when price < vwap and slope < 0", () => {
		const result = detectRegime({
			price: 95,
			vwap: 100,
			vwapSlope: -0.5,
			vwapCrossCount: 1,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("TREND_DOWN");
		expect(result.reason).toBe("price_below_vwap_slope_down");
	});

	it("should return CHOP with 'frequent_vwap_cross' when crossCount >= 3", () => {
		const result = detectRegime({
			price: 100,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 3,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("CHOP");
		expect(result.reason).toBe("frequent_vwap_cross");
	});

	it("should return CHOP with 'frequent_vwap_cross' when crossCount > 3", () => {
		const result = detectRegime({
			price: 100,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 5,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("CHOP");
		expect(result.reason).toBe("frequent_vwap_cross");
	});

	it("should return RANGE when crossCount = 2 (not >= 3)", () => {
		const result = detectRegime({
			price: 100,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 2,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("RANGE");
		expect(result.reason).toBe("default");
	});

	it("should return RANGE as default when price > vwap but slope < 0", () => {
		const result = detectRegime({
			price: 105,
			vwap: 100,
			vwapSlope: -0.5,
			vwapCrossCount: 1,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("RANGE");
		expect(result.reason).toBe("default");
	});

	it("should return RANGE as default when price < vwap but slope > 0", () => {
		const result = detectRegime({
			price: 95,
			vwap: 100,
			vwapSlope: 0.5,
			vwapCrossCount: 1,
			volumeRecent: 1000,
			volumeAvg: 1000,
		});
		expect(result.regime).toBe("RANGE");
		expect(result.reason).toBe("default");
	});

	it("should not trigger low_volume_flat when volumeRecent is null", () => {
		const result = detectRegime({
			price: 100.05,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 1,
			volumeRecent: null,
			volumeAvg: 1000,
		});
		expect(result.regime).not.toBe("CHOP");
		expect(result.reason).not.toBe("low_volume_flat");
	});

	it("should not trigger low_volume_flat when volumeAvg is null", () => {
		const result = detectRegime({
			price: 100.05,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 1,
			volumeRecent: 500,
			volumeAvg: null,
		});
		expect(result.regime).not.toBe("CHOP");
		expect(result.reason).not.toBe("low_volume_flat");
	});

	it("should not trigger low_volume_flat when volume is sufficient", () => {
		const result = detectRegime({
			price: 100.05,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 1,
			volumeRecent: 700,
			volumeAvg: 1000,
		});
		expect(result.regime).not.toBe("CHOP");
		expect(result.reason).not.toBe("low_volume_flat");
	});

	it("should not trigger low_volume_flat when price is far from vwap", () => {
		const result = detectRegime({
			price: 110,
			vwap: 100,
			vwapSlope: 0.1,
			vwapCrossCount: 1,
			volumeRecent: 500,
			volumeAvg: 1000,
		});
		expect(result.regime).not.toBe("CHOP");
		expect(result.reason).not.toBe("low_volume_flat");
	});
});

function makeEnhancedParams(
	overrides: Partial<Parameters<typeof detectEnhancedRegime>[0]> = {},
): Parameters<typeof detectEnhancedRegime>[0] {
	return {
		price: 101,
		vwap: 100,
		vwapSlope: 0.02,
		vwapCrossCount: 1,
		volumeRecent: 1400,
		volumeAvg: 1000,
		rsi: 72,
		macdHist: 0.3,
		transitionTracker: null,
		...overrides,
	};
}

describe("detectEnhancedRegime", () => {
	it("should keep base regime classification from detectRegime", () => {
		const result = detectEnhancedRegime(makeEnhancedParams());
		expect(result.regime).toBe("TREND_UP");
		expect(result.reason).toBe("price_above_vwap_slope_up");
	});

	it("should increase trend confidence when price-vwap distance grows", () => {
		const near = detectEnhancedRegime(makeEnhancedParams({ price: 100.15 }));
		const far = detectEnhancedRegime(makeEnhancedParams({ price: 103 }));
		expect(far.confidence).toBeGreaterThan(near.confidence);
	});

	it("should increase trend confidence with steeper vwap slope", () => {
		const weakSlope = detectEnhancedRegime(makeEnhancedParams({ vwapSlope: 0.003 }));
		const steepSlope = detectEnhancedRegime(makeEnhancedParams({ vwapSlope: 0.03 }));
		expect(steepSlope.confidence).toBeGreaterThan(weakSlope.confidence);
	});

	it("should increase trend confidence with stronger volume ratio", () => {
		const lowVolume = detectEnhancedRegime(makeEnhancedParams({ volumeRecent: 800, volumeAvg: 1000 }));
		const highVolume = detectEnhancedRegime(makeEnhancedParams({ volumeRecent: 2200, volumeAvg: 1000 }));
		expect(highVolume.confidence).toBeGreaterThan(lowVolume.confidence);
	});

	it("should increase trend confidence when RSI is extreme", () => {
		const neutralRsi = detectEnhancedRegime(makeEnhancedParams({ rsi: 55 }));
		const extremeRsi = detectEnhancedRegime(makeEnhancedParams({ rsi: 82 }));
		expect(extremeRsi.confidence).toBeGreaterThan(neutralRsi.confidence);
	});

	it("should increase trend confidence when MACD histogram magnitude is larger", () => {
		const weakMacd = detectEnhancedRegime(makeEnhancedParams({ macdHist: 0.02 }));
		const strongMacd = detectEnhancedRegime(makeEnhancedParams({ macdHist: 0.35 }));
		expect(strongMacd.confidence).toBeGreaterThan(weakMacd.confidence);
	});

	it("should produce high CHOP confidence when chop evidence is strong", () => {
		const result = detectEnhancedRegime(
			makeEnhancedParams({
				price: 100,
				vwap: 100,
				vwapSlope: 0,
				vwapCrossCount: 6,
				volumeRecent: 450,
				volumeAvg: 1000,
				rsi: 50,
				macdHist: 0,
			}),
		);
		expect(result.regime).toBe("CHOP");
		expect(result.confidence).toBeGreaterThan(0.6);
	});

	it("should clamp confidence to [0, 1]", () => {
		const result = detectEnhancedRegime(
			makeEnhancedParams({
				price: 120,
				vwap: 100,
				vwapSlope: 0.2,
				volumeRecent: 10000,
				volumeAvg: 100,
				rsi: 95,
				macdHist: 4,
			}),
		);
		expect(result.confidence).toBeGreaterThanOrEqual(0);
		expect(result.confidence).toBeLessThanOrEqual(1);
	});

	it("should include transition probabilities when tracker is provided", () => {
		const tracker = new RegimeTransitionTracker();
		tracker.record("RANGE");
		tracker.record("TREND_UP");
		tracker.record("CHOP");
		tracker.record("TREND_UP");
		tracker.record("TREND_DOWN");
		const result = detectEnhancedRegime(makeEnhancedParams({ transitionTracker: tracker }));
		expect(result.transitionProb).toBeDefined();
		expect(result.transitionProb?.CHOP).toBeCloseTo(0.5, 8);
		expect(result.transitionProb?.TREND_DOWN).toBeCloseTo(0.5, 8);
	});

	it("should omit transition probabilities when tracker is missing", () => {
		const result = detectEnhancedRegime(makeEnhancedParams({ transitionTracker: null }));
		expect(result.transitionProb).toBeUndefined();
	});
});

describe("RegimeTransitionTracker", () => {
	it("should return all-zero probabilities with insufficient history", () => {
		const tracker = new RegimeTransitionTracker();
		tracker.record("TREND_UP");
		const probs = tracker.getTransitionProbabilities("TREND_UP");
		expect(probs.TREND_UP).toBe(0);
		expect(probs.TREND_DOWN).toBe(0);
		expect(probs.RANGE).toBe(0);
		expect(probs.CHOP).toBe(0);
	});

	it("should compute frequency-based transition probabilities", () => {
		const tracker = new RegimeTransitionTracker();
		tracker.record("TREND_UP");
		tracker.record("TREND_DOWN");
		tracker.record("TREND_UP");
		tracker.record("RANGE");
		tracker.record("TREND_UP");
		tracker.record("RANGE");

		const probs = tracker.getTransitionProbabilities("TREND_UP");
		expect(probs.TREND_DOWN).toBeCloseTo(1 / 3, 8);
		expect(probs.RANGE).toBeCloseTo(2 / 3, 8);
		expect(probs.CHOP).toBe(0);
		expect(probs.TREND_UP).toBe(0);
	});

	it("should only use transitions from the requested source regime", () => {
		const tracker = new RegimeTransitionTracker();
		tracker.record("RANGE");
		tracker.record("TREND_UP");
		tracker.record("RANGE");
		tracker.record("CHOP");

		const probs = tracker.getTransitionProbabilities("RANGE");
		expect(probs.TREND_UP).toBeCloseTo(0.5, 8);
		expect(probs.CHOP).toBeCloseTo(0.5, 8);
		expect(probs.TREND_DOWN).toBe(0);
	});

	it("should honor ring buffer maxHistory when recording transitions", () => {
		const tracker = new RegimeTransitionTracker(4);
		tracker.record("TREND_UP");
		tracker.record("TREND_DOWN");
		tracker.record("RANGE");
		tracker.record("CHOP");
		tracker.record("RANGE");

		const probs = tracker.getTransitionProbabilities("TREND_UP");
		expect(probs.TREND_DOWN).toBe(0);
		expect(probs.RANGE).toBe(0);
		expect(probs.CHOP).toBe(0);
		expect(probs.TREND_UP).toBe(0);
	});
});

describe("shouldTradeBasedOnRegimeConfidence", () => {
	it("should skip trade for high-confidence CHOP", () => {
		const result = shouldTradeBasedOnRegimeConfidence({
			regime: "CHOP",
			confidence: 0.7,
			reason: "frequent_vwap_cross",
		});
		expect(result.shouldTrade).toBe(false);
		expect(result.reason).toBe("high_confidence_chop");
		expect(result.useRangeMultiplier).toBe(false);
	});

	it("should allow trade for low-confidence CHOP", () => {
		const result = shouldTradeBasedOnRegimeConfidence({
			regime: "CHOP",
			confidence: 0.4,
			reason: "frequent_vwap_cross",
		});
		expect(result.shouldTrade).toBe(true);
		expect(result.reason).toBe("ok");
	});

	it("should weaken trend multiplier for low-confidence trend", () => {
		const result = shouldTradeBasedOnRegimeConfidence({
			regime: "TREND_UP",
			confidence: 0.3,
			reason: "price_above_vwap_slope_up",
		});
		expect(result.shouldTrade).toBe(true);
		expect(result.reason).toBe("low_confidence_trend");
		expect(result.useRangeMultiplier).toBe(true);
	});

	it("should keep normal behavior for high-confidence trend", () => {
		const result = shouldTradeBasedOnRegimeConfidence({
			regime: "TREND_DOWN",
			confidence: 0.75,
			reason: "price_below_vwap_slope_down",
		});
		expect(result.shouldTrade).toBe(true);
		expect(result.reason).toBe("ok");
		expect(result.useRangeMultiplier).toBe(false);
	});
});
