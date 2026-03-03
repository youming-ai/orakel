import { describe, expect, it } from "vitest";
import { detectRegime } from "./regime.ts";

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
