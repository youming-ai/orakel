import fs from "node:fs";
import type { ApiKeyCreds } from "@polymarket/clob-client";
import { ClobClient, Side } from "@polymarket/clob-client";
import { providers, Wallet } from "ethers";
import { CONFIG } from "./config.ts";
import { addPaperTrade } from "./paperStats.ts";
import type {
	DailyState,
	MarketConfig,
	RiskConfig,
	TradeResult,
	TradeSignal,
} from "./types.ts";
import { getCandleWindowTiming } from "./utils.ts";

const PAPER_DAILY_PATH = "./logs/paper/daily-state.json";
const LIVE_DAILY_PATH = "./logs/live/daily-state.json";
const CREDS_PATH = "./logs/api-creds.json";

const HOST = CONFIG.clobBaseUrl;
const CHAIN_ID = 137;

const RPC_URLS: string[] = [
	process.env.POLYGON_RPC_URL,
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

try {
	const saved: DailyState = JSON.parse(fs.readFileSync(PAPER_DAILY_PATH, "utf8"));
	if (saved.date === new Date().toDateString()) {
		paperDailyState = saved;
	}
} catch {}

try {
	const saved: DailyState = JSON.parse(fs.readFileSync(LIVE_DAILY_PATH, "utf8"));
	if (saved.date === new Date().toDateString()) {
		liveDailyState = saved;
	}
} catch {}

function saveDailyState(mode: "paper" | "live"): void {
	const dirPath = mode === "paper" ? "./logs/paper" : "./logs/live";
	const filePath = mode === "paper" ? PAPER_DAILY_PATH : LIVE_DAILY_PATH;
	fs.mkdirSync(dirPath, { recursive: true });
	const state = mode === "paper" ? paperDailyState : liveDailyState;
	fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

async function createProvider(): Promise<providers.JsonRpcProvider | null> {
	for (const url of RPC_URLS) {
		try {
			const p = new providers.JsonRpcProvider(url);
			await p.getNetwork();
			console.log("[trader] Connected to Polygon RPC:", url);
			return p;
		} catch {
			console.log("[trader] RPC failed:", url);
		}
	}
	return null;
}

export async function initTrader(): Promise<void> {
	console.log("[trader] initTrader() is deprecated — use connectWallet() instead");
}

export async function connectWallet(
	privateKey: string,
): Promise<{ address: string }> {
	if (!privateKey || privateKey.length !== 64) {
		throw new Error(
			"Private key must be 64 hex characters (without 0x prefix)",
		);
	}

	wallet = new Wallet(`0x${privateKey}`);
	console.log("[trader] Wallet connected:", wallet.address);

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
	} catch {}

	await initClient(savedCreds);
	return { address };
}

export function disconnectWallet(): void {
	wallet = null;
	client = null;
	console.log("[trader] Wallet disconnected");
}

async function initClient(savedCreds: unknown): Promise<void> {
	if (!wallet) return;

	try {
		const signatureType = 0;

		console.log("[trader] EOA mode:", wallet.address);

		let creds: ApiKeyCreds | null = isApiCreds(savedCreds) ? savedCreds : null;

		if (!creds) {
			console.log("[trader] Deriving API credentials from EOA...");
			try {
				const tempClient = new ClobClient(HOST, CHAIN_ID, wallet);
				creds = await tempClient.deriveApiKey();
				if (isApiCreds(creds)) {
					fs.mkdirSync("./logs", { recursive: true });
					fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
					console.log("[trader] Derived and saved creds, key:", creds.key);
				}
			} catch (deriveErr: unknown) {
				const msg =
					deriveErr instanceof Error ? deriveErr.message : String(deriveErr);
				console.error("[trader] Derive failed:", msg);
			}
		}

		if (!isApiCreds(creds)) {
			console.error("[trader] No API credentials available");
			client = null;
			return;
		}

		client = new ClobClient(HOST, CHAIN_ID, wallet, creds, signatureType);
		console.log("[trader] Client ready (key:", creds.key, ")");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[trader] Failed to initialize client:", msg);
		client = null;
	}
}

function canTrade(riskConfig: RiskConfig, mode: "paper" | "live"): boolean {
	if (mode === "live") {
		if (!client) {
			console.error("[trader] Client not initialized");
			return false;
		}

		if (!wallet) {
			console.error("[trader] No wallet available");
			return false;
		}
	}

	const daily = mode === "paper" ? paperDailyState : liveDailyState;
	if (daily.pnl <= -Number(riskConfig.dailyMaxLossUsdc || 0)) {
		console.error(`[trader] ${mode} daily loss limit reached`);
		return false;
	}

	const today = new Date().toDateString();
	if (daily.date !== today) {
		if (mode === "paper") {
			paperDailyState = { date: today, pnl: 0, trades: 0 };
		} else {
			liveDailyState = { date: today, pnl: 0, trades: 0 };
		}
		saveDailyState(mode);
	}

	return true;
}

function tradeLogPath(
	marketId: string | null | undefined,
	mode: "paper" | "live",
): string {
	const id = String(marketId || "GLOBAL").toUpperCase();
	return `./logs/${mode}/trades-${id}.csv`;
}

function logTrade(
	trade: {
		market?: string;
		side: string;
		amount: number;
		price: number;
		orderId?: string;
		status: string;
	},
	marketId: string | null | undefined,
	mode: "paper" | "live",
): void {
	const header = [
		"timestamp",
		"market",
		"side",
		"amount",
		"price",
		"orderId",
		"status",
		"mode",
	];
	const row = [
		new Date().toISOString(),
		trade.market || "",
		trade.side,
		trade.amount,
		trade.price,
		trade.orderId || "",
		trade.status,
		mode,
	];

	const line = `${row.join(",")}\n`;

	const dirPath = `./logs/${mode}`;
	if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

	const logPath = tradeLogPath(marketId, mode);

	if (!fs.existsSync(logPath)) {
		fs.writeFileSync(logPath, `${header.join(",")}\n`);
	}

	fs.appendFileSync(logPath, line);
}

export async function executeTrade(
	signal: TradeSignal,
	options: { marketConfig?: MarketConfig | null; riskConfig: RiskConfig },
	mode: "paper" | "live" = "paper",
): Promise<TradeResult> {
	const { marketConfig = null, riskConfig } = options;

	if (mode === "paper") {
		const { side, marketUp, marketDown, marketSlug } = signal;
		const isUp = side === "UP";
		const marketPrice = isUp
			? parseFloat(String(marketUp))
			: parseFloat(String(marketDown));
		const limitDiscount = Number(riskConfig.limitDiscount ?? 0.1);
		const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
		const price = Math.round(priceRaw * 100) / 100;

		if (price < 0.02 || price > 0.98) {
			console.log(`[PAPER] Price ${price} out of tradeable range`);
			return { success: false, reason: "price_out_of_range" };
		}

		const timing = getCandleWindowTiming(15);
		const paperId = addPaperTrade({
			marketId: signal.marketId,
			windowStartMs: timing.startMs,
			side: signal.side,
			price,
			size: Number(riskConfig.maxTradeSizeUsdc || 0),
			priceToBeat: signal.priceToBeat ?? 0,
			currentPriceAtEntry: signal.currentPrice,
			timestamp: new Date().toISOString(),
		});

		console.log(`[PAPER] Simulated fill: ${side} at ${price}¢ | ${marketSlug} (${paperId})`);

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: Number(riskConfig.maxTradeSizeUsdc || 0),
				price,
				orderId: paperId,
				status: "paper_filled",
			},
			signal.marketId || marketConfig?.id,
			mode,
		);

		paperDailyState.trades++;
		saveDailyState("paper");

		return {
			success: true,
			order: { orderID: paperId, status: "paper_filled" },
		};
	}

	if (!canTrade(riskConfig, "live")) {
		return { success: false, reason: "trading_disabled" };
	}

	const { side, marketUp, marketDown, marketSlug, tokens } = signal;

	const isUp = side === "UP";
	const marketPrice = isUp
		? parseFloat(String(marketUp))
		: parseFloat(String(marketDown));
	const limitDiscount = Number(riskConfig.limitDiscount ?? 0.1);
	const priceRaw = Math.max(0.01, marketPrice - limitDiscount);
	const price = Math.round(priceRaw * 100) / 100;
	const tokenId = tokens
		? isUp
			? tokens.upTokenId
			: tokens.downTokenId
		: null;

	if (!tokenId) {
		console.error("[trader] No token ID available for", side);
		return { success: false, reason: "no_token_id" };
	}

	if (price < 0.02 || price > 0.98) {
		console.log(`[trader] Price ${price} out of tradeable range`);
		return { success: false, reason: "price_out_of_range" };
	}

	const oppositePrice = isUp
		? parseFloat(String(marketDown))
		: parseFloat(String(marketUp));
	if (price > 0.95 && oppositePrice < 0.05) {
		console.log("[trader] Market too confident, skipping");
		return { success: false, reason: "market_too_confident" };
	}

	console.log(
		`[trader] Executing ${side} trade: market ${marketPrice}¢ -> limit ${price}¢ (token: ${tokenId})`,
	);

	if (!client) {
		return { success: false, reason: "trading_disabled" };
	}

	try {
		const orderArgs = {
			tokenID: tokenId,
			price,
			size: Number(riskConfig.maxTradeSizeUsdc || 0),
			side: Side.BUY,
		};

		const tickSize = "0.01";
		const negRisk = false;

		console.log("[trader] Posting order:", JSON.stringify(orderArgs));

		const result: unknown = await client.createAndPostOrder(orderArgs, {
			tickSize,
			negRisk,
		});
		const resultObj = asRecord(result);
		const resultOrderId =
			typeof resultObj.orderID === "string" ? resultObj.orderID : undefined;
		const resultId =
			typeof resultObj.id === "string" ? resultObj.id : undefined;
		const resultStatus =
			typeof resultObj.status === "string" ? resultObj.status : undefined;

		console.log("[trader] Order result:", JSON.stringify(result));

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: Number(riskConfig.maxTradeSizeUsdc || 0),
				price,
				orderId: resultOrderId || resultId || "unknown",
				status: resultStatus || "placed",
			},
			signal.marketId || marketConfig?.id,
			mode,
		);

		if (resultOrderId || resultId) {
			liveDailyState.trades++;
			saveDailyState("live");
		}

		return {
			success: !!(resultOrderId || resultId),
			order: result,
		};
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[trader] Order error:", msg);

		logTrade(
			{
				market: marketSlug,
				side: `BUY_${side}`,
				amount: Number(riskConfig.maxTradeSizeUsdc || 0),
				price,
				orderId: "error",
				status: `error: ${msg}`,
			},
			signal.marketId || marketConfig?.id,
			mode,
		);

		return {
			success: false,
			error: msg,
		};
	}
}

export function getWalletAddress(): string | null {
	return wallet?.address || null;
}

export function getWallet(): Wallet | null {
	return wallet;
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

export function getConfig(): {
	paperRisk: RiskConfig;
	liveRisk: RiskConfig;
	strategy: typeof CONFIG.strategy;
} {
	return { paperRisk: CONFIG.paperRisk, liveRisk: CONFIG.liveRisk, strategy: CONFIG.strategy };
}

export function getDailyState(): DailyState {
	return { ...paperDailyState };
}

export function getPaperDailyState(): DailyState {
	return { ...paperDailyState };
}

export function getLiveDailyState(): DailyState {
	return { ...liveDailyState };
}

export function updatePnl(amount: number, mode: "paper" | "live"): void {
	if (mode === "paper") {
		paperDailyState.pnl += amount;
	} else {
		liveDailyState.pnl += amount;
	}
	saveDailyState(mode);
}
