import { createLogger } from "../core/logger.ts";
import { kvQueries } from "../db/queries.ts";

const log = createLogger("live-settler-store");
const REDEEMED_TRADE_IDS_KEY = "redeemed_trade_ids";

export async function loadRedeemedTradeIds(): Promise<Set<string>> {
	const redeemedIds = new Set<string>();

	try {
		const json = await kvQueries.get(REDEEMED_TRADE_IDS_KEY);
		if (!json) {
			return redeemedIds;
		}

		const data = JSON.parse(json) as unknown;
		if (!Array.isArray(data)) {
			return redeemedIds;
		}

		for (const id of data) {
			redeemedIds.add(String(id));
		}
		log.info(`Loaded ${redeemedIds.size} redeemed trade IDs`);
	} catch (err) {
		log.warn("Failed to load redeemed IDs:", err instanceof Error ? err.message : String(err));
	}

	return redeemedIds;
}

export async function saveRedeemedTradeIds(redeemedIds: ReadonlySet<string>): Promise<void> {
	try {
		await kvQueries.set(REDEEMED_TRADE_IDS_KEY, JSON.stringify([...redeemedIds]));
	} catch (err) {
		log.warn("Failed to save redeemed IDs:", err instanceof Error ? err.message : String(err));
	}
}
