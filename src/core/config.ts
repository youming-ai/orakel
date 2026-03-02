import fs from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { MARKETS } from "../markets.ts";
import type { AppConfig, RiskConfig, StrategyConfig, TimeframeId } from "../types.ts";
import { env } from "./env.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("config");

// ============ Config Reload Listeners ============

type ConfigReloadListener = () => void;
const reloadListeners: Set<ConfigReloadListener> = new Set();

export function onConfigReload(listener: ConfigReloadListener): void {
	reloadListeners.add(listener);
}

export function offConfigReload(listener: ConfigReloadListener): void {
	reloadListeners.delete(listener);
}

// ============ Constants ============

export const TIMEFRAME_IDS: readonly TimeframeId[] = ["15m", "1h", "4h"] as const;

export const TIMEFRAME_WINDOW_MINUTES: Record<TimeframeId, number> = {
	"15m": 15,
	"1h": 60,
	"4h": 240,
};

const RISK_DEFAULTS = {
	maxTradeSizeUsdc: 1,
	limitDiscount: 0.05,
	dailyMaxLossUsdc: 10,
	maxOpenPositions: 2,
	minLiquidity: 15_000,
	maxTradesPerWindow: 1,
};

const STRATEGY_DEFAULTS = {
	edgeThresholdEarly: 0.06,
	edgeThresholdMid: 0.08,
	edgeThresholdLate: 0.1,
	minProbEarly: 0.52,
	minProbMid: 0.55,
	minProbLate: 0.6,
	blendWeights: { vol: 0.5, ta: 0.5 },
	regimeMultipliers: { CHOP: 1.3, RANGE: 1.0, TREND_ALIGNED: 0.8, TREND_OPPOSED: 1.2 },
	skipMarkets: [] as string[],
	minConfidence: 0.5,
	// Extracted strategy constants
	softCapEdge: 0.22,
	hardCapEdge: 0.3,
	arbitrageMinSpread: 0.02,
	arbitrageMaxBoost: 0.05,
	confidenceWeights: {
		indicatorAlignment: 0.2,
		volatilityScore: 0.2,
		orderbookScore: 0.2,
		timingScore: 0.2,
		regimeScore: 0.2,
	},
	maxVig: 0.04,
	kellyFraction: 0.5,
	maxBankrollRisk: 0.25,
	minTradeSize: 0.5,
	fokConfidenceThreshold: 0.7,
	maxVolatility15m: 0.004,
	minVolatility15m: 0.0005,
	safeModeThreshold: 3,
	minTimeLeftMin: 3,
	minTradeQuality: 0.55,
	maxGlobalTradesPerWindow: 1,
};

/**
 * Hardcoded per-timeframe strategy presets.
 * Merged on top of STRATEGY_DEFAULTS for each timeframe.
 * 15m uses defaults (already tuned). 1h/4h adjust thresholds for longer windows.
 */
const TIMEFRAME_STRATEGY_PRESETS: Record<TimeframeId, Partial<StrategyConfig>> = {
	"15m": {
		// 15m is the base — STRATEGY_DEFAULTS are tuned for 15m
	},
	"1h": {
		edgeThresholdEarly: 0.04,
		edgeThresholdMid: 0.06,
		edgeThresholdLate: 0.08,
		minProbEarly: 0.52,
		minProbMid: 0.54,
		minProbLate: 0.58,
		minTimeLeftMin: 10,
		maxVolatility15m: 0.008,
		minVolatility15m: 0.001,
		softCapEdge: 0.18,
		hardCapEdge: 0.25,
		blendWeights: { vol: 0.55, ta: 0.45 },
		confidenceWeights: {
			indicatorAlignment: 0.25,
			volatilityScore: 0.15,
			orderbookScore: 0.1,
			timingScore: 0.2,
			regimeScore: 0.3,
		},
	},
	"4h": {
		edgeThresholdEarly: 0.03,
		edgeThresholdMid: 0.05,
		edgeThresholdLate: 0.07,
		minProbEarly: 0.52,
		minProbMid: 0.53,
		minProbLate: 0.56,
		minTimeLeftMin: 30,
		maxVolatility15m: 0.016,
		minVolatility15m: 0.002,
		softCapEdge: 0.15,
		hardCapEdge: 0.2,
		blendWeights: { vol: 0.6, ta: 0.4 },
		confidenceWeights: {
			indicatorAlignment: 0.2,
			volatilityScore: 0.15,
			orderbookScore: 0.05,
			timingScore: 0.25,
			regimeScore: 0.35,
		},
	},
};

