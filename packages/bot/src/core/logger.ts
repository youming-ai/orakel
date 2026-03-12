type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getMinLevel(): number {
	const raw = process.env.LOG_LEVEL ?? "info";
	return LEVELS[raw as LogLevel] ?? LEVELS.info;
}

export interface Logger {
	debug(msg: string, data?: Record<string, unknown>): void;
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
	const minLevel = getMinLevel();
	const emit = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
		if (LEVELS[level] < minLevel) return;
		const entry = { ts: new Date().toISOString(), level, module, msg, ...data };
		// biome-ignore lint/suspicious/noConsole: logger is the authorized console user
		console.log(JSON.stringify(entry));
	};
	return {
		debug: (msg, data) => emit("debug", msg, data),
		info: (msg, data) => emit("info", msg, data),
		warn: (msg, data) => emit("warn", msg, data),
		error: (msg, data) => emit("error", msg, data),
	};
}
