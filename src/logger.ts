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
	const _prefix = `[${tag}]`;
	return {
		debug: (..._args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.debug)
		},
		info: (..._args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.info)
		},
		warn: (..._args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.warn)
		},
		error: (..._args: unknown[]) => {
			if (threshold <= LEVEL_PRIORITY.error)
		},
	};
}

export { createLogger };
export type { Logger, LogLevel };
