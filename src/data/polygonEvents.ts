import { ethers } from "ethers";
import WebSocket from "ws";
import { CONFIG } from "../config.ts";
import {
	CTF_ADDRESS,
	ctfIface,
	TRANSFER_BATCH_TOPIC,
	TRANSFER_SINGLE_TOPIC,
	TRANSFER_TOPIC,
	USDC_E_ADDRESS,
	USDC_E_DECIMALS,
	usdcIface,
} from "../contracts.ts";
import { createLogger } from "../logger.ts";
import type { OnChainEvent } from "../types.ts";

const log = createLogger("polygon-events");

interface JsonRpcMessage {
	id?: unknown;
	result?: unknown;
	method?: unknown;
	params?: unknown;
}

interface JsonRpcLog {
	address?: unknown;
	topics?: unknown;
	data?: unknown;
	transactionHash?: unknown;
	blockNumber?: unknown;
	logIndex?: unknown;
}

export function getWssCandidates(): string[] {
	const fromList = Array.isArray(CONFIG.chainlink.polygonWssUrls) ? CONFIG.chainlink.polygonWssUrls : [];
	const single = CONFIG.chainlink.polygonWssUrl ? [CONFIG.chainlink.polygonWssUrl] : [];
	const all = [...fromList, ...single].map((s) => String(s).trim()).filter(Boolean);
	return Array.from(new Set(all));
}

export function toHexNumber(value: unknown): number | null {
	if (typeof value !== "string") return null;
	try {
		return Number(BigInt(value));
	} catch {
		return null;
	}
}

export function parseRpcLog(msg: JsonRpcMessage): JsonRpcLog | null {
	if (msg.method !== "eth_subscription") return null;
	const params = msg.params;
	if (!params || typeof params !== "object" || Array.isArray(params)) return null;
	const paramsResult = "result" in params ? params.result : null;
	if (!paramsResult || typeof paramsResult !== "object" || Array.isArray(paramsResult)) return null;
	const candidate = paramsResult as JsonRpcLog;
	// Validate required fields exist before passing downstream
	if (typeof candidate.address !== "string" || !Array.isArray(candidate.topics) || typeof candidate.data !== "string") {
		return null;
	}
	return candidate;
}

export function parseUsdcTransfer(logEntry: JsonRpcLog): OnChainEvent | null {
	const topics = Array.isArray(logEntry.topics) ? logEntry.topics : [];
	if (topics.length < 3) return null;
	if (String(topics[0]).toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) return null;

	const txHash = typeof logEntry.transactionHash === "string" ? logEntry.transactionHash : null;
	const blockNumber = toHexNumber(logEntry.blockNumber);
	const logIndex = toHexNumber(logEntry.logIndex);
	const data = typeof logEntry.data === "string" ? logEntry.data : null;
	if (!txHash || blockNumber === null || logIndex === null || !data) return null;

	try {
		const decoded = usdcIface.decodeEventLog("Transfer", data, topics);
		const from = String(decoded.from).toLowerCase();
		const to = String(decoded.to).toLowerCase();
		const value = decoded.value.toString();
		return {
			type: "usdc_transfer",
			txHash,
			blockNumber,
			logIndex,
			from,
			to,
			tokenId: null,
			value,
			timestamp: Date.now(),
		};
	} catch (err) {
		log.warn("Failed to decode USDC Transfer", { error: err instanceof Error ? err.message : String(err) });
		return null;
	}
}

export function parseCtfTransferSingle(logEntry: JsonRpcLog): OnChainEvent | null {
	const topics = Array.isArray(logEntry.topics) ? logEntry.topics : [];
	if (topics.length < 4) return null;
	if (String(topics[0]).toLowerCase() !== TRANSFER_SINGLE_TOPIC.toLowerCase()) return null;

	const txHash = typeof logEntry.transactionHash === "string" ? logEntry.transactionHash : null;
	const blockNumber = toHexNumber(logEntry.blockNumber);
	const logIndex = toHexNumber(logEntry.logIndex);
	const data = typeof logEntry.data === "string" ? logEntry.data : null;
	if (!txHash || blockNumber === null || logIndex === null || !data) return null;

	try {
		const decoded = ctfIface.decodeEventLog("TransferSingle", data, topics);
		const from = String(decoded.from).toLowerCase();
		const to = String(decoded.to).toLowerCase();
		const tokenId = decoded.id.toString();
		const value = decoded.value.toString();
		return {
			type: "ctf_transfer_single",
			txHash,
			blockNumber,
			logIndex,
			from,
			to,
			tokenId,
			value,
			timestamp: Date.now(),
		};
	} catch (err) {
		log.warn("Failed to decode CTF TransferSingle", { error: err instanceof Error ? err.message : String(err) });
		return null;
	}
}

