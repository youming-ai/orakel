import type { Wallet } from "ethers";
import { Contract, constants } from "ethers";
import { createLogger } from "../core/logger.ts";
import type { RedeemResult } from "../types.ts";
import { CTF_ABI, CTF_ADDRESS, USDC_E_ADDRESS } from "./contracts.ts";

const log = createLogger("redeemer");
interface RedeemablePosition {
	conditionId: string;
	redeemable?: boolean;
	currentValue?: number;
	title?: string;
}

function isRedeemablePosition(value: unknown): value is RedeemablePosition {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return typeof row.conditionId === "string";
}

function toPositions(value: unknown): RedeemablePosition[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRedeemablePosition);
}

const DATA_API = "https://data-api.polymarket.com";

const GAS_OVERRIDES = {
	maxPriorityFeePerGas: 30_000_000_000,
	maxFeePerGas: 200_000_000_000,
};

const redeemed = new Set<string>();

export async function fetchRedeemablePositions(walletAddress: string): Promise<RedeemablePosition[]> {
	try {
		const res = await fetch(`${DATA_API}/positions?user=${walletAddress.toLowerCase()}`);
		if (!res.ok) return [];
		const positions = toPositions(await res.json());
		return positions.filter((p) => p.redeemable && Number(p.currentValue ?? 0) > 0);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error("Failed to fetch positions:", msg);
		return [];
	}
}

export async function redeemAll(wallet: Wallet): Promise<RedeemResult[]> {
	const positions = await fetchRedeemablePositions(wallet.address);
	if (!positions.length) return [];

	const conditionIds: string[] = [...new Set(positions.map((p) => String(p.conditionId)))];
	const results: RedeemResult[] = [];

	for (const conditionId of conditionIds) {
		const key = conditionId.toLowerCase();
		if (redeemed.has(key)) continue;

		try {
			const ctf = new Contract(CTF_ADDRESS, CTF_ABI, wallet);

			const denominator = await ctf.payoutDenominator(conditionId);
			if (denominator.isZero()) {
				continue;
			}

			const tx = await ctf.redeemPositions(USDC_E_ADDRESS, constants.HashZero, conditionId, [1, 2], GAS_OVERRIDES);
			log.info(`Redeem tx sent: ${tx.hash} (condition: ${conditionId.slice(0, 10)}...)`);
			const receipt = await Promise.race([
				tx.wait(),
				new Promise((_, reject) => setTimeout(() => reject(new Error("tx.wait timeout 60s")), 60_000)),
			]);
			if (receipt.status !== 1) {
				log.error(`Tx reverted: ${tx.hash}`);
				results.push({ conditionId, txHash: tx.hash, error: "tx_reverted" });
				continue;
			}
			redeemed.add(key);

			const matched = positions.filter((p) => p.conditionId === conditionId);
			const value = matched.reduce((sum, p) => sum + Number(p.currentValue ?? 0), 0);
			log.info(`Redeemed $${value.toFixed(2)} from ${matched[0]?.title || conditionId}`);
			results.push({
				conditionId,
				txHash: tx.hash,
				value,
				status: receipt.status,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error(`Failed to redeem ${conditionId.slice(0, 10)}:`, msg);
			results.push({ conditionId, error: msg });
		}
	}

	return results;
}

export interface RedeemOneResult {
	success: boolean;
	txHash: string | null;
	error?: string;
}

export async function redeemByConditionId(wallet: Wallet | null, conditionId: string): Promise<RedeemOneResult> {
	if (!wallet) {
		return { success: false, txHash: null, error: "no_wallet" };
	}
	if (!conditionId || conditionId.length === 0) {
		return { success: false, txHash: null, error: "empty_condition_id" };
	}

	const key = conditionId.toLowerCase();
	if (redeemed.has(key)) {
		return { success: true, txHash: null };
	}

	try {
		const ctf = new Contract(CTF_ADDRESS, CTF_ABI, wallet);

		const denominator = await ctf.payoutDenominator(conditionId);
		if (denominator.isZero()) {
			return { success: false, txHash: null, error: "not_resolved" };
		}

		const tx = await ctf.redeemPositions(USDC_E_ADDRESS, constants.HashZero, conditionId, [1, 2], GAS_OVERRIDES);
		log.info(`Redeem tx sent: ${tx.hash} (condition: ${conditionId.slice(0, 10)}...)`);

		const receipt = await Promise.race([
			tx.wait(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("tx.wait timeout 60s")), 60_000)),
		]);

		if (receipt.status !== 1) {
			return { success: false, txHash: tx.hash, error: "tx_reverted" };
		}

		redeemed.add(key);
		log.info(`Redeemed condition: ${conditionId.slice(0, 10)}... tx: ${tx.hash}`);
		return { success: true, txHash: tx.hash };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error(`redeemByConditionId failed (${conditionId.slice(0, 10)}...):`, msg);
		return { success: false, txHash: null, error: msg };
	}
}
