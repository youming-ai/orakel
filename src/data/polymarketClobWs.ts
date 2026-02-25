import WebSocket from "ws";
import { createLogger } from "../logger.ts";

const log = createLogger("clob-ws");

type JsonRecord = Record<string, unknown>;

// ============ Types ============

export interface ClobWsBestBidAsk {
	bestBid: number | null;
	bestAsk: number | null;
	spread: number | null;
}

export interface ClobWsHandle {
	/** Subscribe to additional token IDs (dynamic add) */
	subscribe(tokenIds: string[]): void;
	/** Unsubscribe from token IDs */
	unsubscribe(tokenIds: string[]): void;
	/** Get latest best bid/ask for a token */
	getBestBidAsk(tokenId: string): ClobWsBestBidAsk | null;
	/** Get current tick size for a token (from tick_size_change events) */
	getTickSize(tokenId: string): string | null;
	/** Check if a market has been resolved */
	isResolved(tokenId: string): boolean;
	/** Get the winning asset ID for a resolved market */
	getWinningAssetId(tokenId: string): string | null;
	/** Close the WebSocket connection */
	close(): void;
}

// ============ Helpers ============

function safeJsonParse(s: string): unknown | null {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

function toFiniteNumber(x: unknown): number | null {
	const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : Number.NaN;
	return Number.isFinite(n) ? n : null;
}

// ============ CLOB Market WebSocket ============

const DEFAULT_CLOB_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export function startClobMarketWs(params?: { wsUrl?: string; initialTokenIds?: string[] }): ClobWsHandle {
	const wsUrl = params?.wsUrl ?? DEFAULT_CLOB_WS_URL;
	const pendingTokenIds = new Set<string>(params?.initialTokenIds ?? []);

	let ws: WebSocket | null = null;
	let closed = false;
	let reconnectMs = 500;

	// State caches.
	// NOTE: Maps grow with each subscribed token ID but entries are bounded by
	// the number of active 15-min markets (~4 markets × 2 tokens × ~100 windows/day).
	// Maps are cleared on close(). For long-running sessions, consider periodic pruning.
	const bestBidAsks = new Map<string, ClobWsBestBidAsk>();
	const tickSizes = new Map<string, string>();
	const resolvedMarkets = new Map<string, string>(); // tokenId -> winningAssetId

	function sendSubscribe(tokenIds: string[]): void {
		if (!ws || ws.readyState !== WebSocket.OPEN || tokenIds.length === 0) return;
		try {
			ws.send(
				JSON.stringify({
					type: "market",
					assets_ids: tokenIds,
					custom_feature_enabled: true, // Enable best_bid_ask, market_resolved
				}),
			);
		} catch {
			log.warn("Failed to send subscribe message");
		}
	}

	function sendUnsubscribe(tokenIds: string[]): void {
		if (!ws || ws.readyState !== WebSocket.OPEN || tokenIds.length === 0) return;
		try {
			ws.send(
				JSON.stringify({
					assets_ids: tokenIds,
					operation: "unsubscribe",
				}),
			);
		} catch {
			log.warn("Failed to send unsubscribe message");
		}
	}

	function handleMessage(data: unknown): void {
		if (!data || typeof data !== "object" || Array.isArray(data)) return;
		const msg = data as JsonRecord;

		const eventType = String(msg.event_type ?? msg.type ?? "");
		const assetId = String(msg.asset_id ?? "");

		switch (eventType) {
			case "best_bid_ask": {
				const bestBid = toFiniteNumber(msg.best_bid);
				const bestAsk = toFiniteNumber(msg.best_ask);
				const spread = toFiniteNumber(msg.spread);
				if (assetId) {
					bestBidAsks.set(assetId, { bestBid, bestAsk, spread });
				}
				break;
			}
			case "tick_size_change": {
				const newTickSize = String(msg.new_tick_size ?? "");
				if (assetId && newTickSize) {
					tickSizes.set(assetId, newTickSize);
					log.info(`Tick size changed for ${assetId.slice(0, 12)}...: ${msg.old_tick_size} -> ${newTickSize}`);
				}
				break;
			}
			case "market_resolved": {
				const winningAssetId = String(msg.winning_asset_id ?? "");
				if (assetId) {
					resolvedMarkets.set(assetId, winningAssetId);
					log.info(`Market resolved: ${assetId.slice(0, 12)}... winner=${winningAssetId.slice(0, 12)}...`);
				}
				break;
			}
			case "last_trade_price": {
				// Could cache last trade price if needed in future
				break;
			}
			case "book":
			case "price_change": {
				// Full orderbook and price change events — we already poll REST for these
				break;
			}
			default:
				break;
		}
	}

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
			const allTokenIds = [...pendingTokenIds];
			if (allTokenIds.length > 0) {
				sendSubscribe(allTokenIds);
				log.info(`CLOB WS connected, subscribed to ${allTokenIds.length} token(s)`);
			} else {
				log.info("CLOB WS connected (no tokens to subscribe yet)");
			}
		});

		ws.on("message", (data: WebSocket.RawData) => {
			const raw = data.toString();
			if (!raw || !raw.trim()) return;

			const parsed = safeJsonParse(raw);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					handleMessage(item);
				}
			} else {
				handleMessage(parsed);
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
		subscribe(tokenIds: string[]): void {
			const newIds = tokenIds.filter((id) => !pendingTokenIds.has(id));
			for (const id of tokenIds) pendingTokenIds.add(id);
			if (newIds.length > 0) sendSubscribe(newIds);
		},
		unsubscribe(tokenIds: string[]): void {
			for (const id of tokenIds) {
				pendingTokenIds.delete(id);
				bestBidAsks.delete(id);
				tickSizes.delete(id);
				// Keep resolvedMarkets — resolution is permanent
			}
			sendUnsubscribe(tokenIds);
		},
		getBestBidAsk(tokenId: string): ClobWsBestBidAsk | null {
			return bestBidAsks.get(tokenId) ?? null;
		},
		getTickSize(tokenId: string): string | null {
			return tickSizes.get(tokenId) ?? null;
		},
		isResolved(tokenId: string): boolean {
			return resolvedMarkets.has(tokenId);
		},
		getWinningAssetId(tokenId: string): string | null {
			return resolvedMarkets.get(tokenId) ?? null;
		},
		close(): void {
			closed = true;
			try {
				ws?.close();
			} catch {}
			ws = null;
			bestBidAsks.clear();
			tickSizes.clear();
			resolvedMarkets.clear();
			pendingTokenIds.clear();
		},
	};
}
