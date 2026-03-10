import fs from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { ConfigUpdateDto } from "../contracts/config.ts";
import type { AppConfig, RiskConfig, StrategyConfig } from "./configTypes.ts";
import { env } from "./env.ts";
import { createLogger } from "./logger.ts";
import { MARKETS } from "./markets.ts";

const log = createLogger("config");

// Config reload listeners
type ConfigReloadListener = () => void;
const reloadListeners: Set<ConfigReloadListener> = new Set();

export function onConfigReload(listener: ConfigReloadListener): void {
	reloadListeners.add(listener);
}

export function offConfigReload(listener: ConfigReloadListener): void {
	reloadListeners.delete(listener);
}

const RISK_DEFAULTS = {
	maxTradeSizeUsdc: 1,
	limitDiscount: 0.05,
	dailyMaxLossUsdc: 10,
	maxOpenPositions: 2,
	minLiquidity: 15_000,
	maxTradesPerWindow: 1,
};

const STRATEGY_DEFAULTS: {
	edgeThresholdEarly: number;
	edgeThresholdMid: number;
	edgeThresholdLate: number;
	minProbEarly: number;
	minProbMid: number;
	minProbLate: number;
	maxGlobalTradesPerWindow: number;
	skipMarkets: string[];
} = {
	edgeThresholdEarly: 0.05,
	edgeThresholdMid: 0.1,
	edgeThresholdLate: 0.2,
	minProbEarly: 0.55,
	minProbMid: 0.6,
	minProbLate: 0.65,
	maxGlobalTradesPerWindow: 1,
	skipMarkets: [],
};

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
		edgeThresholdEarly: z.coerce.number().min(0).max(1).optional(),
		edgeThresholdMid: z.coerce.number().min(0).max(1).optional(),
		edgeThresholdLate: z.coerce.number().min(0).max(1).optional(),
		minProbEarly: z.coerce.number().min(0).max(1).optional(),
		minProbMid: z.coerce.number().min(0).max(1).optional(),
		minProbLate: z.coerce.number().min(0).max(1).optional(),
		maxGlobalTradesPerWindow: z.coerce.number().int().min(1).optional(),
		skipMarkets: z.array(z.string()).optional(),
		minTimeLeftMin: z.coerce.number().min(0).optional(),
		maxTimeLeftMin: z.coerce.number().min(0).optional(),
		minVolatility15m: z.coerce.number().min(0).optional(),
		maxVolatility15m: z.coerce.number().min(0).optional(),
		candleAggregationMinutes: z.coerce.number().int().min(1).optional(),
		minPriceToBeatMovePct: z.coerce.number().min(0).optional(),
		minExpectedEdge: z.coerce.number().min(0).max(1).optional(),
		maxEntryPrice: z.coerce.number().min(0).max(1).optional(),
		taWeightEarly: z.coerce.number().min(0).max(1).optional(),
		taWeightLate: z.coerce.number().min(0).max(1).optional(),
		chopEdgeMultiplier: z.coerce.number().min(1).optional(),
		skipChop: z.coerce.boolean().optional(),
	})
	.partial()
	.transform((value) => ({
		...STRATEGY_DEFAULTS,
		...value,
		skipMarkets: value.skipMarkets ?? [],
	}));

const ConfigFileSchema = z
	.object({
		paper: z
			.object({
				risk: RiskConfigSchema.optional(),
			})
			.partial()
			.optional(),
		live: z
			.object({
				risk: RiskConfigSchema.optional(),
			})
			.partial()
			.optional(),
		strategy: z.unknown().optional(),
		risk: RiskConfigSchema.optional(),
	})
	.transform((value) => {
		const rawStrategy = value.strategy;
		let defaultStrategy: z.infer<typeof StrategyConfigSchema>;
		const perMarketStrategy: Record<string, z.infer<typeof StrategyConfigSchema>> = {};

		if (isObject(rawStrategy) && "default" in rawStrategy) {
			defaultStrategy = StrategyConfigSchema.parse(rawStrategy.default ?? {});
			for (const [key, val] of Object.entries(rawStrategy)) {
				if (key !== "default") {
					perMarketStrategy[key] = StrategyConfigSchema.parse(val ?? {});
				}
			}
		} else {
			defaultStrategy = StrategyConfigSchema.parse(rawStrategy ?? {});
		}

		return {
			paper: {
				risk: RiskConfigSchema.parse(value.paper?.risk ?? {}),
			},
			live: {
				risk: RiskConfigSchema.parse(value.live?.risk ?? {}),
			},
			strategy: defaultStrategy,
			perMarketStrategy,
			risk: value.risk,
		};
	});

