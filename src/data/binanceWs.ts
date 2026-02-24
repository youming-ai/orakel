import WebSocket from "ws";
import { CONFIG } from "../config.ts";
import type { PriceTick, WsStreamHandle } from "../types.ts";

type BinanceTradeStreamParams = {
	symbol?: string;
	onUpdate?: (tick: PriceTick) => void;
};

type MultiBinanceWsStreamHandle = WsStreamHandle & {
	getLast(symbol: string): PriceTick;
};

function toNumber(x: unknown): number | null {
	const n = Number(x);
	return Number.isFinite(n) ? n : null;
}

function buildWsUrl(symbol: string): string {
	const s = String(symbol || "").toLowerCase();
	return `wss://stream.binance.com:9443/ws/${s}@trade`;
}

function buildCombinedWsUrl(symbols: string[]): string {
	const streams = (Array.isArray(symbols) ? symbols : [])
		.map((s) => String(s || "").toLowerCase())
		.filter(Boolean)
		.map((s) => `${s}@trade`)
		.join("/");
	return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}

export function startBinanceTradeStream({
	symbol = CONFIG.markets?.[0]?.binanceSymbol,
	onUpdate,
}: BinanceTradeStreamParams = {}): WsStreamHandle {
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
		});

		ws.on("message", (data: WebSocket.RawData) => {
			try {
				const msg: unknown = JSON.parse(data.toString());
				const p = msg && typeof msg === "object" && "p" in msg ? toNumber(msg.p) : null;
				if (p === null) return;
				lastPrice = p;
				lastTs = Date.now();
				if (typeof onUpdate === "function") onUpdate({ price: lastPrice, ts: lastTs });
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

export function startMultiBinanceTradeStream(symbols: string[] = []): MultiBinanceWsStreamHandle {
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

		const url = buildCombinedWsUrl(wanted);
		ws = new WebSocket(url);

		ws.on("open", () => {
			reconnectMs = 500;
		});

		ws.on("message", (data: WebSocket.RawData) => {
			try {
				const msg: unknown = JSON.parse(data.toString());
				const payload =
					msg && typeof msg === "object" && "data" in msg && msg.data && typeof msg.data === "object" ? msg.data : msg;
				const rawSymbol =
					payload && typeof payload === "object" && "s" in payload ? String(payload.s || "").toUpperCase() : "";
				if (!wantedSet.has(rawSymbol)) return;
				const p = payload && typeof payload === "object" && "p" in payload ? toNumber(payload.p) : null;
				if (p === null) return;
				lastBySymbol.set(rawSymbol, { price: p, ts: Date.now() });
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
