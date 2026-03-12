export interface StrategyConfig {
	edgeThresholdEarly: number;
	edgeThresholdMid: number;
	edgeThresholdLate: number;
	phaseEarlySeconds: number;
	phaseLateSeconds: number;
	sigmoidScale: number;
	minVolatility: number;
	maxEntryPrice: number;
	minTimeLeftSeconds: number;
	maxTimeLeftSeconds: number;
}

export interface ExecutionConfig {
	orderType: string;
	limitDiscount: number;
	minOrderPrice: number;
	maxOrderPrice: number;
}

export interface InfraConfig {
	pollIntervalMs: number;
	cliTimeoutMs: number;
	cliRetries: number;
	binanceRestUrl: string;
	binanceWsUrl: string;
	bybitRestUrl: string;
	bybitWsUrl: string;
	polymarketGammaUrl: string;
	polymarketClobUrl: string;
	polymarketClobWsUrl: string;
	slugPrefix: string;
	windowSeconds: number;
}

export interface MaintenanceConfig {
	signalLogRetentionDays: number;
	pruneIntervalMs: number;
	redeemIntervalMs: number;
}

export interface AppConfig {
	strategy: StrategyConfig;
	risk: { paper: RiskConfigDto; live: RiskConfigDto };
	execution: ExecutionConfig;
	infra: InfraConfig;
	maintenance: MaintenanceConfig;
}

export interface RiskConfigDto {
	maxTradeSizeUsdc: number;
	dailyMaxLossUsdc: number;
	maxOpenPositions: number;
	maxTradesPerWindow: number;
}

export interface ConfigSnapshotDto {
	strategy: StrategyConfig;
	risk: { paper: RiskConfigDto; live: RiskConfigDto };
	execution: ExecutionConfig;
}

export interface ConfigUpdateDto {
	strategy?: Partial<StrategyConfig>;
	risk?: {
		paper?: Partial<RiskConfigDto>;
		live?: Partial<RiskConfigDto>;
	};
}
