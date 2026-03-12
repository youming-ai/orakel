import type { WsEventType, WsMessage } from "@orakel/shared/contracts";

interface WsConnection {
	send: (data: string) => void;
}

export interface WsPublisher {
	broadcast<T>(type: WsEventType, data: T): void;
	getWebSocketHandler(): {
		open: (ws: unknown) => void;
		message: (_ws: unknown, _message: string | Buffer) => void;
		close: (ws: unknown) => void;
	};
}

export function createWsPublisher(): WsPublisher {
	const connections = new Set<WsConnection>();

	return {
		broadcast<T>(type: WsEventType, data: T) {
			const msg: WsMessage<T> = { type, data, ts: Date.now() };
			const payload = JSON.stringify(msg);
			for (const conn of connections) {
				try {
					conn.send(payload);
				} catch {
					// ignore
				}
			}
		},
		getWebSocketHandler() {
			return {
				open: (ws: unknown) => {
					connections.add(ws as WsConnection);
				},
				message: (_ws: unknown, _message: string | Buffer) => {
					// no-op
				},
				close: (ws: unknown) => {
					connections.delete(ws as WsConnection);
				},
			};
		},
	};
}
