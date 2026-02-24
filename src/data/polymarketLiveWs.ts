import WebSocket from "ws";
import { CONFIG } from "../config.ts";
import type { PriceTick, WsStreamHandle } from "../types.ts";

type JsonRecord = Record<string, unknown>;

type PolymarketStreamParams = {
	wsUrl?: string;
	symbolIncludes?: string;
	onUpdate?: (tick: PriceTick) => void;
};

type MultiPolymarketStreamHandle = WsStreamHandle & {
	getLast(symbol: string): PriceTick;
};

function safeJsonParse(s: string): unknown | null {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

function normalizePayload(payload: unknown): JsonRecord | null {
	if (!payload) return null;
	if (typeof payload === "object" && !Array.isArray(payload)) return payload as JsonRecord;
	if (typeof payload === "string") {
		const parsed = safeJsonParse(payload);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonRecord) : null;
	}
	return null;
}

function toFiniteNumber(x: unknown): number | null {
	const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : Number.NaN;
	return Number.isFinite(n) ? n : null;
}

function normSymbol(x: unknown): string {
	return String(x || "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

export function startPolymarketChainlinkPriceStream({
	wsUrl = CONFIG.polymarket.liveDataWsUrl,
	symbolIncludes = "btc",
	onUpdate,
}: PolymarketStreamParams = {}): WsStreamHandle {
	if (!wsUrl) {
		return {
			getLast(): PriceTick {
				return { price: null, updatedAt: null, source: "polymarket_ws" };
			},
			close(): void {},
		};
	}

	let ws: WebSocket | null = null;
	let closed = false;
	let reconnectMs = 500;

	let lastPrice: number | null = null;
	let lastUpdatedAt: number | null = null;

	const connect = (): void => {
		if (closed) return;

		ws = new WebSocket(wsUrl, {
			handshakeTimeout: 10_000,
		});

		const scheduleReconnect = (): void => {
			if (closed) return;
			try {
				ws?.terminate();
			} catch {}
			ws = null;
			const wait = reconnectMs;
			reconnectMs = Math.min(10_000, Math.floor(reconnectMs * 1.5));
			setTimeout(connect, wait);
		};

		ws.on("open", () => {
			reconnectMs = 500;
			try {
				ws?.send(
					JSON.stringify({
						action: "subscribe",
						subscriptions: [{ topic: "crypto_prices_chainlink", type: "*", filters: "" }],
					}),
				);
			} catch {
				scheduleReconnect();
			}
		});

		ws.on("message", (data: WebSocket.RawData) => {
			const msg = data.toString();
			if (!msg || !msg.trim()) return;

			const decoded = safeJsonParse(msg);
			const dataRec =
				decoded && typeof decoded === "object" && !Array.isArray(decoded) ? (decoded as JsonRecord) : null;
			if (!dataRec || dataRec.topic !== "crypto_prices_chainlink") return;

			const payload = normalizePayload(dataRec.payload) || {};
			const symbol = String(payload.symbol || payload.pair || payload.ticker || "").toLowerCase();
			if (symbolIncludes && !symbol.includes(String(symbolIncludes).toLowerCase())) return;

			const price = toFiniteNumber(payload.value ?? payload.price ?? payload.current ?? payload.data);
			if (price === null) return;

			const ts = toFiniteNumber(payload.timestamp);
			const ua = toFiniteNumber(payload.updatedAt);
			const updatedAtMs =
				ts !== null
					? Math.floor(Number(payload.timestamp) * 1000)
					: ua !== null
						? Math.floor(Number(payload.updatedAt) * 1000)
						: null;

			lastPrice = price;
			lastUpdatedAt = updatedAtMs ?? lastUpdatedAt;

			if (typeof onUpdate === "function") {
				onUpdate({ price: lastPrice, updatedAt: lastUpdatedAt, source: "polymarket_ws" });
			}
		});

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
			return { price: lastPrice, updatedAt: lastUpdatedAt, source: "polymarket_ws" };
		},
		close(): void {
			closed = true;
			try {
				ws?.close();
			} catch {}
			ws = null;
		},
	};
}

export function startMultiPolymarketPriceStream(
	symbols: string[] = [],
	{ wsUrl = CONFIG.polymarket.liveDataWsUrl }: { wsUrl?: string } = {},
): MultiPolymarketStreamHandle {
	const wanted = (Array.isArray(symbols) ? symbols : []).map((s) => normSymbol(s)).filter(Boolean);
	const wantedSet = new Set(wanted);
	const lastBySymbol = new Map<string, PriceTick>();

	if (!wsUrl || wantedSet.size === 0) {
		return {
			getLast(): PriceTick {
				return { price: null, updatedAt: null, source: "polymarket_ws" };
			},
			close(): void {},
		};
	}

	let ws: WebSocket | null = null;
	let closed = false;
	let reconnectMs = 500;

	const connect = (): void => {
		if (closed) return;

		ws = new WebSocket(wsUrl, {
			handshakeTimeout: 10_000,
		});

		const scheduleReconnect = (): void => {
			if (closed) return;
			try {
				ws?.terminate();
			} catch {}
			ws = null;
			const wait = reconnectMs;
			reconnectMs = Math.min(10_000, Math.floor(reconnectMs * 1.5));
			setTimeout(connect, wait);
		};

		ws.on("open", () => {
			reconnectMs = 500;
			try {
				ws?.send(
					JSON.stringify({
						action: "subscribe",
						subscriptions: [{ topic: "crypto_prices_chainlink", type: "*", filters: "" }],
					}),
				);
			} catch {
				scheduleReconnect();
			}
		});

		ws.on("message", (data: WebSocket.RawData) => {
			const msg = data.toString();
			if (!msg || !msg.trim()) return;

			const decoded = safeJsonParse(msg);
			const dataRec =
				decoded && typeof decoded === "object" && !Array.isArray(decoded) ? (decoded as JsonRecord) : null;
			if (!dataRec || dataRec.topic !== "crypto_prices_chainlink") return;

			const payload = normalizePayload(dataRec.payload) || {};
			const payloadSymbol = normSymbol(payload.symbol || payload.pair || payload.ticker || "");
			if (!payloadSymbol) return;

			const matched = wanted.find((w) => payloadSymbol === w || payloadSymbol.includes(w) || w.includes(payloadSymbol));
			if (!matched || !wantedSet.has(matched)) return;

			const price = toFiniteNumber(payload.value ?? payload.price ?? payload.current ?? payload.data);
			if (price === null) return;

			const ts = toFiniteNumber(payload.timestamp);
			const ua = toFiniteNumber(payload.updatedAt);
			const updatedAtMs =
				ts !== null
					? Math.floor(Number(payload.timestamp) * 1000)
					: ua !== null
						? Math.floor(Number(payload.updatedAt) * 1000)
						: null;

			const prev = lastBySymbol.get(matched) ?? { price: null, updatedAt: null, source: "polymarket_ws" };
			lastBySymbol.set(matched, {
				price,
				updatedAt: updatedAtMs ?? prev.updatedAt,
				source: "polymarket_ws",
			});
		});

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
			const key = normSymbol(symbol);
			return lastBySymbol.get(key) ?? { price: null, updatedAt: null, source: "polymarket_ws" };
		},
		close(): void {
			closed = true;
			try {
				ws?.close();
			} catch {}
			ws = null;
		},
	};
}
