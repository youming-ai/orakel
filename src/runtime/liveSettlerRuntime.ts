import { redeemByConditionId } from "../blockchain/redeemer.ts";
import { isLiveRunning } from "../core/state.ts";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import { onchainQueries } from "../db/queries.ts";
import type { AccountStatsManager } from "../trading/accountStats.ts";
import { LiveSettler } from "../trading/liveSettler.ts";
import { getWallet } from "../trading/trader.ts";

interface LiveSettlerControllerParams {
	clobWs: ClobWsHandle;
	liveAccount: AccountStatsManager;
}

export interface LiveSettlerController {
	ensure(): void;
	getInstance(): LiveSettler | null;
	clearInstance(): void;
}

export function createLiveSettlerController({
	clobWs,
	liveAccount,
}: LiveSettlerControllerParams): LiveSettlerController {
	let liveSettlerInstance: LiveSettler | null = null;

	async function lookupTokenId(marketId: string, side: string): Promise<string | null> {
		try {
			const row = await onchainQueries.getCtfTokenByMarketSide(marketId, side);
			return row?.tokenId ?? null;
		} catch {
			return null;
		}
	}

	async function lookupConditionId(tokenId: string): Promise<string | null> {
		try {
			const row = await onchainQueries.getKnownCtfToken(tokenId);
			return row?.conditionId ?? null;
		} catch {
			return null;
		}
	}

	return {
		ensure(): void {
			if (liveSettlerInstance?.isRunning()) return;
			const hasWonTrades = liveAccount.getWonTrades().length > 0;
			if (!isLiveRunning() && !hasWonTrades) return;

			liveSettlerInstance = new LiveSettler({
				clobWs,
				liveAccount,
				wallet: getWallet(),
				lookupTokenId,
				lookupConditionId,
				redeemFn: redeemByConditionId,
			});
			liveSettlerInstance.start();
		},
		getInstance(): LiveSettler | null {
			return liveSettlerInstance;
		},
		clearInstance(): void {
			liveSettlerInstance = null;
		},
	};
}
