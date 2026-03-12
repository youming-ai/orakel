import { createLogger } from "../core/logger.ts";
import type { PriceTick } from "../core/types.ts";

const log = createLogger("chainlink");

// ABI fragment for latestRoundData
const LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c";

export interface ChainlinkAdapter {
	getLatestPrice(): PriceTick | null;
	getRecentTicks(maxAgeMs?: number): PriceTick[];
	start(): void;
	stop(): void;
}

export function createChainlinkAdapter(config: {
	httpUrl: string;
	aggregator: string;
	decimals: number;
	maxTickAge?: number;
}): ChainlinkAdapter {
	const { httpUrl, aggregator, decimals, maxTickAge = 60_000 } = config;
	const ticks: PriceTick[] = [];
	let latestTick: PriceTick | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let stopped = false;

	function recordTick(price: number): void {
		const tick: PriceTick = { price, timestampMs: Date.now() };
		latestTick = tick;
		ticks.push(tick);
		const cutoff = Date.now() - maxTickAge;
		while (ticks.length > 0 && (ticks[0]?.timestampMs ?? 0) < cutoff) {
			ticks.shift();
		}
	}

	async function fetchHttpPrice(): Promise<number | null> {
		try {
			const body = JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "eth_call",
				params: [{ to: aggregator, data: LATEST_ROUND_DATA_SELECTOR }, "latest"],
			});
			const res = await fetch(httpUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				signal: AbortSignal.timeout(5_000),
			});
			if (!res.ok) return null;
			const json = (await res.json()) as { result?: string };
			if (!json.result) return null;
			const hex = json.result;
			const answerHex = `0x${hex.slice(66, 130)}`;
			const raw = BigInt(answerHex);
			return Number(raw) / 10 ** decimals;
		} catch (err) {
			log.warn("HTTP price fetch failed", { error: err instanceof Error ? err.message : String(err) });
			return null;
		}
	}

	function startPolling(): void {
		pollTimer = setInterval(async () => {
			if (stopped) return;
			const price = await fetchHttpPrice();
			if (price !== null) recordTick(price);
		}, 3_000);
	}

	return {
		getLatestPrice: () => latestTick,
		getRecentTicks: (maxAgeMs = maxTickAge) => {
			const cutoff = Date.now() - maxAgeMs;
			return ticks.filter((t) => t.timestampMs >= cutoff);
		},
		start: () => {
			stopped = false;
			startPolling();
			log.info("Chainlink adapter started (HTTP polling)");
		},
		stop: () => {
			stopped = true;
			if (pollTimer) clearInterval(pollTimer);
			log.info("Chainlink adapter stopped");
		},
	};
}