type ConfigFile = z.infer<typeof ConfigFileSchema>;
const STRATEGY_PATCH_KEYS = new Set<keyof StrategyConfig>([
	"edgeThresholdEarly",
	"edgeThresholdMid",
	"edgeThresholdLate",
	"minProbEarly",
	"minProbMid",
	"minProbLate",
	"maxGlobalTradesPerWindow",
	"skipMarkets",
	"minTimeLeftMin",
	"maxTimeLeftMin",
	"maxVolatility15m",
	"minVolatility15m",
	"candleAggregationMinutes",
	"minPriceToBeatMovePct",
	"minExpectedEdge",
	"maxEntryPrice",
]);

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asObject(value: unknown): Record<string, unknown> {
	return isObject(value) ? value : {};
}

function hasNestedStrategy(value: Record<string, unknown>): boolean {
	return "default" in value;
}

function splitStrategyPatch(strategyPatch: Record<string, unknown>): {
	defaultPatch: Record<string, unknown>;
	perMarketPatches: Record<string, Record<string, unknown>>;
} {
	const defaultPatch: Record<string, unknown> = {};
	const perMarketPatches: Record<string, Record<string, unknown>> = {};
	const treatAsNested =
		"default" in strategyPatch ||
		Object.entries(strategyPatch).some(
			([key, value]) => !STRATEGY_PATCH_KEYS.has(key as keyof StrategyConfig) && isObject(value),
		);

	if (!treatAsNested) {
		return {
			defaultPatch: strategyPatch,
			perMarketPatches,
		};
	}

	for (const [key, value] of Object.entries(strategyPatch)) {
		if (key === "default" && isObject(value)) {
			Object.assign(defaultPatch, value);
			continue;
		}

		if (!STRATEGY_PATCH_KEYS.has(key as keyof StrategyConfig) && isObject(value)) {
			perMarketPatches[key] = value;
			continue;
		}

		defaultPatch[key] = value;
	}

	return {
		defaultPatch,
		perMarketPatches,
	};
}

export function validateConfigFile(data: unknown): void {
	ConfigFileSchema.parse(data);
}

export function readConfigFileObject(configPath: string): Record<string, unknown> {
	const raw = fs.readFileSync(configPath, "utf8");
	const parsed: unknown = JSON.parse(raw);
	if (!isObject(parsed)) {
		throw new Error("config file must be a JSON object");
	}
	return parsed;
}

export function applyConfigUpdate(currentConfigValue: unknown, patch: ConfigUpdateDto): Record<string, unknown> {
	const currentConfig = asObject(currentConfigValue);
	const currentPaper = asObject(currentConfig.paper);
	const currentPaperRisk = asObject(currentPaper.risk);
	const currentLive = asObject(currentConfig.live);
	const currentLiveRisk = asObject(currentLive.risk);
	const currentStrategy = asObject(currentConfig.strategy);
	const { defaultPatch, perMarketPatches } = splitStrategyPatch(asObject(patch.strategy));
	const defaultStrategyBase = hasNestedStrategy(currentStrategy) ? asObject(currentStrategy.default) : currentStrategy;

	let nextStrategy: Record<string, unknown>;
	if (hasNestedStrategy(currentStrategy) || Object.keys(perMarketPatches).length > 0) {
		nextStrategy = {
			...currentStrategy,
			default: {
				...defaultStrategyBase,
				...defaultPatch,
			},
		};

		for (const [marketId, marketPatch] of Object.entries(perMarketPatches)) {
			nextStrategy[marketId] = {
				...asObject(currentStrategy[marketId]),
				...marketPatch,
			};
		}
	} else {
		nextStrategy = {
			...defaultStrategyBase,
			...defaultPatch,
		};
	}

	const updated = {
		...currentConfig,
		strategy: nextStrategy,
		paper: {
			...currentPaper,
			risk: {
				...currentPaperRisk,
				...asObject(patch.paperRisk),
			},
		},
		live: {
			...currentLive,
			risk: {
				...currentLiveRisk,
				...asObject(patch.liveRisk),
			},
		},
	};

	validateConfigFile(updated);
	return updated;
}

