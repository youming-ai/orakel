import type { Wallet } from "ethers";
import type { RedeemOneResult } from "../blockchain/redeemer.ts";
import { fetchRedeemablePositions } from "../blockchain/redeemer.ts";
import { onchainStatements } from "../core/db.ts";
import { createLogger } from "../core/logger.ts";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import type { AccountStatsManager } from "./accountStats.ts";

const log = createLogger("live-settler");

const DEFAULT_POLL_INTERVAL_MS = 15_000;

/**
 * LiveSettler is now a pure redeemer.
 * Settlement (won/lost determination) is handled by resolveTrades() in the main
 * loop using the same spot-price logic as paper. This class only redeems
 * on-chain winnings for already-settled won trades.
 */
export interface LiveSettlerDeps {
	clobWs: ClobWsHandle;
	liveAccount: AccountStatsManager;
	wallet: Wallet | null;
	lookupTokenId: (marketId: string, side: string) => string | null;
	lookupConditionId: (tokenId: string) => string | null;
	redeemFn: (wallet: Wallet, conditionId: string) => Promise<RedeemOneResult>;
}

export class LiveSettler {
	private deps: LiveSettlerDeps;
	private timer: ReturnType<typeof setInterval> | null = null;
	private settling = false;
	/** Track successfully redeemed trade IDs to avoid re-attempts */
	private redeemedIds = new Set<string>();

	constructor(deps: LiveSettlerDeps) {
		this.deps = deps;
	}

	/**
	 * Redeem on-chain winnings for already-settled (resolved + won) trades.
	 * Returns the number of trades successfully redeemed this cycle.
	 */
	async settle(): Promise<number> {
		if (this.settling) return 0;
		this.settling = true;

		let redeemed = 0;

		try {
			const wonTrades = this.deps.liveAccount.getWonTrades();

			for (const trade of wonTrades) {
				if (this.redeemedIds.has(trade.id)) continue;

				const tokenId = this.deps.lookupTokenId(trade.marketId, trade.side);
				if (!tokenId) {
					continue;
				}

				// Wait for Polymarket on-chain resolution before attempting redeem
				if (!this.deps.clobWs.isResolved(tokenId)) {
					continue;
				}

				let conditionId = this.deps.lookupConditionId(tokenId);
				if (!conditionId) {
					conditionId = await this.resolveConditionId(tokenId);
				}
				if (!conditionId) {
					log.warn(`No conditionId for token ${tokenId.slice(0, 12)}..., skipping redeem`);
					continue;
				}

				if (!this.deps.wallet) {
					log.warn("Cannot redeem: wallet not connected");
					continue;
				}

				const result = await this.deps.redeemFn(this.deps.wallet, conditionId);

				if (!result.success) {
					log.warn(`Redeem failed for ${trade.id} (${conditionId.slice(0, 10)}...): ${result.error}`);
					continue;
				}

				this.redeemedIds.add(trade.id);
				redeemed++;
				log.info(`Redeemed: ${trade.marketId} ${trade.side} pnl=$${(trade.pnl ?? 0).toFixed(2)} tx=${result.txHash}`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("settle() error:", msg);
		} finally {
			this.settling = false;
		}

		return redeemed;
	}

	private async resolveConditionId(tokenId: string): Promise<string | null> {
		if (!this.deps.wallet) return null;
		try {
			const positions = await fetchRedeemablePositions(this.deps.wallet.address);
			for (const pos of positions) {
				if (pos.conditionId) {
					try {
						onchainStatements.upsertKnownCtfToken().run({
							$tokenId: tokenId,
							$marketId: null,
							$side: null,
							$conditionId: pos.conditionId,
						});
					} catch {}
				}
			}
			return this.deps.lookupConditionId(tokenId);
		} catch {
			return null;
		}
	}

	start(intervalMs?: number): void {
		if (this.timer) return;
		const ms = intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.timer = setInterval(() => {
			void this.settle();
		}, ms);
		void this.settle();
		log.info(`LiveSettler started (poll every ${ms}ms)`);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
			log.info("LiveSettler stopped");
		}
	}

	isRunning(): boolean {
		return this.timer !== null;
	}
}
