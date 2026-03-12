import { bootstrapApp } from "./app/bootstrap.ts";
import { createLogger } from "./core/logger.ts";

const log = createLogger("main");

async function main(): Promise<void> {
	await bootstrapApp();
}

void main().catch((err: unknown) => {
	log.error("Fatal startup error", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
