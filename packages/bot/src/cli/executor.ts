import { createLogger } from "../core/logger.ts";
import type { CliResult } from "./types.ts";

const log = createLogger("cli");

export function parseCliOutput<T>(raw: string): T | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		return null;
	}
}

export type CliErrorClass = "transient" | "permanent" | "fatal";

export function classifyCliError(message: string): CliErrorClass {
	const lower = message.toLowerCase();
	if (lower.includes("authentication") || lower.includes("auth fail") || lower.includes("not found")) {
		return "fatal";
	}
	if (lower.includes("insufficient") || lower.includes("invalid token") || lower.includes("invalid order")) {
		return "permanent";
	}
	return "transient";
}

export async function execCli<T>(
	args: string[],
	opts: { timeoutMs?: number; retries?: number; parseJson?: boolean } = {},
): Promise<CliResult<T>> {
	const { timeoutMs = 10_000, retries = 1, parseJson = true } = opts;
	let lastError = "";

	for (let attempt = 0; attempt <= retries; attempt++) {
		const start = Date.now();
		try {
			const proc = Bun.spawn(["polymarket", "-o", "json", ...args], {
				stdout: "pipe",
				stderr: "pipe",
				timeout: timeoutMs,
			});

			const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
			const exitCode = await proc.exited;
			const durationMs = Date.now() - start;

			if (exitCode !== 0) {
				lastError = stderr.trim() || stdout.trim() || `exit code ${exitCode}`;
				const errorClass = classifyCliError(lastError);
				if (errorClass !== "transient" || attempt >= retries) {
					log.warn("CLI command failed", { args, exitCode, error: lastError, errorClass });
					return { ok: false, error: lastError, durationMs };
				}
				log.warn("CLI transient error, retrying", { args, attempt: attempt + 1, error: lastError });
				continue;
			}

			const data = parseJson ? parseCliOutput<T>(stdout) : (undefined as T | undefined);
			return { ok: true, data: data ?? undefined, durationMs };
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			const durationMs = Date.now() - start;
			if (attempt >= retries) {
				log.error("CLI execution error", { args, error: lastError });
				return { ok: false, error: lastError, durationMs };
			}
		}
	}

	return { ok: false, error: lastError, durationMs: 0 };
}