export function parseOnChainEvent(logEntry: JsonRpcLog): OnChainEvent | null {
	const address = typeof logEntry.address === "string" ? logEntry.address.toLowerCase() : "";
	const topics = Array.isArray(logEntry.topics) ? logEntry.topics : [];
	const topic0 = String(topics[0] ?? "").toLowerCase();

	if (address === USDC_E_ADDRESS.toLowerCase() && topic0 === TRANSFER_TOPIC.toLowerCase()) {
		return parseUsdcTransfer(logEntry);
	}

	if (address === CTF_ADDRESS.toLowerCase() && topic0 === TRANSFER_SINGLE_TOPIC.toLowerCase()) {
		return parseCtfTransferSingle(logEntry);
	}

	if (address === CTF_ADDRESS.toLowerCase() && topic0 === TRANSFER_BATCH_TOPIC.toLowerCase()) {
		return null;
	}

	return null;
}

export function startOnChainEventStream(opts: { wallet: string; onEvent: (event: OnChainEvent) => void }): {
	close(): void;
} {
	const wssUrls = getWssCandidates();
	if (wssUrls.length === 0) {
		return {
			close(): void {},
		};
	}

	let paddedWallet: string;
	try {
		paddedWallet = ethers.utils.hexZeroPad(opts.wallet, 32).toLowerCase();
	} catch (err) {
		log.warn("Invalid wallet for Polygon events stream", err);
		return {
			close(): void {},
		};
	}

	let ws: WebSocket | null = null;
	let closed = false;
	let reconnectMs = 500;
	let reconnectAttempts = 0;
	const MAX_RECONNECT_ATTEMPTS = 30;
	let urlIndex = 0;
	let nextId = 1;
	const subIds: string[] = [];
	const subscribeReqIds = new Set<number>();

	const connect = (): void => {
		if (closed) return;

		if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			log.error("Max reconnection attempts reached, stopping event stream", {
				attempts: reconnectAttempts,
			});
			return;
		}

		const url = wssUrls[urlIndex % wssUrls.length] ?? wssUrls[0];
		if (!url) return;
		urlIndex += 1;

		ws = new WebSocket(url);

		const send = (obj: unknown): void => {
			try {
				ws?.send(JSON.stringify(obj));
			} catch {
				return;
			}
		};

		const scheduleReconnect = (): void => {
			if (closed) return;
			try {
				ws?.terminate();
			} catch {
			} finally {
				ws = null;
				subIds.length = 0;
				subscribeReqIds.clear();
			}
			const wait = reconnectMs;
			reconnectMs = Math.min(10_000, Math.floor(reconnectMs * 1.5));
			reconnectAttempts += 1;
			setTimeout(connect, wait);
		};

		ws.on("open", () => {
			reconnectMs = 500;
			reconnectAttempts = 0;
			log.debug("Polygon event WS connected", { urlIndex: urlIndex - 1, usdcDecimals: USDC_E_DECIMALS });

			const filters = [
				{ address: USDC_E_ADDRESS, topics: [TRANSFER_TOPIC, null, paddedWallet] },
				{ address: USDC_E_ADDRESS, topics: [TRANSFER_TOPIC, paddedWallet] },
				{ address: CTF_ADDRESS, topics: [TRANSFER_SINGLE_TOPIC, null, null, paddedWallet] },
				{ address: CTF_ADDRESS, topics: [TRANSFER_SINGLE_TOPIC, null, paddedWallet] },
			];

			for (const filter of filters) {
				const id = nextId++;
				subscribeReqIds.add(id);
				send({
					jsonrpc: "2.0",
					id,
					method: "eth_subscribe",
					params: ["logs", filter],
				});
			}
		});

		ws.on("message", (data: WebSocket.RawData) => {
			let msg: JsonRpcMessage;
			try {
				const parsed: unknown = JSON.parse(data.toString());
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
				msg = parsed as JsonRpcMessage;
			} catch {
				return;
			}

			if (typeof msg.id === "number" && subscribeReqIds.has(msg.id) && typeof msg.result === "string") {
				subIds.push(msg.result);
				subscribeReqIds.delete(msg.id);
				return;
			}

			const logEntry = parseRpcLog(msg);
			if (!logEntry) return;

			const event = parseOnChainEvent(logEntry);
			if (!event) return;

			try {
				opts.onEvent(event);
			} catch (err) {
				log.warn("On-chain event callback failed", { error: err instanceof Error ? err.message : String(err) });
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
		close(): void {
			closed = true;
			try {
				if (ws) {
					for (const subId of subIds) {
						ws.send(JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "eth_unsubscribe", params: [subId] }));
					}
				}
			} catch {}
			try {
				ws?.close();
			} catch {
			} finally {
				ws = null;
				subIds.length = 0;
				subscribeReqIds.clear();
			}
		},
	};
}
