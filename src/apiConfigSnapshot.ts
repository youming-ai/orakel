import { CONFIG } from "./config.ts";

export interface ApiConfigSnapshot {
	strategy: typeof CONFIG.strategy;
	strategies: typeof CONFIG.strategies;
	enabledTimeframes: typeof CONFIG.enabledTimeframes;
	paperRisk: typeof CONFIG.paperRisk;
	liveRisk: typeof CONFIG.liveRisk;
	clobBaseUrl: string;
	paperDailyLossLimitUsdc: number;
	liveDailyLossLimitUsdc: number;
}

export function getApiConfigSnapshot(): ApiConfigSnapshot {
	return {
		strategy: CONFIG.strategy,
		strategies: CONFIG.strategies,
		enabledTimeframes: [...CONFIG.enabledTimeframes],
		paperRisk: { ...CONFIG.paperRisk },
		liveRisk: { ...CONFIG.liveRisk },
		clobBaseUrl: CONFIG.clobBaseUrl,
		paperDailyLossLimitUsdc: Number(CONFIG.paperRisk.dailyMaxLossUsdc || 0),
		liveDailyLossLimitUsdc: Number(CONFIG.liveRisk.dailyMaxLossUsdc || 0),
	};
}
