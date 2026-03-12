import { createLogger } from "../core/logger.ts";
import type { PriceAdapter, PriceTick } from "../core/types.ts";

const log = createLogger("price-aggregator");

const STALE_THRESHOLD_MS = 5_000;

export function createPriceAggregator(primary: PriceAdapter, fallback: PriceAdapter): PriceAdapter {
	return {
		getLatestPrice(): PriceTick | null {
			const now = Date.now();
			const p = primary.getLatestPrice();
			const f = fallback.getLatestPrice();

			if (p && now - p.timestampMs < STALE_THRESHOLD_MS) return p;

			if (f && now - f.timestampMs < STALE_THRESHOLD_MS) {
				log.debug("Using fallback price source");
				return f;
			}

			if (p && f) return p.timestampMs >= f.timestampMs ? p : f;
			return p ?? f;
		},

		getRecentTicks(maxAgeMs = 60_000): PriceTick[] {
			const cutoff = Date.now() - maxAgeMs;
			const all = [...primary.getRecentTicks(maxAgeMs), ...fallback.getRecentTicks(maxAgeMs)];
			return all.filter((t) => t.timestampMs >= cutoff).sort((a, b) => a.timestampMs - b.timestampMs);
		},

		start() {
			primary.start();
			fallback.start();
			log.info("Price aggregator started (primary + fallback)");
		},

		stop() {
			primary.stop();
			fallback.stop();
			log.info("Price aggregator stopped");
		},
	};
}
