import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { applyConfigUpdate } from "../core/config.ts";

describe("applyConfigUpdate", () => {
	it("should update default strategy without dropping per-market overrides", () => {
		const currentConfig = {
			paper: {
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.01,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 3,
					minLiquidity: 5000,
					maxTradesPerWindow: 3,
				},
				initialBalance: 1000,
			},
			live: {
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.01,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 3,
					minLiquidity: 5000,
					maxTradesPerWindow: 3,
				},
				initialBalance: 2500,
			},
			strategy: {
				default: {
					edgeThresholdEarly: 0.05,
					edgeThresholdMid: 0.1,
					edgeThresholdLate: 0.2,
					minProbEarly: 0.55,
					minProbMid: 0.6,
					minProbLate: 0.65,
					maxGlobalTradesPerWindow: 3,
					skipMarkets: [],
				},
				"BTC-5m": {
					edgeThresholdEarly: 0.04,
					minTimeLeftMin: 1,
				},
			},
		};

		const updated = applyConfigUpdate(currentConfig, {
			strategy: {
				edgeThresholdMid: 0.12,
			},
			paperRisk: {
				maxOpenPositions: 4,
			},
		});

		expect(updated).toEqual({
			paper: {
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.01,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 4,
					minLiquidity: 5000,
					maxTradesPerWindow: 3,
				},
				initialBalance: 1000,
			},
			live: {
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.01,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 3,
					minLiquidity: 5000,
					maxTradesPerWindow: 3,
				},
				initialBalance: 2500,
			},
			strategy: {
				default: {
					edgeThresholdEarly: 0.05,
					edgeThresholdMid: 0.12,
					edgeThresholdLate: 0.2,
					minProbEarly: 0.55,
					minProbMid: 0.6,
					minProbLate: 0.65,
					maxGlobalTradesPerWindow: 3,
					skipMarkets: [],
				},
				"BTC-5m": {
					edgeThresholdEarly: 0.04,
					minTimeLeftMin: 1,
				},
			},
		});
	});

	it("should support nested per-market strategy patches", () => {
		const currentConfig = {
			paper: { risk: {} },
			live: { risk: {} },
			strategy: {
				default: {
					edgeThresholdEarly: 0.05,
					edgeThresholdMid: 0.1,
					edgeThresholdLate: 0.2,
					minProbEarly: 0.55,
					minProbMid: 0.6,
					minProbLate: 0.65,
					maxGlobalTradesPerWindow: 3,
					skipMarkets: [],
				},
				"BTC-1h": {
					minTimeLeftMin: 15,
				},
			},
		};

		const updated = applyConfigUpdate(currentConfig, {
			strategy: {
				default: {
					maxGlobalTradesPerWindow: 2,
				},
				"BTC-1h": {
					maxTimeLeftMin: 28,
				},
			},
		});

		expect(updated).toEqual({
			paper: { risk: {} },
			live: { risk: {} },
			strategy: {
				default: {
					edgeThresholdEarly: 0.05,
					edgeThresholdMid: 0.1,
					edgeThresholdLate: 0.2,
					minProbEarly: 0.55,
					minProbMid: 0.6,
					minProbLate: 0.65,
					maxGlobalTradesPerWindow: 2,
					skipMarkets: [],
				},
				"BTC-1h": {
					minTimeLeftMin: 15,
					maxTimeLeftMin: 28,
				},
			},
		});
	});

	it("should reject invalid strategy updates before write", () => {
		expect(() =>
			applyConfigUpdate(
				{
					paper: { risk: {} },
					live: { risk: {} },
					strategy: {
						default: {
							edgeThresholdEarly: 0.05,
							edgeThresholdMid: 0.1,
							edgeThresholdLate: 0.2,
							minProbEarly: 0.55,
							minProbMid: 0.6,
							minProbLate: 0.65,
							maxGlobalTradesPerWindow: 3,
							skipMarkets: [],
						},
					},
				},
				{
					strategy: {
						maxGlobalTradesPerWindow: 0,
					},
				},
			),
		).toThrow(ZodError);
	});
});
