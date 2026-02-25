import fs from "node:fs";
import { z } from "zod";
import { env } from "./env.ts";
import { createLogger } from "./logger.ts";
import { MARKETS } from "./markets.ts";

const log = createLogger("config");

import type { AppConfig, RiskConfig } from "./types.ts";

export const PERSIST_BACKEND = env.PERSIST_BACKEND;
export const READ_BACKEND = env.READ_BACKEND;

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
	blendWeights: { vol: number; ta: number };
	regimeMultipliers: { CHOP: number; RANGE: number; TREND_ALIGNED: number; TREND_OPPOSED: number };
	skipMarkets: string[];
	minConfidence: number;
	downBiasMultiplier: number;
} = {
	edgeThresholdEarly: 0.08,
	edgeThresholdMid: 0.1,
	edgeThresholdLate: 0.12,
	minProbEarly: 0.58,
	minProbMid: 0.6,
	minProbLate: 0.7,
	blendWeights: { vol: 0.5, ta: 0.5 },
	regimeMultipliers: { CHOP: 1.5, RANGE: 1.0, TREND_ALIGNED: 0.8, TREND_OPPOSED: 1.3 },
	skipMarkets: [],
	minConfidence: 0.5,
	downBiasMultiplier: 0.03,
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
		downBiasMultiplier: z.coerce.number().optional(),
	})
	.partial()
	.transform((value) => ({
		...STRATEGY_DEFAULTS,
		...value,
		blendWeights: { ...STRATEGY_DEFAULTS.blendWeights, ...value.blendWeights },
		regimeMultipliers: { ...STRATEGY_DEFAULTS.regimeMultipliers, ...value.regimeMultipliers },
		skipMarkets: value.skipMarkets ?? [],
	}));

const ConfigFileSchema = z
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

type ConfigFile = z.infer<typeof ConfigFileSchema>;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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
				paper: { risk, initialBalance: 1000 },
				live: { risk },
				strategy: config.strategy || {},
			};
			fs.writeFileSync("./config.json", JSON.stringify(migrated, null, 2));
			log.info("Auto-migrated config.json to per-account format (backup: config.json.bak)");
			try {
				return ConfigFileSchema.parse(migrated);
			} catch (parseErr) {
				if (parseErr instanceof z.ZodError) {
					log.warn("Invalid migrated config.json, using defaults:\n" + z.prettifyError(parseErr));
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
				log.warn("Invalid config.json, using defaults:\n" + z.prettifyError(parseErr));
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
const FILE_LEGACY_RISK = FILE_CONFIG.risk;

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
	persistBackend: PERSIST_BACKEND,
	readBackend: READ_BACKEND,

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
		blendWeights: FILE_STRATEGY.blendWeights,
		regimeMultipliers: FILE_STRATEGY.regimeMultipliers,
		skipMarkets: FILE_STRATEGY.skipMarkets,
		minConfidence: FILE_STRATEGY.minConfidence,
		downBiasMultiplier: FILE_STRATEGY.downBiasMultiplier,
	},

	// Legacy combined risk (backward compat — prefer paperRisk/liveRisk)
	risk: buildRiskConfig(FILE_PAPER_RISK, FILE_LEGACY_RISK),

	paperRisk: buildRiskConfig(FILE_PAPER_RISK, FILE_LEGACY_RISK),
	liveRisk: buildRiskConfig(FILE_LIVE_RISK, FILE_LEGACY_RISK),
};

export const PAPER_INITIAL_BALANCE: number = FILE_CONFIG.paper.initialBalance;

export function reloadConfig(): AppConfig {
	const fileConfig = readJsonConfig();
	const fileStrategy = fileConfig.strategy;
	const filePaperRisk = fileConfig.paper.risk;
	const fileLiveRisk = fileConfig.live.risk;
	const fileRisk = fileConfig.risk;

	CONFIG.strategy = {
		edgeThresholdEarly: fileStrategy.edgeThresholdEarly,
		edgeThresholdMid: fileStrategy.edgeThresholdMid,
		edgeThresholdLate: fileStrategy.edgeThresholdLate,
		minProbEarly: fileStrategy.minProbEarly,
		minProbMid: fileStrategy.minProbMid,
		minProbLate: fileStrategy.minProbLate,
		blendWeights: fileStrategy.blendWeights,
		regimeMultipliers: fileStrategy.regimeMultipliers,
		skipMarkets: fileStrategy.skipMarkets,
		minConfidence: fileStrategy.minConfidence,
		downBiasMultiplier: fileStrategy.downBiasMultiplier,
	};

	CONFIG.risk = buildRiskConfig(filePaperRisk, fileRisk);
	CONFIG.paperRisk = buildRiskConfig(filePaperRisk, fileRisk);
	CONFIG.liveRisk = buildRiskConfig(fileLiveRisk, fileRisk);

	return CONFIG;
}
