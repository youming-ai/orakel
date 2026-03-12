import { createLogger } from "../core/logger.ts";
import type { PriceAdapter, PriceTick } from "../core/types.ts";

const log = createLogger("binance");

export function createBinanceAdapter(config: { wsUrl: string; restUrl: string; maxTickAge?: number }): PriceAdapter {
	const { wsUrl, restUrl, maxTickAge = 60_000 } = config;
	const ticks: PriceTick[] = [];
	let latestTick: PriceTick | null = null;
	let ws: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectMs = 500;
	let stopped = false;

	function recordTick(price: number, timestampMs?: number): void {
		const tick: PriceTick = { price, timestampMs: timestampMs ?? Date.now() };
		latestTick = tick;
		ticks.push(tick);
		const cutoff = Date.now() - maxTickAge;
		while (ticks.length > 0 && (ticks[0]?.timestampMs ?? 0) < cutoff) {
			ticks.shift();
		}
	}

	async function fetchRestPrice(): Promise<void> {
		try {
			const res = await fetch(`${restUrl}/ticker/price?symbol=BTCUSDT`, {
				signal: AbortSignal.timeout(5_000),
			});
			if (!res.ok) {
				log.warn("REST price fetch failed", { status: res.status });
				return;
			}
			const json = (await res.json()) as { price?: string };
			if (json.price) {
				const price = Number.parseFloat(json.price);
				if (!Number.isNaN(price) && price > 0) {
					recordTick(price);
					log.info("Initial BTC price via REST", { price: price.toFixed(2) });
				}
			}
		} catch (err) {
			log.warn("REST price fetch error", { error: err instanceof Error ? err.message : String(err) });
		}
	}

	function connectWs(): void {
		if (stopped) return;
		try {
			ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				reconnectMs = 500;
				log.info("Binance WS connected");
			};

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(String(event.data)) as { p?: string; T?: number };
					if (data.p) {
						const price = Number.parseFloat(data.p);
						if (!Number.isNaN(price)) {
							recordTick(price, data.T);
						}
					}
				} catch {
					/* malformed WS message, safe to skip */
				}
			};

			ws.onclose = () => {
				if (!stopped) {
					log.warn("Binance WS disconnected", { reconnectMs });
					scheduleReconnect();
				}
			};

			ws.onerror = () => {
				log.warn("Binance WS error");
			};
		} catch (err) {
			log.warn("Binance WS connection failed", { error: err instanceof Error ? err.message : String(err) });
			scheduleReconnect();
		}
	}

	function scheduleReconnect(): void {
		if (stopped) return;
		const wait = reconnectMs;
		reconnectMs = Math.min(10_000, Math.floor(reconnectMs * 1.5));
		reconnectTimer = setTimeout(connectWs, wait);
	}

	return {
		getLatestPrice: () => latestTick,
		getRecentTicks: (maxAgeMs = maxTickAge) => {
			const cutoff = Date.now() - maxAgeMs;
			return ticks.filter((t) => t.timestampMs >= cutoff);
		},
		start: () => {
			stopped = false;
			reconnectMs = 500;
			fetchRestPrice();
			connectWs();
			log.info("Binance adapter started");
		},
		stop: () => {
			stopped = true;
			if (ws) {
				ws.close();
				ws = null;
			}
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			log.info("Binance adapter stopped");
		},
	};
}
