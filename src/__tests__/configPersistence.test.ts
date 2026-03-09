import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyConfigUpdate, atomicWriteConfig, readConfigFileObject, validateConfigFile } from "../core/config.ts";

const tempDirs: string[] = [];

describe("config persistence round-trip", () => {
	afterEach(async () => {
		for (const dir of tempDirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("should preserve nested strategy structure after write and read", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "orakel-config-"));
		tempDirs.push(dir);
		const configPath = path.join(dir, "config.json");
		const initialConfig = {
			paper: {
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.01,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 3,
					minLiquidity: 5000,
					maxTradesPerWindow: 3,
				},
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
				"BTC-15m": {
					minTimeLeftMin: 3,
					maxTimeLeftMin: 10,
				},
			},
		};

		await writeFile(configPath, JSON.stringify(initialConfig, null, 2));

		const updated = applyConfigUpdate(readConfigFileObject(configPath), {
			strategy: {
				edgeThresholdMid: 0.12,
				"BTC-15m": {
					maxTimeLeftMin: 12,
				},
			},
			liveRisk: {
				maxOpenPositions: 5,
			},
		});

		await atomicWriteConfig(configPath, updated);

		const roundTripped = JSON.parse(await readFile(configPath, "utf8")) as unknown;
		expect(() => validateConfigFile(roundTripped)).not.toThrow();
		expect(roundTripped).toEqual({
			paper: {
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.01,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 3,
					minLiquidity: 5000,
					maxTradesPerWindow: 3,
				},
			},
			live: {
				risk: {
					maxTradeSizeUsdc: 10,
					limitDiscount: 0.01,
					dailyMaxLossUsdc: 100,
					maxOpenPositions: 5,
					minLiquidity: 5000,
					maxTradesPerWindow: 3,
				},
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
				"BTC-15m": {
					minTimeLeftMin: 3,
					maxTimeLeftMin: 12,
				},
			},
		});
	});
});
