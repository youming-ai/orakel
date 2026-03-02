import fs from "node:fs";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { ClobClient } from "@polymarket/clob-client";
import { providers, Wallet } from "ethers";
import { setHeartbeatClient, stopHeartbeat } from "../bot/heartbeat.ts";
import { statements } from "../core/db.ts";
import { env } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import type { DailyState } from "../types.ts";
import { getLiveMarketBreakdown, getLiveStatsFromChain, getLiveStatsLegacy } from "./live.ts";

const log = createLogger("trader");

const CREDS_PATH = "./data/api-creds.json";
const CHAIN_ID = 137;

const RPC_URLS: string[] = [
	env.POLYGON_RPC_URL,
	"https://polygon-bor-rpc.publicnode.com",
	"https://polygon-rpc.com",
	"https://rpc.ankr.com/polygon",
].filter((x): x is string => Boolean(x));

let wallet: Wallet | null = null;
let client: ClobClient | null = null;
let paperDailyState: DailyState = {
	date: new Date().toDateString(),
	pnl: 0,
	trades: 0,
};
let liveDailyState: DailyState = {
	date: new Date().toDateString(),
	pnl: 0,
	trades: 0,
};

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return {};
}

function isApiCreds(value: unknown): value is ApiKeyCreds {
	const record = asRecord(value);
	return (
		typeof record.key === "string" &&
		record.key.length > 0 &&
		typeof record.secret === "string" &&
		record.secret.length > 0 &&
		typeof record.passphrase === "string" &&
		record.passphrase.length > 0
	);
}

export function initTraderState(): void {
	try {
		const today = new Date().toDateString();
		const paperRow = statements.getDailyStats().get({ $date: today, $mode: "paper" }) as {
			pnl?: number;
			trades?: number;
		} | null;
		if (paperRow) {
			paperDailyState = { date: today, pnl: Number(paperRow.pnl ?? 0), trades: Number(paperRow.trades ?? 0) };
		}

		const liveRow = statements.getDailyStats().get({ $date: today, $mode: "live" }) as {
			pnl?: number;
			trades?: number;
		} | null;
		if (liveRow) {
			liveDailyState = { date: today, pnl: Number(liveRow.pnl ?? 0), trades: Number(liveRow.trades ?? 0) };
		}
	} catch (err) {
		log.warn("Failed to load daily state from SQLite:", err);
	}
}

initTraderState();

function saveDailyState(mode: "paper" | "live"): void {
	const state = mode === "paper" ? paperDailyState : liveDailyState;

	const existing = statements.getDailyStats().get({
		$date: state.date,
		$mode: mode,
	}) as { wins?: number | null; losses?: number | null } | null;

	statements.upsertDailyStats().run({
		$date: state.date,
		$mode: mode,
		$pnl: state.pnl,
		$trades: state.trades,
		$wins: Number(existing?.wins ?? 0),
		$losses: Number(existing?.losses ?? 0),
	});
}

async function createProvider(): Promise<providers.JsonRpcProvider | null> {
	for (const url of RPC_URLS) {
		try {
			const p = new providers.JsonRpcProvider(url);
			await p.getNetwork();
			log.info("Connected to Polygon RPC:", url);
			return p;
		} catch {
			log.info("RPC failed:", url);
		}
	}
	return null;
}

export async function initTrader(): Promise<void> {
	log.info("initTrader() is deprecated - use connectWallet() instead");
}

export async function connectWallet(privateKey: string, clobBaseUrl: string): Promise<{ address: string }> {
	if (!privateKey || privateKey.length !== 64) {
		throw new Error("Private key must be 64 hex characters (without 0x prefix)");
	}

	wallet = new Wallet(`0x${privateKey}`);
	log.info("Wallet connected:", wallet.address);

	const provider = await createProvider();
	if (provider && wallet) {
		wallet = wallet.connect(provider);
	}
	const address = wallet.address;

	let savedCreds: unknown = null;
	try {
		if (fs.existsSync(CREDS_PATH)) {
			savedCreds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
		}
	} catch (err) {
		log.warn("Failed to load saved API credentials:", err);
	}

	await initClient(savedCreds, clobBaseUrl);
	return { address };
}

