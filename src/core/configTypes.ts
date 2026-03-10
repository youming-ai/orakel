export interface MarketConfig {
	id: string;
	coin: string;
	label: string;
	candleWindowMinutes: number;
	resolutionSource: "chainlink" | "binance";
	binanceSymbol: string;
	polymarket: {
		seriesId: string;
		seriesSlug: string;
		slugPrefix: string;
	};
	chainlink: {
		aggregator: string;
		decimals: number;
		wsSymbol: string;
	};
	pricePrecision: number;
}

export interface RiskConfig {
	maxTradeSizeUsdc: number;
	limitDiscount: number;
	dailyMaxLossUsdc: number;
	maxOpenPositions: number;
	minLiquidity: number;
	maxTradesPerWindow: number;
	/** Take-profit threshold as fraction (0.15 = 15% gain). Omit or 0 to disable. */
	takeProfitPercent?: number;
}

export interface StrategyConfig {
	edgeThresholdEarly: number;
	edgeThresholdMid: number;
	edgeThresholdLate: number;
	minProbEarly: number;
	minProbMid: number;
	minProbLate: number;
	maxGlobalTradesPerWindow: number;
	skipMarkets?: string[];
	minTimeLeftMin?: number;
	maxTimeLeftMin?: number;
	maxVolatility15m?: number;
	minVolatility15m?: number;
	candleAggregationMinutes?: number;
	minPriceToBeatMovePct?: number;
	/** Bias added to edgeDown before comparison (default 0) */
	edgeDownBias?: number;
	/** Skip live trades when marketYes is within this range [min, max] */
	liveSkipPriceMin?: number;
	liveSkipPriceMax?: number;
	/** Min cross-exchange price divergence to trigger edge boost (default 0.004 = 0.4%) */
	divergenceThreshold?: number;
	/** Multiplier for divergence-based edge boost (default 0.5) */
	divergenceBoostFactor?: number;
	/** Max edge boost from divergence (default 0.02) */
	divergenceBoostMax?: number;
	/** Minimum expected edge (modelProb - marketProb) to enter a trade (default: undefined = disabled) */
	minExpectedEdge?: number;
	/** Maximum normalized market price for entry — rejects trades where the chosen side's implied prob is too high (default: undefined = disabled) */
	maxEntryPrice?: number;
	/** TA weight at window start when blending TA and PtB probabilities (default 0.7) */
	taWeightEarly?: number;
	/** TA weight at window end when blending TA and PtB probabilities (default 0.3) */
	taWeightLate?: number;
	/** Edge threshold multiplier in CHOP regime (default 1.5 = 50% higher bar) */
	chopEdgeMultiplier?: number;
	/** Skip trades entirely in CHOP regime (default false) */
	skipChop?: boolean;
}

export interface AppConfig {
	markets: MarketConfig[];
	binanceBaseUrl: string;
	gammaBaseUrl: string;
	clobBaseUrl: string;
	pollIntervalMs: number;
	vwapSlopeLookbackMinutes: number;
	rsiPeriod: number;
	rsiMaPeriod: number;
	macdFast: number;
	macdSlow: number;
	macdSignal: number;
	paperMode: boolean;
	polymarket: {
		marketSlug: string;
		autoSelectLatest: boolean;
		liveDataWsUrl: string;
		upOutcomeLabel: string;
		downOutcomeLabel: string;
	};
	chainlink: {
		polygonRpcUrls: string[];
		polygonRpcUrl: string;
		polygonWssUrls: string[];
		polygonWssUrl: string;
		btcUsdAggregator: string;
	};
	strategy: StrategyConfig;
	risk: RiskConfig;
	paperRisk: RiskConfig;
	liveRisk: RiskConfig;
}
