import fs from "node:fs";
import { MARKETS } from "./markets.ts";
import type { AppConfig, RiskConfig, StorageBackend } from "./types.ts";

const PERSIST_BACKENDS: StorageBackend[] = ["csv", "dual", "sqlite"];
const READ_BACKENDS: Exclude<StorageBackend, "dual">[] = ["csv", "sqlite"];

function parsePersistBackend(value: string | undefined): StorageBackend {
  if (!value) return "sqlite";
  const normalized = value.toLowerCase();
  return PERSIST_BACKENDS.includes(normalized as StorageBackend) ? (normalized as StorageBackend) : "sqlite";
}

function parseReadBackend(value: string | undefined): Exclude<StorageBackend, "dual"> {
  if (!value) return "sqlite";
  const normalized = value.toLowerCase();
  return READ_BACKENDS.includes(normalized as Exclude<StorageBackend, "dual">)
    ? (normalized as Exclude<StorageBackend, "dual">)
    : "sqlite";
}

export const PERSIST_BACKEND: StorageBackend = parsePersistBackend(process.env.PERSIST_BACKEND);
export const READ_BACKEND: Exclude<StorageBackend, "dual"> = parseReadBackend(process.env.READ_BACKEND);

function readJsonConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync("./config.json", "utf8");
    const parsed: unknown = JSON.parse(raw);
    const config = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

    if (config.risk && !config.paper && !config.live) {
      try { fs.writeFileSync("./config.json.bak", JSON.stringify(config, null, 2)); } catch {}
      const migrated: Record<string, unknown> = {
        ...config,
        paper: { risk: config.risk, initialBalance: 1000 },
        live: { risk: config.risk },
        strategy: config.strategy || {},
      };
      delete migrated.risk;
      fs.writeFileSync("./config.json", JSON.stringify(migrated, null, 2));
      console.log("[config] Auto-migrated config.json to per-account format (backup: config.json.bak)");
      return migrated;
    }

    return config;
  } catch {
    return {};
  }
}

const FILE_CONFIG = readJsonConfig();
const FILE_STRATEGY = FILE_CONFIG.strategy && typeof FILE_CONFIG.strategy === "object" ? (FILE_CONFIG.strategy as Record<string, unknown>) : {};


const FILE_PAPER = FILE_CONFIG.paper && typeof FILE_CONFIG.paper === "object" ? (FILE_CONFIG.paper as Record<string, unknown>) : {};
const FILE_LIVE = FILE_CONFIG.live && typeof FILE_CONFIG.live === "object" ? (FILE_CONFIG.live as Record<string, unknown>) : {};
const FILE_PAPER_RISK = FILE_PAPER.risk && typeof FILE_PAPER.risk === "object" ? (FILE_PAPER.risk as Record<string, unknown>) : {};
const FILE_LIVE_RISK = FILE_LIVE.risk && typeof FILE_LIVE.risk === "object" ? (FILE_LIVE.risk as Record<string, unknown>) : {};

// Legacy top-level risk (for backward compat / migration fallback)
const FILE_RISK = FILE_CONFIG.risk && typeof FILE_CONFIG.risk === "object" ? (FILE_CONFIG.risk as Record<string, unknown>) : {};

const DEFAULT_MARKET = MARKETS.find((m) => m.id === "BTC") ?? MARKETS[0] ?? null;