export async function persistConfigUpdate(configPath: string, patch: ConfigUpdateDto): Promise<AppConfig> {
	const currentConfig = readConfigFileObject(configPath);
	const updated = applyConfigUpdate(currentConfig, patch);
	await atomicWriteConfig(configPath, updated);
	return reloadConfig();
}

function readJsonConfig(): ConfigFile {
	try {
		const raw = fs.readFileSync("./config.json", "utf8");
		const parsed: unknown = JSON.parse(raw);
		const config = isObject(parsed) ? parsed : {};

		if (config.risk && !config.paper && !config.live) {
			try {
				fs.writeFileSync("./config.json.bak", JSON.stringify(config, null, 2));
			} catch (err) {
				log.warn("Failed to write config.json.bak:", err);
			}
			const { risk, ...rest } = config;
			const migrated = {
				...rest,
				paper: { risk },
				live: { risk },
				strategy: config.strategy || {},
			};
			fs.writeFileSync("./config.json", JSON.stringify(migrated, null, 2));
			log.info("Auto-migrated config.json to per-account format (backup: config.json.bak)");
			try {
				return ConfigFileSchema.parse(migrated);
			} catch (parseErr) {
				if (parseErr instanceof z.ZodError) {
					log.warn(`Invalid migrated config.json, using defaults:\n${z.prettifyError(parseErr)}`);
				} else {
					log.warn("Invalid migrated config.json, using defaults:", parseErr);
				}
				return ConfigFileSchema.parse({});
			}
		}

		try {
			return ConfigFileSchema.parse(config);
		} catch (parseErr) {
			if (parseErr instanceof z.ZodError) {
				log.warn(`Invalid config.json, using defaults:\n${z.prettifyError(parseErr)}`);
			} else {
				log.warn("Invalid config.json, using defaults:", parseErr);
			}
			return ConfigFileSchema.parse({});
		}
	} catch (err) {
		log.warn("Failed to read/parse config.json, using defaults:", err);
		return ConfigFileSchema.parse({});
	}
}

const FILE_CONFIG = readJsonConfig();
const FILE_STRATEGY = FILE_CONFIG.strategy;
const FILE_PAPER_RISK = FILE_CONFIG.paper.risk;
const FILE_LIVE_RISK = FILE_CONFIG.live.risk;

const DEFAULT_MARKET = MARKETS.find((m) => m.coin === "BTC") ?? MARKETS[0] ?? null;

function buildRiskConfig(primary: z.infer<typeof RiskConfigSchema>): RiskConfig {
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

	strategy: {
		edgeThresholdEarly: FILE_STRATEGY.edgeThresholdEarly,
		edgeThresholdMid: FILE_STRATEGY.edgeThresholdMid,
		edgeThresholdLate: FILE_STRATEGY.edgeThresholdLate,
		minProbEarly: FILE_STRATEGY.minProbEarly,
		minProbMid: FILE_STRATEGY.minProbMid,
		minProbLate: FILE_STRATEGY.minProbLate,
		maxGlobalTradesPerWindow: FILE_STRATEGY.maxGlobalTradesPerWindow,
		skipMarkets: FILE_STRATEGY.skipMarkets,
		minTimeLeftMin: FILE_STRATEGY.minTimeLeftMin,
		maxTimeLeftMin: FILE_STRATEGY.maxTimeLeftMin,
		minVolatility15m: FILE_STRATEGY.minVolatility15m,
		maxVolatility15m: FILE_STRATEGY.maxVolatility15m,
		candleAggregationMinutes: FILE_STRATEGY.candleAggregationMinutes,
		minPriceToBeatMovePct: FILE_STRATEGY.minPriceToBeatMovePct,
		minExpectedEdge: FILE_STRATEGY.minExpectedEdge,
		maxEntryPrice: FILE_STRATEGY.maxEntryPrice,
	},

	// Legacy combined risk (backward compat — prefer paperRisk/liveRisk)
	risk: buildRiskConfig(FILE_PAPER_RISK),

	paperRisk: buildRiskConfig(FILE_PAPER_RISK),
	liveRisk: buildRiskConfig(FILE_LIVE_RISK),
};

