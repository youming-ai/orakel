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
