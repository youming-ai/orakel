import type { Wallet } from "ethers";
import type { RedeemOneResult } from "../blockchain/redeemer.ts";
import { createLogger } from "../core/logger.ts";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import type { AccountStatsManager } from "./accountStats.ts";

const log = createLogger("live-settler");

const DEFAULT_POLL_INTERVAL_MS = 15_000;

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

	constructor(deps: LiveSettlerDeps) {
		this.deps = deps;
	}

	async settle(): Promise<number> {
		if (this.settling) return 0;
		this.settling = true;

		let settled = 0;

		try {
			const pending = this.deps.liveAccount.getPendingTrades();

			for (const trade of pending) {
				const tokenId = this.deps.lookupTokenId(trade.marketId, trade.side);
				if (!tokenId) {
					continue;
				}

				if (!this.deps.clobWs.isResolved(tokenId)) {
					continue;
				}

				const winningAssetId = this.deps.clobWs.getWinningAssetId(tokenId);
				const won = tokenId === winningAssetId;

				if (won) {
					const conditionId = this.deps.lookupConditionId(tokenId);
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

					const pnl = trade.size * (1 - trade.price);
					this.deps.liveAccount.resolveTradeOnchain(trade.id, true, pnl, result.txHash);
					log.info(`Settled WON: ${trade.marketId} ${trade.side} pnl=$${pnl.toFixed(2)} tx=${result.txHash}`);
					settled++;
				} else {
					const pnl = -(trade.size * trade.price);
					this.deps.liveAccount.resolveTradeOnchain(trade.id, false, pnl, null);
					log.info(`Settled LOST: ${trade.marketId} ${trade.side} pnl=$${pnl.toFixed(2)}`);
					settled++;
				}
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("settle() error:", msg);
		} finally {
			this.settling = false;
		}

		return settled;
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
