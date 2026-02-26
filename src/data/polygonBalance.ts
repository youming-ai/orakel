import { createTtlCache } from "../cache.ts";
import { CONFIG } from "../config.ts";
import { CTF_ADDRESS, ctfIface, USDC_E_ADDRESS, USDC_E_DECIMALS, usdcIface } from "../contracts.ts";
import { createLogger } from "../logger.ts";
import type { BalanceSnapshotPayload, CtfPosition } from "../types.ts";

const log = createLogger("polygon-balance");

const BALANCE_CACHE = createTtlCache<BalanceSnapshotPayload>(30_000);
const DEFAULT_INTERVAL_MS = 30_000;
const RPC_TIMEOUT_MS = 3_000;

let preferredRpcUrl: string | null = null;
let rpcRequestId = 0;

interface JsonRpcError {
	code?: unknown;
	message?: unknown;
}

interface JsonRpcResponse {
	result?: unknown;
	error?: JsonRpcError;
}

function getRpcCandidates(): string[] {
	const fromList = Array.isArray(CONFIG.chainlink.polygonRpcUrls) ? CONFIG.chainlink.polygonRpcUrls : [];
	const single = CONFIG.chainlink.polygonRpcUrl ? [CONFIG.chainlink.polygonRpcUrl] : [];
	const defaults = ["https://polygon-rpc.com", "https://rpc.ankr.com/polygon", "https://polygon.llamarpc.com"];

	const all = [...fromList, ...single, ...defaults].map((s) => String(s).trim()).filter(Boolean);
	return Array.from(new Set(all));
}

function getOrderedRpcs(): string[] {
	const rpcs = getRpcCandidates();
	const pref = preferredRpcUrl;
	if (pref && rpcs.includes(pref)) {
		return [pref, ...rpcs.filter((x) => x !== pref)];
	}
	return rpcs;
}

function toDecimal(raw: string, decimals: number): number {
	const n = Number(raw);
	if (!Number.isFinite(n)) return 0;
	return n / 10 ** decimals;
}

function parseHexToNumber(hex: string): number {
	const clean = String(hex || "").trim();
	if (!clean.startsWith("0x")) {
		throw new Error("rpc_invalid_hex");
	}
	const n = Number.parseInt(clean.slice(2), 16);
	if (!Number.isFinite(n)) {
		throw new Error("rpc_invalid_number");
	}
	return n;
}

function normalizeTokenIds(tokenIds: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const tokenId of tokenIds) {
		const id = String(tokenId || "").trim();
		if (!id || seen.has(id)) continue;
		try {
			void BigInt(id);
			seen.add(id);
			out.push(id);
		} catch {
			log.warn("Skipping invalid CTF token id", { tokenId: id });
		}
	}
	return out;
}

async function jsonRpcRequest(rpcUrl: string, method: string, params: unknown[]): Promise<string> {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

	try {
		rpcRequestId = (rpcRequestId + 1) % 1_000_000;
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: rpcRequestId, method, params }),
			signal: controller.signal,
		});

		if (!res.ok) {
			throw new Error(`rpc_http_${res.status}`);
		}

		const payload: unknown = await res.json();
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			throw new Error("rpc_invalid_payload");
		}

		const data = payload as JsonRpcResponse;
		if (data.error) {
			const code =
				data.error && typeof data.error === "object" && "code" in data.error ? String(data.error.code) : "unknown";
			throw new Error(`rpc_error_${code}`);
		}

		return String(data.result ?? "");
	} finally {
		clearTimeout(t);
	}
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
	return await jsonRpcRequest(rpcUrl, "eth_call", [{ to, data }, "latest"]);
}

async function fetchBlockNumber(rpcUrl: string): Promise<number> {
	const hex = await jsonRpcRequest(rpcUrl, "eth_blockNumber", []);
	return parseHexToNumber(hex);
}

async function fetchUsdcRawBalance(rpcUrl: string, wallet: string): Promise<string> {
	const data = usdcIface.encodeFunctionData("balanceOf", [wallet]);
	const result = await ethCall(rpcUrl, USDC_E_ADDRESS, data);
	const [raw] = usdcIface.decodeFunctionResult("balanceOf", result);
	return String(raw);
}

