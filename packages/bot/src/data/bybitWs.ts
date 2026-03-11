import WebSocket from "ws";
import type { PriceTick } from "../core/marketDataTypes.ts";
import type { WsStreamHandle } from "../trading/tradeTypes.ts";

const BYBIT_WS_BASE_URL = "wss://stream.bybit.com/v5/public/spot";

function toNumber(x: unknown): number | null {
	const n = Number(x);
	return Number.isFinite(n) ? n : null;
}

interface BybitTradeMessage {
	topic?: string;
	ts?: number;
	data?: Array<{
		symbol?: string;
		price?: string;
	}>;
}

type BybitWsStreamHandle = WsStreamHandle & {
	getLast(symbol: string): PriceTick;
};

function buildWsUrl(_symbol: string): string {
	return `${BYBIT_WS_BASE_URL}`;
}

export function startBybitTradeStream({
	symbol,
	onUpdate,
}: {
	symbol?: string;
	onUpdate?: (tick: PriceTick) => void;
} = {}): WsStreamHandle {
	let ws: WebSocket | null = null;
	let closed = false;
	let reconnectMs = 500;
	let lastPrice: number | null = null;
	let lastTs: number | null = null;

	const connect = (): void => {
		if (closed) return;

		const url = buildWsUrl(String(symbol ?? ""));
		ws = new WebSocket(url);

		ws.on("open", () => {
			reconnectMs = 500;
			if (symbol && ws?.readyState === WebSocket.OPEN) {
				const subMsg = {
					op: "subscribe",
					args: [`publicTrade.${symbol.toUpperCase()}`],
				};
				ws.send(JSON.stringify(subMsg));
			}
		});

		ws.on("message", (data: WebSocket.RawData) => {
			try {
				const msg = JSON.parse(data.toString()) as BybitTradeMessage;
				if (msg.topic?.startsWith("publicTrade.") && msg.data && msg.data.length > 0) {
					const trade = msg.data[0];
					const p = trade?.price ? toNumber(trade.price) : null;
					if (p === null) return;
					lastPrice = p;
					lastTs = msg.ts ?? Date.now();
					if (typeof onUpdate === "function") onUpdate({ price: lastPrice, ts: lastTs });
				}
			} catch {
				return;
			}
		});

		const scheduleReconnect = (): void => {
			if (closed) return;
			try {
				ws?.terminate();
			} catch {
			} finally {
				ws = null;
			}
			const wait = reconnectMs;
			reconnectMs = Math.min(10_000, Math.floor(reconnectMs * 1.5));
			setTimeout(connect, wait);
		};

		ws.on("close", () => {
			scheduleReconnect();
		});
		ws.on("error", () => {
			scheduleReconnect();
		});
	};

	connect();

	return {
		getLast(): PriceTick {
			return { price: lastPrice, ts: lastTs };
		},
		close(): void {
			closed = true;
			try {
				ws?.close();
			} catch {
			} finally {
				ws = null;
			}
		},
	};
}

export function startMultiBybitTradeStream(symbols: string[] = []): BybitWsStreamHandle {
	const wanted = (Array.isArray(symbols) ? symbols : []).map((s) => String(s || "").toUpperCase()).filter(Boolean);
	if (wanted.length === 0) {
		return {
			getLast(): PriceTick {
				return { price: null, ts: null };
			},
			close(): void {},
		};
	}

	const wantedSet = new Set(wanted);
	const lastBySymbol = new Map<string, PriceTick>();

	let ws: WebSocket | null = null;
	let closed = false;
	let reconnectMs = 500;

	const connect = (): void => {
		if (closed) return;

		const url = BYBIT_WS_BASE_URL;
		ws = new WebSocket(url);

		ws.on("open", () => {
			reconnectMs = 500;
			if (ws?.readyState === WebSocket.OPEN) {
				const args = wanted.map((s) => `publicTrade.${s}`);
				const subMsg = {
					op: "subscribe",
					args,
				};
				ws.send(JSON.stringify(subMsg));
			}
		});

		ws.on("message", (data: WebSocket.RawData) => {
			try {
				const msg = JSON.parse(data.toString()) as BybitTradeMessage;
				if (msg.topic?.startsWith("publicTrade.") && msg.data && msg.data.length > 0) {
					const rawSymbol = msg.topic.replace("publicTrade.", "").toUpperCase();
					if (!wantedSet.has(rawSymbol)) return;

					const trade = msg.data[0];
					const p = trade?.price ? toNumber(trade.price) : null;
					if (p === null) return;
					lastBySymbol.set(rawSymbol, { price: p, ts: msg.ts ?? Date.now() });
				}
			} catch {
				return;
			}
		});

		const scheduleReconnect = (): void => {
			if (closed) return;
			try {
				ws?.terminate();
			} catch {
			} finally {
				ws = null;
			}
			const wait = reconnectMs;
			reconnectMs = Math.min(10_000, Math.floor(reconnectMs * 1.5));
			setTimeout(connect, wait);
		};

		ws.on("close", () => {
			scheduleReconnect();
		});
		ws.on("error", () => {
			scheduleReconnect();
		});
	};

	connect();

	return {
		getLast(symbol: string): PriceTick {
			const key = String(symbol || "").toUpperCase();
			const item = lastBySymbol.get(key);
			return item ? { price: item.price, ts: item.ts ?? null } : { price: null, ts: null };
		},
		close(): void {
			closed = true;
			try {
				ws?.close();
			} catch {
			} finally {
				ws = null;
			}
		},
	};
}
