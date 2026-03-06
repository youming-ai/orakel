import type { Wallet } from "ethers";
import { fetchRedeemablePositions } from "../blockchain/redeemer.ts";
import { createLogger } from "../core/logger.ts";

const log = createLogger("live-settler-resolver");

interface ResolveConditionIdParams {
	tokenId: string;
	wallet: Wallet | null;
	lookupConditionId: (tokenId: string) => string | null | Promise<string | null>;
}

export async function resolveRedeemConditionId({
	tokenId,
	wallet,
	lookupConditionId,
}: ResolveConditionIdParams): Promise<string | null> {
	const knownConditionId = await lookupConditionId(tokenId);
	if (knownConditionId) {
		return knownConditionId;
	}

	if (!wallet) {
		return null;
	}

	try {
		const positions = await fetchRedeemablePositions(wallet.address);
		for (const position of positions) {
			if (position.conditionId) {
				return position.conditionId;
			}
		}
		return null;
	} catch (err) {
		log.warn("Failed to resolve conditionId:", err instanceof Error ? err.message : String(err));
		return null;
	}
}