let perMarketStrategy: Record<string, z.infer<typeof StrategyConfigSchema>> = FILE_CONFIG.perMarketStrategy;

export function getStrategyForMarket(marketId: string): StrategyConfig {
	const overrides = perMarketStrategy[marketId];
	if (!overrides) return CONFIG.strategy;
	return { ...CONFIG.strategy, ...overrides };
}

export function reloadConfig(): AppConfig {
	const fileConfig = readJsonConfig();
	const fileStrategy = fileConfig.strategy;
	const filePaperRisk = fileConfig.paper.risk;
	const fileLiveRisk = fileConfig.live.risk;

	CONFIG.strategy = {
		edgeThresholdEarly: fileStrategy.edgeThresholdEarly,
		edgeThresholdMid: fileStrategy.edgeThresholdMid,
		edgeThresholdLate: fileStrategy.edgeThresholdLate,
		minProbEarly: fileStrategy.minProbEarly,
		minProbMid: fileStrategy.minProbMid,
		minProbLate: fileStrategy.minProbLate,
		maxGlobalTradesPerWindow: fileStrategy.maxGlobalTradesPerWindow,
		skipMarkets: fileStrategy.skipMarkets,
		minTimeLeftMin: fileStrategy.minTimeLeftMin,
		maxTimeLeftMin: fileStrategy.maxTimeLeftMin,
		minVolatility15m: fileStrategy.minVolatility15m,
		maxVolatility15m: fileStrategy.maxVolatility15m,
		candleAggregationMinutes: fileStrategy.candleAggregationMinutes,
		minPriceToBeatMovePct: fileStrategy.minPriceToBeatMovePct,
		minExpectedEdge: fileStrategy.minExpectedEdge,
		maxEntryPrice: fileStrategy.maxEntryPrice,
	};

	perMarketStrategy = fileConfig.perMarketStrategy;

	CONFIG.risk = buildRiskConfig(filePaperRisk);
	CONFIG.paperRisk = buildRiskConfig(filePaperRisk);
	CONFIG.liveRisk = buildRiskConfig(fileLiveRisk);

	// Notify all listeners that config has been reloaded
	for (const listener of reloadListeners) {
		try {
			listener();
		} catch (err) {
			log.error("Config reload listener error:", err);
		}
	}

	return CONFIG;
}

// Start watching config.json for changes
let configWatcherInitialized = false;
export function startConfigWatcher(): void {
	if (configWatcherInitialized) return;
	configWatcherInitialized = true;

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	try {
		fs.watch("./config.json", { persistent: false }, (eventType) => {
			if (eventType === "change") {
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					log.info("config.json changed, reloading...");
					try {
						reloadConfig();
						log.info("Config reloaded successfully");
					} catch (err) {
						log.error("Failed to reload config:", err);
					}
				}, 300);
			}
		});
		log.info("Config watcher started for config.json");
	} catch (err) {
		log.warn("Failed to start config watcher (file may not exist yet):", err);
	}
}

/**
 * P1-6: Atomic config write — write to temp file then rename.
 * Prevents partial/corrupt JSON if process crashes mid-write.
 */
export async function atomicWriteConfig(configPath: string, data: unknown): Promise<void> {
	const tmp = `${configPath}.tmp.${Date.now()}`;
	await writeFile(tmp, JSON.stringify(data, null, 2));
	await rename(tmp, configPath);
}
