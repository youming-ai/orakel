import { createLogger } from "../core/logger.ts";
import type { PriceAdapter, PriceTick } from "../core/types.ts";

const log = createLogger("bybit");

export function createBybitAdapter(config: {
	wsUrl: string;
	restUrl: string;
	symbol?: string;
	maxTickAge?: number;
}): PriceAdapter {
	const { wsUrl, restUrl, symbol = "BTCUSDT", maxTickAge = 60_000 } = config;
	const ticks: PriceTick[] = [];
	let latestTick: PriceTick | null = null;
	let ws: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let pingTimer: ReturnType<typeof setInterval> | null = null;
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
			const url = `${restUrl}/v5/market/tickers?category=spot&symbol=${symbol}`;
			const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
			if (!res.ok) {
				log.warn("REST price fetch failed", { status: res.status });
				return;
			}
			const json = (await res.json()) as {
				retCode: number;
				result?: { list?: Array<{ lastPrice: string }> };
			};
			if (json.retCode !== 0 || !json.result?.list?.[0]) {
				log.warn("REST price invalid response");
				return;
			}
			const price = Number.parseFloat(json.result.list[0].lastPrice);
			if (!Number.isNaN(price) && price > 0) {
				recordTick(price);
				log.info("Initial BTC price via REST", { price: price.toFixed(2) });
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
				log.info("Bybit WS connected");
				ws?.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${symbol}`] }));
				pingTimer = setInterval(() => {
					if (ws?.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ op: "ping" }));
					}
				}, 20_000);
			};

			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(String(event.data)) as {
						topic?: string;
						ts?: number;
						data?: Array<{ price?: string }>;
					};
					if (msg.topic?.startsWith("publicTrade.") && msg.data?.[0]?.price) {
						const price = Number.parseFloat(msg.data[0].price);
						if (!Number.isNaN(price)) {
							recordTick(price, msg.ts);
						}
					}
				} catch {
					/* malformed WS message, safe to skip */
				}
			};

			ws.onclose = () => {
				clearPing();
				if (!stopped) {
					log.warn("Bybit WS disconnected", { reconnectMs });
					scheduleReconnect();
				}
			};

			ws.onerror = () => {
				log.warn("Bybit WS error");
			};
		} catch (err) {
			log.warn("Bybit WS connection failed", { error: err instanceof Error ? err.message : String(err) });
			scheduleReconnect();
		}
	}

	function clearPing(): void {
		if (pingTimer) {
			clearInterval(pingTimer);
			pingTimer = null;
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
			log.info("Bybit adapter started");
		},
		stop: () => {
			stopped = true;
			clearPing();
			if (ws) {
				ws.close();
				ws = null;
			}
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			log.info("Bybit adapter stopped");
		},
	};
}