async function fetchCtfPositions(rpcUrl: string, wallet: string, tokenIds: string[]): Promise<CtfPosition[]> {
	if (tokenIds.length === 0) return [];
	const ids = tokenIds.map(BigInt);
	const data = ctfIface.encodeFunctionData("balanceOfBatch", [Array(tokenIds.length).fill(wallet), ids]);
	const result = await ethCall(rpcUrl, CTF_ADDRESS, data);
	const decoded = ctfIface.decodeFunctionResult("balanceOfBatch", result);
	const balances: unknown[] = Array.isArray(decoded[0]) ? decoded[0] : [];

	const positions: CtfPosition[] = [];
	for (let i = 0; i < ids.length; i += 1) {
		const tokenId = ids[i]?.toString() ?? "";
		const balance = i < balances.length ? String(balances[i]) : "0";
		if (balance === "0") continue;
		positions.push({
			tokenId,
			balance,
			marketId: null,
			side: null,
		});
	}

	return positions;
}

async function fetchBalanceSnapshot(wallet: string, knownTokenIds: string[]): Promise<BalanceSnapshotPayload | null> {
	const cached = BALANCE_CACHE.get();
	const normalizedWallet = String(wallet || "").trim();
	if (!normalizedWallet) {
		log.warn("Missing wallet for balance polling");
		return cached ?? null;
	}

	const tokenIds = normalizeTokenIds(knownTokenIds);
	const rpcs = getOrderedRpcs();
	if (rpcs.length === 0) {
		log.warn("No Polygon RPC candidates configured");
		return cached ?? null;
	}

	for (const rpc of rpcs) {
		try {
			const [usdcRaw, positions, blockNumber] = await Promise.all([
				fetchUsdcRawBalance(rpc, normalizedWallet),
				fetchCtfPositions(rpc, normalizedWallet, tokenIds),
				fetchBlockNumber(rpc),
			]);

			const snapshot: BalanceSnapshotPayload = {
				usdcBalance: toDecimal(usdcRaw, USDC_E_DECIMALS),
				usdcRaw,
				positions,
				blockNumber,
				timestamp: Date.now(),
			};

			BALANCE_CACHE.set(snapshot);
			preferredRpcUrl = rpc;
			return snapshot;
		} catch (err) {
			log.warn("Polygon balance fetch failed on RPC", {
				rpc,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	log.error("All Polygon RPC candidates failed", {
		attempted: rpcs.length,
		hasCachedFallback: cached != null,
	});
	return cached ?? null;
}

export function startBalancePolling(opts: {
	wallet: string;
	knownTokenIds: () => string[];
	intervalMs?: number;
	onUpdate?: (snapshot: BalanceSnapshotPayload) => void;
}): { getLast(): BalanceSnapshotPayload | null; close(): void } {
	const intervalMs =
		typeof opts.intervalMs === "number" && Number.isFinite(opts.intervalMs) && opts.intervalMs > 0
			? opts.intervalMs
			: DEFAULT_INTERVAL_MS;

	let closed = false;
	let inFlight = false;
	let last: BalanceSnapshotPayload | null = BALANCE_CACHE.get() ?? null;

	const tick = async (): Promise<void> => {
		if (closed || inFlight) return;
		inFlight = true;
		try {
			const tokenIds = (() => {
				try {
					const ids = opts.knownTokenIds?.();
					return Array.isArray(ids) ? ids : [];
				} catch (err) {
					log.warn("knownTokenIds() threw", {
						error: err instanceof Error ? err.message : String(err),
					});
					return [];
				}
			})();

			const snapshot = await fetchBalanceSnapshot(opts.wallet, tokenIds);
			if (!snapshot) return;

			last = snapshot;
			if (typeof opts.onUpdate === "function") {
				opts.onUpdate(snapshot);
			}
		} catch (err) {
			log.warn("Balance polling tick failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			inFlight = false;
		}
	};

	void tick();
	const timer = setInterval(() => {
		void tick();
	}, intervalMs);

	return {
		getLast(): BalanceSnapshotPayload | null {
			return last;
		},
		close(): void {
			closed = true;
			clearInterval(timer);
		},
	};
}