// ============ Zod Schemas ============

const RiskConfigSchema = z
	.object({
		maxTradeSizeUsdc: z.coerce.number().optional(),
		limitDiscount: z.coerce.number().optional(),
		dailyMaxLossUsdc: z.coerce.number().optional(),
		maxOpenPositions: z.coerce.number().optional(),
		minLiquidity: z.coerce.number().optional(),
		maxTradesPerWindow: z.coerce.number().optional(),
	})
	.partial()
	.transform((value) => ({ ...RISK_DEFAULTS, ...value }));

const StrategyConfigSchema = z
	.object({
		edgeThresholdEarly: z.coerce.number().optional(),
		edgeThresholdMid: z.coerce.number().optional(),
		edgeThresholdLate: z.coerce.number().optional(),
		minProbEarly: z.coerce.number().optional(),
		minProbMid: z.coerce.number().optional(),
		minProbLate: z.coerce.number().optional(),
		blendWeights: z
			.object({
				vol: z.coerce.number().optional(),
				ta: z.coerce.number().optional(),
			})
			.partial()
			.optional(),
		regimeMultipliers: z
			.object({
				CHOP: z.coerce.number().optional(),
				RANGE: z.coerce.number().optional(),
				TREND_ALIGNED: z.coerce.number().optional(),
				TREND_OPPOSED: z.coerce.number().optional(),
			})
			.partial()
			.optional(),
		skipMarkets: z.array(z.string()).optional(),
		minConfidence: z.coerce.number().optional(),
		marketPerformance: z
			.record(
				z.string(),
				z.object({
					winRate: z.coerce.number(),
					edgeMultiplier: z.coerce.number(),
					minProb: z.coerce.number().optional(),
					minConfidence: z.coerce.number().optional(),
					skipChop: z.boolean().optional(),
				}),
			)
			.optional(),
		softCapEdge: z.coerce.number().optional(),
		hardCapEdge: z.coerce.number().optional(),
		arbitrageMinSpread: z.coerce.number().optional(),
		arbitrageMaxBoost: z.coerce.number().optional(),
		confidenceWeights: z
			.object({
				indicatorAlignment: z.coerce.number().optional(),
				volatilityScore: z.coerce.number().optional(),
				orderbookScore: z.coerce.number().optional(),
				timingScore: z.coerce.number().optional(),
				regimeScore: z.coerce.number().optional(),
			})
			.partial()
			.optional(),
		maxVig: z.coerce.number().optional(),
		kellyFraction: z.coerce.number().optional(),
		maxBankrollRisk: z.coerce.number().optional(),
		minTradeSize: z.coerce.number().optional(),
		fokConfidenceThreshold: z.coerce.number().optional(),
		maxVolatility15m: z.coerce.number().optional(),
		minVolatility15m: z.coerce.number().optional(),
		safeModeThreshold: z.coerce.number().optional(),
		minTimeLeftMin: z.coerce.number().optional(),
		minTradeQuality: z.coerce.number().optional(),
		maxGlobalTradesPerWindow: z.coerce.number().optional(),
	})
	.partial()
	.transform((value) => ({
		...STRATEGY_DEFAULTS,
		...value,
		blendWeights: { ...STRATEGY_DEFAULTS.blendWeights, ...value.blendWeights },
		regimeMultipliers: { ...STRATEGY_DEFAULTS.regimeMultipliers, ...value.regimeMultipliers },
		confidenceWeights: { ...STRATEGY_DEFAULTS.confidenceWeights, ...value.confidenceWeights },
		skipMarkets: value.skipMarkets ?? [],
		marketPerformance: value.marketPerformance ?? {},
	}));

// V1 config file schema (existing flat format)
const ConfigFileV1Schema = z
	.object({
		paper: z
			.object({
				risk: RiskConfigSchema.optional(),
				initialBalance: z.coerce.number().optional(),
			})
			.partial()
			.optional(),
		live: z
			.object({
				risk: RiskConfigSchema.optional(),
			})
			.partial()
			.optional(),
		strategy: StrategyConfigSchema.optional(),
		risk: RiskConfigSchema.optional(),
	})
	.transform((value) => ({
		paper: {
			risk: RiskConfigSchema.parse(value.paper?.risk ?? {}),
			initialBalance: value.paper?.initialBalance ?? 1000,
		},
		live: {
			risk: RiskConfigSchema.parse(value.live?.risk ?? {}),
		},
		strategy: StrategyConfigSchema.parse(value.strategy ?? {}),
		risk: value.risk,
	}));