function buildRiskConfig(source: Record<string, unknown>, fallback: Record<string, unknown>): RiskConfig {
  return {
    maxTradeSizeUsdc: Number(source.maxTradeSizeUsdc ?? fallback.maxTradeSizeUsdc ?? 1),
    limitDiscount: Number(source.limitDiscount ?? fallback.limitDiscount ?? 0.05),
    dailyMaxLossUsdc: Number(source.dailyMaxLossUsdc ?? fallback.dailyMaxLossUsdc ?? 10),
    maxOpenPositions: Number(source.maxOpenPositions ?? fallback.maxOpenPositions ?? 2),
    minLiquidity: Number(source.minLiquidity ?? fallback.minLiquidity ?? 15_000),
    maxTradesPerWindow: Number(source.maxTradesPerWindow ?? fallback.maxTradesPerWindow ?? 1),
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

  paperMode: (process.env.PAPER_MODE || "false").toLowerCase() === "true",
  persistBackend: PERSIST_BACKEND,
  readBackend: READ_BACKEND,

  polymarket: {
    marketSlug: process.env.POLYMARKET_SLUG || "",
    autoSelectLatest: (process.env.POLYMARKET_AUTO_SELECT_LATEST || "true").toLowerCase() === "true",
    liveDataWsUrl: process.env.POLYMARKET_LIVE_WS_URL || "wss://ws-live-data.polymarket.com",
    upOutcomeLabel: process.env.POLYMARKET_UP_LABEL || "Up",
    downOutcomeLabel: process.env.POLYMARKET_DOWN_LABEL || "Down"
  },

  chainlink: {
    polygonRpcUrls: (process.env.POLYGON_RPC_URLS || "").split(",").map((s) => s.trim()).filter(Boolean),
    polygonRpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    polygonWssUrls: (process.env.POLYGON_WSS_URLS || "").split(",").map((s) => s.trim()).filter(Boolean),
    polygonWssUrl: process.env.POLYGON_WSS_URL || "",
    btcUsdAggregator: process.env.CHAINLINK_BTC_USD_AGGREGATOR || DEFAULT_MARKET?.chainlink?.aggregator || ""
  },

  strategy: {
    edgeThresholdEarly: Number(FILE_STRATEGY.edgeThresholdEarly ?? 0.08),
    edgeThresholdMid: Number(FILE_STRATEGY.edgeThresholdMid ?? 0.1),
    edgeThresholdLate: Number(FILE_STRATEGY.edgeThresholdLate ?? 0.12),
    minProbEarly: Number(FILE_STRATEGY.minProbEarly ?? 0.58),
    minProbMid: Number(FILE_STRATEGY.minProbMid ?? 0.6),
    minProbLate: Number(FILE_STRATEGY.minProbLate ?? 0.7),
    blendWeights: (FILE_STRATEGY.blendWeights as { vol: number; ta: number } | undefined) ?? { vol: 0.5, ta: 0.5 },
    regimeMultipliers: (FILE_STRATEGY.regimeMultipliers as { CHOP: number; RANGE: number; TREND_ALIGNED: number; TREND_OPPOSED: number } | undefined) ?? { CHOP: 1.5, RANGE: 1.0, TREND_ALIGNED: 0.8, TREND_OPPOSED: 1.3 },
    skipMarkets: Array.isArray(FILE_STRATEGY.skipMarkets) ? (FILE_STRATEGY.skipMarkets as string[]) : [],
    minConfidence: Number(FILE_STRATEGY.minConfidence ?? 0.5),
  },

  // Legacy combined risk (backward compat — prefer paperRisk/liveRisk)
  risk: buildRiskConfig(FILE_PAPER_RISK, FILE_RISK),


  paperRisk: buildRiskConfig(FILE_PAPER_RISK, FILE_RISK),
  liveRisk: buildRiskConfig(FILE_LIVE_RISK, FILE_RISK),
};

export const PAPER_INITIAL_BALANCE: number = Number(FILE_PAPER.initialBalance ?? 1000);

export function reloadConfig(): AppConfig {
  const fileConfig = readJsonConfig();
  const fileStrategy = fileConfig.strategy && typeof fileConfig.strategy === "object" ? (fileConfig.strategy as Record<string, unknown>) : {};

  const filePaper = fileConfig.paper && typeof fileConfig.paper === "object" ? (fileConfig.paper as Record<string, unknown>) : {};
  const fileLive = fileConfig.live && typeof fileConfig.live === "object" ? (fileConfig.live as Record<string, unknown>) : {};
  const filePaperRisk = filePaper.risk && typeof filePaper.risk === "object" ? (filePaper.risk as Record<string, unknown>) : {};
  const fileLiveRisk = fileLive.risk && typeof fileLive.risk === "object" ? (fileLive.risk as Record<string, unknown>) : {};
  const fileRisk = fileConfig.risk && typeof fileConfig.risk === "object" ? (fileConfig.risk as Record<string, unknown>) : {};

  CONFIG.strategy = {
    edgeThresholdEarly: Number(fileStrategy.edgeThresholdEarly ?? CONFIG.strategy.edgeThresholdEarly),
    edgeThresholdMid: Number(fileStrategy.edgeThresholdMid ?? CONFIG.strategy.edgeThresholdMid),
    edgeThresholdLate: Number(fileStrategy.edgeThresholdLate ?? CONFIG.strategy.edgeThresholdLate),
    minProbEarly: Number(fileStrategy.minProbEarly ?? CONFIG.strategy.minProbEarly),
    minProbMid: Number(fileStrategy.minProbMid ?? CONFIG.strategy.minProbMid),
    minProbLate: Number(fileStrategy.minProbLate ?? CONFIG.strategy.minProbLate),
    blendWeights: (fileStrategy.blendWeights as { vol: number; ta: number } | undefined) ?? CONFIG.strategy.blendWeights,
    regimeMultipliers: (fileStrategy.regimeMultipliers as { CHOP: number; RANGE: number; TREND_ALIGNED: number; TREND_OPPOSED: number } | undefined) ?? CONFIG.strategy.regimeMultipliers,
    skipMarkets: Array.isArray(fileStrategy.skipMarkets) ? (fileStrategy.skipMarkets as string[]) : CONFIG.strategy.skipMarkets ?? [],
    minConfidence: Number(fileStrategy.minConfidence ?? CONFIG.strategy.minConfidence ?? 0.5),
  };

  CONFIG.risk = buildRiskConfig(filePaperRisk, fileRisk);
  CONFIG.paperRisk = buildRiskConfig(filePaperRisk, fileRisk);
  CONFIG.liveRisk = buildRiskConfig(fileLiveRisk, fileRisk);

  return CONFIG;
}
