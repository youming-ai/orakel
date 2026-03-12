import { redeemPositions } from "../cli/commands.ts";
import { createLogger } from "../core/logger.ts";

const log = createLogger("redeemer");

export async function runRedemption(): Promise<{ ok: boolean; error?: string }> {
	log.info("Running CTF redemption");
	const result = await redeemPositions();
	if (!result.ok) {
		log.warn("Redemption failed", { error: result.error });
		return { ok: false, error: result.error };
	}
	log.info("Redemption completed", { durationMs: result.durationMs });
	return { ok: true };
}