// V2 config file schema (per-timeframe strategies)
const TimeframeIdSchema = z.enum(["15m", "1h", "4h"]);

const ConfigFileV2Schema = z.object({
	version: z.literal(2),
	enabledTimeframes: z.array(TimeframeIdSchema).optional(),
	strategies: z.record(z.string(), z.record(z.string(), z.unknown()).optional()).optional(),
	paper: z
		.object({
			risk: RiskConfigSchema.optional(),
			initialBalance: z.coerce.number().optional(),
		})
		.partial()
		.optional(),
	live: z
		.object({
			risk: RiskConfigSchema.optional(),
		})
		.partial()
		.optional(),
});

// ============ Deep Merge Helpers ============

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge strategy layers. Rules (per Oracle review):
 * - Objects: deep merge (one level — blendWeights, confidenceWeights, regimeMultipliers)
 * - Arrays: replace (skipMarkets replaces, not concatenates)
 * - undefined: does NOT overwrite existing values
 */
function deepMergeStrategy(...layers: (Partial<StrategyConfig> | undefined)[]): Partial<StrategyConfig> {
	const result: Record<string, unknown> = {};
	for (const layer of layers) {
		if (!layer) continue;
		for (const [key, value] of Object.entries(layer)) {
			if (value === undefined) continue;
			const existing = result[key];
			if (isPlainObject(existing) && isPlainObject(value)) {
				result[key] = { ...existing, ...value };
			} else {
				result[key] = value;
			}
		}
	}
	return result as Partial<StrategyConfig>;
}

/**
 * Resolve a complete StrategyConfig for a given timeframe.
 * Merge order: STRATEGY_DEFAULTS → timeframe preset → user overrides
 * StrategyConfigSchema.parse() applies STRATEGY_DEFAULTS as base.
 */
function resolveStrategyForTimeframe(timeframe: TimeframeId, userOverrides?: Partial<StrategyConfig>): StrategyConfig {
	const merged = deepMergeStrategy(TIMEFRAME_STRATEGY_PRESETS[timeframe], userOverrides);
	return StrategyConfigSchema.parse(merged) as StrategyConfig;
}

// ============ Internal Types ============

interface ParsedConfig {
	strategy: StrategyConfig;
	strategies: Record<TimeframeId, StrategyConfig>;
	enabledTimeframes: TimeframeId[];
	paper: { risk: z.infer<typeof RiskConfigSchema>; initialBalance: number };
	live: { risk: z.infer<typeof RiskConfigSchema> };
	legacyRisk?: z.infer<typeof RiskConfigSchema>;
}

// ============ Config Reading ============

