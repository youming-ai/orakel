import { ethers } from "ethers";
import { CONFIG } from "../config.ts";
import type { PriceTick } from "../types.ts";

const AGGREGATOR_ABI = [
	"function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
	"function decimals() view returns (uint8)",
];

const iface = new ethers.utils.Interface(AGGREGATOR_ABI);

interface CacheEntry {
	decimals: number | null;
	result: PriceTick;
	fetchedAtMs: number;
}

let preferredRpcUrl: string | null = null;
const cacheByAggregator = new Map<string, CacheEntry>();
const MIN_FETCH_INTERVAL_MS = 2_000;
const RPC_TIMEOUT_MS = 1_500;

export function getRpcCandidates(): string[] {
	const fromList = Array.isArray(CONFIG.chainlink.polygonRpcUrls) ? CONFIG.chainlink.polygonRpcUrls : [];
	const single = CONFIG.chainlink.polygonRpcUrl ? [CONFIG.chainlink.polygonRpcUrl] : [];
	const defaults = ["https://polygon-rpc.com", "https://rpc.ankr.com/polygon", "https://polygon.llamarpc.com"];

	const all = [...fromList, ...single, ...defaults].map((s) => String(s).trim()).filter(Boolean);
	return Array.from(new Set(all));
}

export function getOrderedRpcs(): string[] {
	const rpcs = getRpcCandidates();
	const pref = preferredRpcUrl;
	if (pref && rpcs.includes(pref)) {
		return [pref, ...rpcs.filter((x) => x !== pref)];
	}
	return rpcs;
}

async function jsonRpcRequest(rpcUrl: string, method: string, params: unknown[]): Promise<string> {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

	try {
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			signal: controller.signal,
		});

		if (!res.ok) {
			throw new Error(`rpc_http_${res.status}`);
		}

		const data: unknown = await res.json();
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			throw new Error("rpc_invalid_payload");
		}
		const err = "error" in data ? data.error : undefined;
		if (err) {
			const code = err && typeof err === "object" && "code" in err ? String(err.code) : "unknown";
			throw new Error(`rpc_error_${code}`);
		}

		const result = "result" in data ? data.result : null;
		return String(result ?? "");
	} finally {
		clearTimeout(t);
	}
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
	return await jsonRpcRequest(rpcUrl, "eth_call", [{ to, data }, "latest"]);
}

async function fetchDecimals(rpcUrl: string, aggregator: string): Promise<number> {
	const data = iface.encodeFunctionData("decimals", []);
	const result = await ethCall(rpcUrl, aggregator, data);
	const [dec] = iface.decodeFunctionResult("decimals", result);
	return Number(dec);
}

async function fetchLatestRoundData(
	rpcUrl: string,
	aggregator: string,
): Promise<{ answer: ethers.BigNumber; updatedAt: ethers.BigNumber }> {
	const data = iface.encodeFunctionData("latestRoundData", []);
	const result = await ethCall(rpcUrl, aggregator, data);
	const decoded = iface.decodeFunctionResult("latestRoundData", result);
	return {
		answer: decoded[1],
		updatedAt: decoded[3],
	};
}

function getCacheEntry(aggregator: string): CacheEntry {
	const key = String(aggregator || "").toLowerCase();
	if (!cacheByAggregator.has(key)) {
		cacheByAggregator.set(key, {
			decimals: null,
			result: { price: null, updatedAt: null, source: "chainlink" },
			fetchedAtMs: 0,
		});
	}
	const entry = cacheByAggregator.get(key);
	if (!entry) {
		return {
			decimals: null,
			result: { price: null, updatedAt: null, source: "chainlink" },
			fetchedAtMs: 0,
		};
	}
	return entry;
}

export async function fetchChainlinkPrice(params: {
	aggregator: string;
	decimals?: number | null;
}): Promise<PriceTick> {
	const { aggregator, decimals = null } = params;
	if (
		(!CONFIG.chainlink.polygonRpcUrl &&
			(!CONFIG.chainlink.polygonRpcUrls || CONFIG.chainlink.polygonRpcUrls.length === 0)) ||
		!aggregator
	) {
		return { price: null, updatedAt: null, source: "missing_config" };
	}

	const cache = getCacheEntry(aggregator);
	if (decimals !== null && decimals !== undefined && Number.isFinite(Number(decimals))) {
		cache.decimals = Number(decimals);
	}

	const now = Date.now();
	if (cache.fetchedAtMs && now - cache.fetchedAtMs < MIN_FETCH_INTERVAL_MS) {
		return cache.result;
	}

	const rpcs = getOrderedRpcs();
	if (rpcs.length === 0) return { price: null, updatedAt: null, source: "missing_config" };

	for (const rpc of rpcs) {
		preferredRpcUrl = rpc;
		try {
			if (cache.decimals === null) {
				cache.decimals = await fetchDecimals(rpc, aggregator);
			}

			const round = await fetchLatestRoundData(rpc, aggregator);
			const answer = Number(round.answer);
			const scale = 10 ** Number(cache.decimals);
			const price = answer / scale;

			cache.result = {
				price,
				updatedAt: Number(round.updatedAt) * 1000,
				source: "chainlink",
			};
			cache.fetchedAtMs = now;
			preferredRpcUrl = rpc;
			return cache.result;
		} catch {
			cache.decimals = null;
		}
	}

	return cache.result;
}

export async function fetchChainlinkBtcUsd(): Promise<PriceTick> {
	return await fetchChainlinkPrice({ aggregator: CONFIG.chainlink.btcUsdAggregator, decimals: 8 });
}
