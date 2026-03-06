import type { RiskConfig, StrategyConfig } from "../types.ts";

export type RiskConfigDto = RiskConfig;
export type StrategyConfigDto = StrategyConfig;

export interface ConfigSnapshotDto {
	strategy: Record<string, unknown>;
	paperRisk: RiskConfigDto;
	liveRisk: RiskConfigDto;
}

export interface ConfigUpdateDto {
	strategy?: Record<string, unknown>;
	paperRisk?: Partial<RiskConfigDto>;
	liveRisk?: Partial<RiskConfigDto>;
}