function readRawJson(): Record<string, unknown> {
	try {
		const raw = fs.readFileSync("./config.json", "utf8");
		const parsed: unknown = JSON.parse(raw);
		return isPlainObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function parseConfigV1(config: Record<string, unknown>): ParsedConfig {
	// V0→V1 migration: flat risk → paper/live split
	if (config.risk && !config.paper && !config.live) {
		try {
			fs.writeFileSync("./config.json.bak", JSON.stringify(config, null, 2));
		} catch (err) {
			log.warn("Failed to write config.json.bak:", err);
		}
		const { risk, ...rest } = config;
		const migrated = {
			...rest,
			paper: { risk, initialBalance: 1000 },
			live: { risk },
			strategy: config.strategy || {},
		};
		fs.writeFileSync("./config.json", JSON.stringify(migrated, null, 2));
		log.info("Auto-migrated config.json to per-account format (backup: config.json.bak)");
		config = migrated;
	}

	let v1: z.infer<typeof ConfigFileV1Schema>;
	try {
		v1 = ConfigFileV1Schema.parse(config);
	} catch (parseErr) {
		if (parseErr instanceof z.ZodError) {
			log.warn(`Invalid config.json, using defaults:\n${z.prettifyError(parseErr)}`);
		} else {
			log.warn("Invalid config.json, using defaults:", parseErr);
		}
		v1 = ConfigFileV1Schema.parse({});
	}

	// V1: single strategy applies to 15m. Build all timeframes from it.
	// 15m uses the user's strategy directly. 1h/4h get timeframe presets (no user overrides).
	const strategies: Record<TimeframeId, StrategyConfig> = {
		"15m": v1.strategy as StrategyConfig,
		"1h": resolveStrategyForTimeframe("1h"),
		"4h": resolveStrategyForTimeframe("4h"),
	};

	return {
		strategy: v1.strategy as StrategyConfig,
		strategies,
		enabledTimeframes: ["15m"],
		paper: v1.paper,
		live: v1.live,
		legacyRisk: v1.risk,
	};
}

function parseConfigV2(config: Record<string, unknown>): ParsedConfig {
	let v2: z.infer<typeof ConfigFileV2Schema>;
	try {
		v2 = ConfigFileV2Schema.parse(config);
	} catch (parseErr) {
		if (parseErr instanceof z.ZodError) {
			log.warn(`Invalid V2 config.json, falling back to V1:\n${z.prettifyError(parseErr)}`);
		} else {
			log.warn("Invalid V2 config.json, falling back to V1:", parseErr);
		}
		return parseConfigV1(config);
	}

	const enabledTimeframes: TimeframeId[] = v2.enabledTimeframes ?? ["15m", "1h", "4h"];
	const rawStrategies = v2.strategies ?? {};

	// Resolve each timeframe: DEFAULTS → timeframe preset → user config overrides
	const strategies: Record<TimeframeId, StrategyConfig> = {} as Record<TimeframeId, StrategyConfig>;
	for (const tf of TIMEFRAME_IDS) {
		const userOverrides = rawStrategies[tf] as Partial<StrategyConfig> | undefined;
		strategies[tf] = resolveStrategyForTimeframe(tf, userOverrides);
	}

	return {
		strategy: strategies["15m"],
		strategies,
		enabledTimeframes,
		paper: {
			risk: RiskConfigSchema.parse(v2.paper?.risk ?? {}),
			initialBalance: v2.paper?.initialBalance ?? 1000,
		},
		live: {
			risk: RiskConfigSchema.parse(v2.live?.risk ?? {}),
		},
	};
}

function readJsonConfig(): ParsedConfig {
	try {
		const config = readRawJson();

		// Detect V2
		if (config.version === 2) {
			log.info("Detected V2 config format (per-timeframe strategies)");
			return parseConfigV2(config);
		}

		// V1 (legacy) or empty
		return parseConfigV1(config);
	} catch (err) {
		log.warn("Failed to read/parse config.json, using defaults:", err);
		return parseConfigV1({});
	}
}

// ============ CONFIG Singleton ============

const PARSED = readJsonConfig();

const DEFAULT_MARKET = MARKETS.find((m) => m.id === "BTC") ?? MARKETS[0] ?? null;

function buildRiskConfig(
	primary: z.infer<typeof RiskConfigSchema>,
	_fallback?: z.infer<typeof RiskConfigSchema>,
): RiskConfig {
	return {
		maxTradeSizeUsdc: primary.maxTradeSizeUsdc,
		limitDiscount: primary.limitDiscount,
		dailyMaxLossUsdc: primary.dailyMaxLossUsdc,
		maxOpenPositions: primary.maxOpenPositions,
		minLiquidity: primary.minLiquidity,
		maxTradesPerWindow: primary.maxTradesPerWindow,
	};
}

export const CONFIG: AppConfig = {
	markets: MARKETS,
	binanceBaseUrl: "https://api.binance.com",
	gammaBaseUrl: "https://gamma-api.polymarket.com",
	clobBaseUrl: "https://clob.polymarket.com",

	pollIntervalMs: 1_000,
	candleWindowMinutes: 15,

	vwapSlopeLookbackMinutes: 5,
	rsiPeriod: 14,
	rsiMaPeriod: 14,

	macdFast: 12,
	macdSlow: 26,
	macdSignal: 9,

	paperMode: env.PAPER_MODE,

	polymarket: {
		marketSlug: env.POLYMARKET_SLUG,
		autoSelectLatest: env.POLYMARKET_AUTO_SELECT_LATEST,
		liveDataWsUrl: env.POLYMARKET_LIVE_WS_URL,
		upOutcomeLabel: env.POLYMARKET_UP_LABEL,
		downOutcomeLabel: env.POLYMARKET_DOWN_LABEL,
	},

	chainlink: {
		polygonRpcUrls: env.POLYGON_RPC_URLS,
		polygonRpcUrl: env.POLYGON_RPC_URL,
		polygonWssUrls: env.POLYGON_WSS_URLS,
		polygonWssUrl: env.POLYGON_WSS_URL,
		btcUsdAggregator: env.CHAINLINK_BTC_USD_AGGREGATOR || DEFAULT_MARKET?.chainlink?.aggregator || "",
	},

	// Backward compat: CONFIG.strategy = 15m strategy (most consumers read this)
	strategy: PARSED.strategy,

	// Legacy combined risk (backward compat — prefer paperRisk/liveRisk)
	risk: buildRiskConfig(PARSED.paper.risk, PARSED.legacyRisk),
	paperRisk: buildRiskConfig(PARSED.paper.risk, PARSED.legacyRisk),
	liveRisk: buildRiskConfig(PARSED.live.risk, PARSED.legacyRisk),

	// Multi-timeframe: all resolved strategies + which are enabled
	strategies: PARSED.strategies,
	enabledTimeframes: PARSED.enabledTimeframes,
};

export const PAPER_INITIAL_BALANCE: number = PARSED.paper.initialBalance;

// ============ Runtime: getConfigForTimeframe ============

/**
 * Returns a shallow copy of CONFIG with strategy and candleWindowMinutes
 * set for the specified timeframe. Used by the market loop to process
 * each timeframe with the correct parameters.
 *
 * All other fields (risk, polymarket, chainlink, etc.) are shared.
 */
export function getConfigForTimeframe(timeframe: TimeframeId): AppConfig {
	return {
		...CONFIG,
		strategy: CONFIG.strategies[timeframe],
		candleWindowMinutes: TIMEFRAME_WINDOW_MINUTES[timeframe],
	};
}

// ============ Runtime: Reload ============

function notifyListeners(): void {
	for (const listener of reloadListeners) {
		try {
			listener();
		} catch (err) {
			log.error("Config reload listener error:", err);
		}
	}
}

export function reloadConfig(): AppConfig {
	const parsed = readJsonConfig();

	// P1-7: Preserve runtime-only fields that are not in config.json
	const prevMarketPerformance = CONFIG.strategy.marketPerformance;

	// Update per-timeframe strategies
	for (const tf of TIMEFRAME_IDS) {
		const resolved = parsed.strategies[tf];
		if (tf === "15m" && prevMarketPerformance) {
			resolved.marketPerformance = prevMarketPerformance;
		}
		CONFIG.strategies[tf] = resolved;
	}

	// Backward compat: CONFIG.strategy = 15m
	CONFIG.strategy = CONFIG.strategies["15m"];
	CONFIG.enabledTimeframes = parsed.enabledTimeframes;
	CONFIG.candleWindowMinutes = TIMEFRAME_WINDOW_MINUTES["15m"];

	// Risk
	CONFIG.risk = buildRiskConfig(parsed.paper.risk, parsed.legacyRisk);
	CONFIG.paperRisk = buildRiskConfig(parsed.paper.risk, parsed.legacyRisk);
	CONFIG.liveRisk = buildRiskConfig(parsed.live.risk, parsed.legacyRisk);

	notifyListeners();
	return CONFIG;
}

// ============ Runtime: Config Watcher ============

let configWatcherInitialized = false;
export function startConfigWatcher(): void {
	if (configWatcherInitialized) return;
	configWatcherInitialized = true;

	try {
		fs.watch("./config.json", { persistent: false }, (eventType) => {
			if (eventType === "change") {
				log.info("config.json changed, reloading...");
				try {
					reloadConfig();
					log.info("Config reloaded successfully");
				} catch (err) {
					log.error("Failed to reload config:", err);
				}
			}
		});
		log.info("Config watcher started for config.json");
	} catch (err) {
		log.warn("Failed to start config watcher (file may not exist yet):", err);
	}
}

// ============ Runtime: Atomic Write ============

/**
 * P1-6: Atomic config write — write to temp file then rename.
 * Prevents partial/corrupt JSON if process crashes mid-write.
 */
export async function atomicWriteConfig(configPath: string, data: unknown): Promise<void> {
	const tmp = `${configPath}.tmp.${Date.now()}`;
	await writeFile(tmp, JSON.stringify(data, null, 2));
	await rename(tmp, configPath);
}
