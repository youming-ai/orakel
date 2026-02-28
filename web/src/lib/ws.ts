import { useCallback, useEffect, useRef, useState } from "react";
import { getApiToken } from "./api.ts";

// WebSocket message types (match backend)
export type WsEventType = "state:snapshot" | "signal:new" | "trade:executed";

export interface WsMessage<T = unknown> {
	type: WsEventType;
	data: T;
	ts: number;
	version: number;
}

export interface StateSnapshotData {
	markets: Array<{
		id: string;
		spotPrice: number | null;
		priceToBeat: number | null;
		marketUp: number | null;
		marketDown: number | null;
		predictDirection: string;
		action: string;
		side: string | null;
		edge: number | null;
	}>;
	updatedAt: string;
	paperRunning: boolean;
	liveRunning: boolean;
	paperStats: {
		totalTrades: number;
		wins: number;
		losses: number;
		pending: number;
		winRate: number;
		totalPnl: number;
	} | null;
}

export interface SignalNewData {
	marketId: string;
	direction: string;
	probability: number;
	edge: number;
	ts: number;
}

export interface TradeExecutedData {
	marketId: string;
	side: string;
	size: number;
	price: number;
	pnl?: number;
	ts: number;
}

type MessageHandler = (msg: WsMessage) => void;

interface UseWebSocketOptions {
	url?: string;
	onMessage?: MessageHandler;
	onConnect?: () => void;
	onDisconnect?: () => void;
	reconnectAttempts?: number;
	reconnectInterval?: number;
	useExponentialBackoff?: boolean;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
	const {
		url,
		onMessage,
		onConnect,
		onDisconnect,
		reconnectAttempts = 10,
		reconnectInterval = 1000,
		useExponentialBackoff = true,
	} = options;

	const [isConnected, setIsConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectCountRef = useRef(0);
	const handlersRef = useRef<Set<MessageHandler>>(new Set());
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	// Store callbacks in refs so connect() stays stable across renders
	const onConnectRef = useRef(onConnect);
	const onDisconnectRef = useRef(onDisconnect);
	useEffect(() => {
		onConnectRef.current = onConnect;
	}, [onConnect]);
	useEffect(() => {
		onDisconnectRef.current = onDisconnect;
	}, [onDisconnect]);

	// Add handler if provided
	useEffect(() => {
		if (onMessage) {
			handlersRef.current.add(onMessage);
			return () => {
				handlersRef.current.delete(onMessage);
			};
		}
	}, [onMessage]);

	const getWsUrl = useCallback(() => {
		let base: string;
		if (url) {
			base = url;
		} else {
			// Derive WebSocket URL from VITE_API_BASE when deployed separately
			const apiBase = import.meta.env.VITE_API_BASE;
			if (apiBase) {
				const u = new URL(apiBase, window.location.origin);
				const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
				base = `${wsProto}//${u.host}/ws`;
			} else {
				const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
				base = `${protocol}//${window.location.host}/ws`;
			}
		}

		// Append auth token as query param when configured
		const token = getApiToken();
		if (token) {
			const sep = base.includes("?") ? "&" : "?";
			return `${base}${sep}token=${encodeURIComponent(token)}`;
		}
		return base;
	}, [url]);

	const connect = useCallback(() => {
		// Don't connect if already connected or connecting
		if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
			return;
		}

		// Clear any pending reconnect
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		if (!mountedRef.current) return;

		const wsUrl = getWsUrl();

		try {
			const ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				if (!mountedRef.current) return;
				setIsConnected(true);
				reconnectCountRef.current = 0;
				onConnectRef.current?.();
			};

			ws.onclose = (_event) => {
				if (!mountedRef.current) return;
				setIsConnected(false);
				wsRef.current = null;
				onDisconnectRef.current?.();

				// Auto-reconnect with exponential backoff
				if (reconnectCountRef.current < reconnectAttempts) {
					const delay = useExponentialBackoff
						? Math.min(
								reconnectInterval * 2 ** reconnectCountRef.current,
								30000, // Max 30s
							)
						: reconnectInterval;

					reconnectCountRef.current++;
					reconnectTimeoutRef.current = setTimeout(connect, delay);
				}
			};

			ws.onerror = () => {
				// Silent error handling - UI shows connection state via isConnected
			};

			ws.onmessage = (event) => {
				try {
					const msg: WsMessage = JSON.parse(event.data);
					// Dispatch to all registered handlers
					for (const handler of handlersRef.current) {
						try {
							handler(msg);
						} catch (e) {
							// biome-ignore lint/suspicious/noConsole: DEV-only WS debugging
							if (import.meta.env.DEV) console.error("[ws] Handler error:", e);
						}
					}
				} catch (e) {
					// biome-ignore lint/suspicious/noConsole: DEV-only WS debugging
					if (import.meta.env.DEV) console.error("[ws] Parse error:", e);
				}
			};

			wsRef.current = ws;
		} catch (e) {
			// biome-ignore lint/suspicious/noConsole: DEV-only WS debugging
			if (import.meta.env.DEV) console.error("[ws] Connection failed:", e);
		}
	}, [getWsUrl, reconnectAttempts, reconnectInterval, useExponentialBackoff]);

	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}
		wsRef.current?.close();
		wsRef.current = null;
		setIsConnected(false);
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		connect();

		return () => {
			mountedRef.current = false;
			disconnect();
		};
	}, [connect, disconnect]);

	const send = useCallback((data: unknown) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(data));
			return true;
		}
		// biome-ignore lint/suspicious/noConsole: DEV-only WS debugging
		if (import.meta.env.DEV) console.warn("[ws] Cannot send - not connected");
		return false;
	}, []);

	return {
		isConnected,
		connect,
		disconnect,
		reconnect: connect,
		send,
	};
}

// Singleton for use outside React components
let globalWs: WebSocket | null = null;
const globalHandlers = new Set<MessageHandler>();

export function getGlobalWebSocket(): WebSocket | null {
	return globalWs;
}

export function subscribeGlobal(handler: MessageHandler): () => void {
	globalHandlers.add(handler);
	return () => globalHandlers.delete(handler);
}

export function initGlobalWebSocket(url?: string): () => void {
	if (globalWs) {
		globalWs.close();
	}

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const wsUrl = url || `${protocol}//${window.location.host}/ws`;

	globalWs = new WebSocket(wsUrl);

	globalWs.onmessage = (event) => {
		try {
			const msg: WsMessage = JSON.parse(event.data);
			for (const handler of globalHandlers) {
				handler(msg);
			}
		} catch (e) {
			// biome-ignore lint/suspicious/noConsole: DEV-only WS debugging
			if (import.meta.env.DEV) console.error("[ws:global] Parse error:", e);
		}
	};

	return () => {
		globalWs?.close();
		globalWs = null;
	};
}