export function disconnectWallet(): void {
	stopHeartbeat();
	wallet = null;
	setHeartbeatClient(null);
	client = null;
	log.info("Wallet disconnected");
}

export async function initClient(savedCreds: unknown, clobBaseUrl: string): Promise<void> {
	if (!wallet) return;

	try {
		const signatureType = 0;

		log.info("EOA mode:", wallet.address);

		let creds: ApiKeyCreds | null = isApiCreds(savedCreds) ? savedCreds : null;

		if (!creds) {
			log.info("Deriving API credentials from EOA...");
			try {
				const tempClient = new ClobClient(clobBaseUrl, CHAIN_ID, wallet);
				creds = await tempClient.deriveApiKey();
				if (isApiCreds(creds)) {
					fs.mkdirSync("./data", { recursive: true });
					fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
					try {
						fs.chmodSync(CREDS_PATH, 0o600);
					} catch (err) {
						log.debug("chmod failed (non-critical)", err);
					}
					log.info("Derived and saved creds, key:", creds.key);
				}
			} catch (deriveErr: unknown) {
				const msg = deriveErr instanceof Error ? deriveErr.message : String(deriveErr);
				log.error("Derive failed:", msg);
			}
		}

		if (!isApiCreds(creds)) {
			log.error("No API credentials available");
			setHeartbeatClient(null);
			client = null;
			return;
		}

		client = new ClobClient(clobBaseUrl, CHAIN_ID, wallet, creds, signatureType);
		setHeartbeatClient(client);
		log.info("Client ready (key:", creds.key, ")");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Failed to initialize client:", msg);
		setHeartbeatClient(null);
		client = null;
	}
}

export function getWalletAddress(): string | null {
	return wallet?.address || null;
}

export function getWallet(): Wallet | null {
	return wallet;
}

export function getClient(): ClobClient | null {
	return client;
}

export function getClientStatus(): {
	walletLoaded: boolean;
	clientReady: boolean;
	walletAddress: string | undefined;
} {
	return {
		walletLoaded: !!wallet,
		clientReady: !!client,
		walletAddress: wallet?.address,
	};
}

export function getDailyState(): DailyState {
	return { ...paperDailyState };
}

export function getPaperDailyState(): DailyState {
	return paperDailyState;
}

export function getLiveDailyState(): DailyState {
	return liveDailyState;
}

export function updatePnl(amount: number, mode: "paper" | "live"): void {
	if (mode === "paper") {
		paperDailyState.pnl += amount;
	} else {
		liveDailyState.pnl += amount;
	}
	saveDailyState(mode);
}

export async function getLiveStats(): Promise<{
	totalTrades: number;
	wins: number;
	losses: number;
	pending: number;
	winRate: number;
	totalPnl: number;
}> {
	if (!client) {
		log.debug("Cannot get live stats: client not initialized");
		return { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, totalPnl: 0 };
	}

	try {
		return await getLiveStatsLegacy(client);
	} catch (err) {
		log.error("Failed to get live stats from chain:", err);
		return { totalTrades: 0, wins: 0, losses: 0, pending: 0, winRate: 0, totalPnl: 0 };
	}
}

export function getLiveTodayStats(dailyLossLimitUsdc: number): {
	pnl: number;
	trades: number;
	limit: number;
} {
	return {
		pnl: liveDailyState.pnl,
		trades: liveDailyState.trades,
		limit: dailyLossLimitUsdc,
	};
}

export async function getLiveByMarket(): Promise<
	Record<
		string,
		{ wins: number; losses: number; pending: number; winRate: number; totalPnl: number; tradeCount: number }
	>
> {
	if (!client) {
		return {};
	}
	try {
		const stats = await getLiveStatsFromChain(client);
		return getLiveMarketBreakdown(stats.trades);
	} catch (err) {
		log.error("Failed to get live market breakdown:", err);
		return {};
	}
}
