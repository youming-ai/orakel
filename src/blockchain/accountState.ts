import { USDC_E_DECIMALS } from "./contracts.ts";
import { createLogger } from "./logger.ts";
import type { BalanceSnapshotPayload, CtfPosition, OnChainEvent } from "./types.ts";

const log = createLogger("account-state");

// --- Module-level singleton state ---

let walletAddress = "";
let usdcBalance = 0;
let usdcRaw = "0";
let lastBlockNumber = 0;
let lastTimestamp = 0;
const positions = new Map<string, CtfPosition>();
const enrichments = new Map<string, { marketId: string; side: string }>();

// --- Init / Reset ---

export function initAccountState(wallet: string): void {
	walletAddress = wallet.toLowerCase();
	usdcBalance = 0;
	usdcRaw = "0";
	lastBlockNumber = 0;
	lastTimestamp = 0;
	positions.clear();
	enrichments.clear();
	log.info("Account state initialized", { wallet: walletAddress });
}

export function resetAccountState(): void {
	walletAddress = "";
	usdcBalance = 0;
	usdcRaw = "0";
	lastBlockNumber = 0;
	lastTimestamp = 0;
	positions.clear();
	enrichments.clear();
	log.info("Account state reset");
}

// --- Snapshot update (authoritative — replaces all state) ---

export function updateFromSnapshot(snapshot: BalanceSnapshotPayload): void {
	usdcBalance = snapshot.usdcBalance;
	usdcRaw = snapshot.usdcRaw;
	lastBlockNumber = snapshot.blockNumber;
	lastTimestamp = snapshot.timestamp;

	positions.clear();
	for (const pos of snapshot.positions) {
		if (!pos.tokenId) continue;
		const enrichment = enrichments.get(pos.tokenId);
		positions.set(pos.tokenId, {
			...pos,
			marketId: enrichment?.marketId ?? pos.marketId,
			side: enrichment?.side ?? pos.side,
		});
	}

	log.debug("Account state updated from snapshot", {
		usdcBalance,
		positionCount: positions.size,
		blockNumber: lastBlockNumber,
	});
}

// --- Event application (incremental — between snapshots) ---

export function applyEvent(event: OnChainEvent): void {
	if (!walletAddress) {
		log.warn("applyEvent called before initAccountState");
		return;
	}

	if (event.type === "usdc_transfer") {
		applyUsdcTransfer(event);
	} else if (event.type === "ctf_transfer_single") {
		applyCtfTransferSingle(event);
	}

	lastTimestamp = event.timestamp;
	if (event.blockNumber > lastBlockNumber) {
		lastBlockNumber = event.blockNumber;
	}
}

function applyUsdcTransfer(event: OnChainEvent): void {
	const value = BigInt(event.value);
	const currentRaw = BigInt(usdcRaw);

	let newRaw: bigint;
	if (event.to === walletAddress) {
		newRaw = currentRaw + value;
	} else if (event.from === walletAddress) {
		newRaw = currentRaw - value;
	} else {
		return;
	}

	if (newRaw < 0n) {
		log.warn("USDC balance underflow detected", {
			currentRaw: currentRaw.toString(),
			transferValue: value.toString(),
			newRaw: newRaw.toString(),
		});
	}

	// Warn if BigInt exceeds Number.MAX_SAFE_INTEGER (precision loss in floating-point conversion)
	if (newRaw > BigInt(Number.MAX_SAFE_INTEGER) || newRaw < BigInt(-Number.MAX_SAFE_INTEGER)) {
		log.warn("USDC raw balance exceeds safe integer range", { newRaw: newRaw.toString() });
	}

	usdcRaw = newRaw.toString();
	usdcBalance = Number(newRaw) / 10 ** USDC_E_DECIMALS;

	log.debug("USDC balance updated from event", {
		txHash: event.txHash,
		direction: event.to === walletAddress ? "in" : "out",
		value: event.value,
		newBalance: usdcBalance,
	});
}

function applyCtfTransferSingle(event: OnChainEvent): void {
	const tokenId = event.tokenId;
	if (!tokenId) return;

	const value = BigInt(event.value);
	const existing = positions.get(tokenId);
	const currentBalance = existing ? BigInt(existing.balance) : 0n;

	let newBalance: bigint;
	if (event.to === walletAddress) {
		newBalance = currentBalance + value;
	} else if (event.from === walletAddress) {
		newBalance = currentBalance - value;
	} else {
		return;
	}

	if (newBalance < 0n) {
		log.warn("CTF position underflow detected", {
			tokenId,
			currentBalance: currentBalance.toString(),
			transferValue: value.toString(),
			newBalance: newBalance.toString(),
		});
	}

	if (newBalance <= 0n) {
		positions.delete(tokenId);
	} else {
		const enrichment = enrichments.get(tokenId);
		positions.set(tokenId, {
			tokenId,
			balance: newBalance.toString(),
			marketId: enrichment?.marketId ?? existing?.marketId ?? null,
			side: enrichment?.side ?? existing?.side ?? null,
		});
	}

	log.debug("CTF position updated from event", {
		txHash: event.txHash,
		tokenId,
		direction: event.to === walletAddress ? "in" : "out",
		value: event.value,
		newBalance: newBalance.toString(),
	});
}

// --- Position enrichment (survives snapshots) ---

export function enrichPosition(tokenId: string, marketId: string, side: string): void {
	if (!tokenId || !marketId || !side) {
		log.warn("enrichPosition called with invalid data", { tokenId, marketId, side });
		return;
	}
	enrichments.set(tokenId, { marketId, side });
	const pos = positions.get(tokenId);
	if (pos) {
		positions.set(tokenId, { ...pos, marketId, side });
	}
}

// --- Getters ---

export function getWalletAddress(): string {
	return walletAddress;
}

export function getUsdcBalance(): number {
	return usdcBalance;
}

export function getUsdcRaw(): string {
	return usdcRaw;
}

export function getPosition(tokenId: string): CtfPosition | null {
	return positions.get(tokenId) ?? null;
}

export function getAllPositions(): CtfPosition[] {
	return Array.from(positions.values());
}

export function getLastBlockNumber(): number {
	return lastBlockNumber;
}

export interface AccountSummary {
	walletAddress: string;
	usdcBalance: number;
	usdcRaw: string;
	positions: CtfPosition[];
	positionCount: number;
	lastBlockNumber: number;
	lastTimestamp: number;
}

export function getAccountSummary(): AccountSummary {
	return {
		walletAddress,
		usdcBalance,
		usdcRaw,
		positions: getAllPositions(),
		positionCount: positions.size,
		lastBlockNumber,
		lastTimestamp,
	};
}
