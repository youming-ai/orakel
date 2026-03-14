import { z } from "zod";

const EnvSchema = z.object({
	PAPER_MODE: z.coerce.boolean().default(true),
	POLYMARKET_PRIVATE_KEY: z.string().startsWith("0x").optional(),
	DATABASE_URL: z.string().url(),
	API_TOKEN: z.string().min(1).default(""),

	PORT: z.coerce.number().int().positive().default(9999),
	LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function loadEnv(): Env {
	if (_env) return _env;
	const result = EnvSchema.safeParse(process.env);
	if (!result.success) {
		throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
	}
	_env = result.data;
	return _env;
}
