import { env } from "./env.ts";

// ── types ────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

interface Logger {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

// ── level gate ───────────────────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
};

const threshold = LEVEL_PRIORITY[env.LOG_LEVEL];

// ── factory ──────────────────────────────────────────────

function createLogger(tag: string): Logger {
	const prefix = `[${tag}]`;
	return {
		debug: (...args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.debug) console.debug(prefix, ...args);
		},
		info: (...args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.info) console.log(prefix, ...args);
		},
		warn: (...args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.warn) console.warn(prefix, ...args);
		},
		error: (...args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.error) console.error(prefix, ...args);
		},
	};
}

export { createLogger };
export type { Logger, LogLevel };
