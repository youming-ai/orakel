import fs from "node:fs";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { ClobClient } from "@polymarket/clob-client";
import { providers, Wallet } from "ethers";
import { CONFIG } from "../core/config.ts";
import { env } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import { stopHeartbeat } from "./heartbeatService.ts";
import { traderState } from "./traderState.ts";

const log = createLogger("wallet-service");
const CREDS_PATH = "./data/api-creds.json";
const HOST = CONFIG.clobBaseUrl;
const CHAIN_ID = 137;

const RPC_URLS: string[] = [env.POLYGON_RPC_URL, ...CONFIG.infra.defaultFallbackRpcUrls].filter(
	(value): value is string => Boolean(value),
);

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

async function createProvider(): Promise<providers.JsonRpcProvider | null> {
	for (const url of RPC_URLS) {
		try {
			const provider = new providers.JsonRpcProvider(url);
			await provider.getNetwork();
			log.info("Connected to Polygon RPC:", url);
			return provider;
		} catch {
			log.info("RPC failed:", url);
		}
	}
	return null;
}

async function initClient(savedCreds: unknown): Promise<void> {
	if (!traderState.wallet) return;

	try {
		const signatureType = 0;
		log.info("EOA mode:", traderState.wallet.address);

		let creds: ApiKeyCreds | null = isApiCreds(savedCreds) ? savedCreds : null;
		if (!creds) {
			log.info("Deriving API credentials from EOA...");
			try {
				const tempClient = new ClobClient(HOST, CHAIN_ID, traderState.wallet);
				creds = await tempClient.deriveApiKey();
				if (isApiCreds(creds)) {
					fs.mkdirSync("./data", { recursive: true });
					fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
					try {
						fs.chmodSync(CREDS_PATH, 0o600);
					} catch {}
					log.info("Derived and saved creds, key:", creds.key);
				}
			} catch (deriveErr: unknown) {
				const msg = deriveErr instanceof Error ? deriveErr.message : String(deriveErr);
				log.error("Derive failed:", msg);
			}
		}

		if (!isApiCreds(creds)) {
			log.error("No API credentials available");
			traderState.client = null;
			return;
		}

		traderState.client = new ClobClient(HOST, CHAIN_ID, traderState.wallet, creds, signatureType);
		log.info("Client ready (key:", creds.key, ")");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Failed to initialize client:", msg);
		traderState.client = null;
	}
}

export async function initTrader(): Promise<void> {
	log.info("initTrader() is deprecated - use connectWallet() instead");
}

export async function connectWallet(privateKey: string): Promise<{ address: string }> {
	if (!privateKey || privateKey.length !== 64) {
		throw new Error("Private key must be 64 hex characters (without 0x prefix)");
	}

	traderState.wallet = new Wallet(`0x${privateKey}`);
	log.info("Wallet connected:", traderState.wallet.address);

	const provider = await createProvider();
	if (provider && traderState.wallet) {
		traderState.wallet = traderState.wallet.connect(provider);
	}
	const address = traderState.wallet.address;

	let savedCreds: unknown = null;
	try {
		if (fs.existsSync(CREDS_PATH)) {
			savedCreds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
		}
	} catch (err) {
		log.warn("Failed to load saved API credentials:", err);
	}

	await initClient(savedCreds);
	return { address };
}

export function disconnectWallet(): void {
	stopHeartbeat();
	traderState.wallet = null;
	traderState.client = null;
	log.info("Wallet disconnected");
}

export function getWalletAddress(): string | null {
	return traderState.wallet?.address || null;
}

export function getWallet(): Wallet | null {
	return traderState.wallet;
}

export function getClient(): ClobClient | null {
	return traderState.client;
}

export function getClientStatus(): {
	walletLoaded: boolean;
	clientReady: boolean;
	walletAddress: string | undefined;
} {
	return {
		walletLoaded: !!traderState.wallet,
		clientReady: !!traderState.client,
		walletAddress: traderState.wallet?.address,
	};
}
