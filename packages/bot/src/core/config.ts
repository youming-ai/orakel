import type { AppConfig, ConfigUpdateDto } from "@orakel/shared/contracts";
import { AppConfigSchema, ConfigUpdateSchema } from "@orakel/shared/contracts";
import { z } from "zod";
import { createLogger } from "./logger.ts";

const log = createLogger("config");

export function parseConfig(raw: string): AppConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("Config is not valid JSON");
	}
	const result = AppConfigSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid config: ${z.prettifyError(result.error)}`);
	}
	return result.data;
}

export function mergeConfigUpdate(base: AppConfig, update: ConfigUpdateDto): AppConfig {
	const validated = ConfigUpdateSchema.parse(update);
	return {
		...base,
		strategy: { ...base.strategy, ...validated.strategy },
		risk: {
			paper: { ...base.risk.paper, ...validated.risk?.paper },
			live: { ...base.risk.live, ...validated.risk?.live },
		},
	};
}

let _config: AppConfig | null = null;

export async function loadConfigFromFile(path: string): Promise<AppConfig> {
	const raw = await Bun.file(path).text();
	_config = parseConfig(raw);
	log.info("Config loaded", { path });
	return _config;
}

export function getConfig(): AppConfig {
	if (!_config) throw new Error("Config not loaded. Call loadConfigFromFile() first.");
	return _config;
}

export function setConfig(config: AppConfig): void {
	_config = config;
}
