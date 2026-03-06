import { startApiServer } from "../api.ts";
import { fetchRedeemablePositions, redeemAll } from "../blockchain/redeemer.ts";
import { startConfigWatcher } from "../core/config.ts";
import { env } from "../core/env.ts";
import { createLogger } from "../core/logger.ts";
import { initAccountStats } from "../trading/accountStats.ts";
import { connectWallet, getWallet } from "../trading/trader.ts";

const log = createLogger("bootstrap");
const AUTO_REDEEM_ENABLED = env.AUTO_REDEEM_ENABLED;
const AUTO_REDEEM_INTERVAL_MS = env.AUTO_REDEEM_INTERVAL_MS;

interface BootstrapParams {
	isLiveSettlerRunning: () => boolean;
}

export interface BootstrapResult {
	redeemTimerHandle: ReturnType<typeof setInterval> | null;
}

export async function bootstrapApp({ isLiveSettlerRunning }: BootstrapParams): Promise<BootstrapResult> {
	startApiServer();
	startConfigWatcher();
	initAccountStats();

	let redeemTimerHandle: ReturnType<typeof setInterval> | null = null;

	if (!env.PRIVATE_KEY) {
		return { redeemTimerHandle };
	}

	try {
		const { address } = await connectWallet(env.PRIVATE_KEY);
		log.info(`Auto-connected wallet: ${address}`);

		if (AUTO_REDEEM_ENABLED) {
			log.info(`Auto-redeem enabled: checking every ${AUTO_REDEEM_INTERVAL_MS / 60_000} minutes`);
			redeemTimerHandle = setInterval(async () => {
				try {
					if (isLiveSettlerRunning()) {
						log.debug("Auto-redeem skipped: LiveSettler is active");
						return;
					}

					const wallet = getWallet();
					if (!wallet) {
						log.warn("Auto-redeem skipped: wallet not connected");
						return;
					}

					const positions = await fetchRedeemablePositions(wallet.address);
					if (positions.length === 0) {
						log.debug("Auto-redeem: no redeemable positions found");
						return;
					}

					const totalValue = positions.reduce((sum, position) => sum + (position.currentValue ?? 0), 0);
					log.info(`Auto-redeem: found ${positions.length} position(s) worth $${totalValue.toFixed(2)}, redeeming...`);

					const results = await redeemAll(wallet);
					const successCount = results.filter((result) => !result.error).length;
					const redeemedValue = results
						.filter((result) => result.value !== undefined)
						.reduce((sum, result) => sum + (result.value ?? 0), 0);

					if (successCount > 0) {
						log.info(
							`Auto-redeem success: ${successCount}/${results.length} redeemed, total value: $${redeemedValue.toFixed(2)}`,
						);
					} else {
						log.warn(`Auto-redeem failed: all ${results.length} redemption(s) failed`);
					}

					for (const result of results) {
						if (result.error) {
							log.warn(`Redeem failed for ${result.conditionId.slice(0, 10)}...: ${result.error}`);
						}
					}
				} catch (err) {
					log.error("Auto-redeem error:", err instanceof Error ? err.message : String(err));
				}
			}, AUTO_REDEEM_INTERVAL_MS);

			setTimeout(async () => {
				try {
					const wallet = getWallet();
					if (!wallet) return;

					const positions = await fetchRedeemablePositions(wallet.address);
					if (positions.length > 0) {
						const totalValue = positions.reduce((sum, position) => sum + (position.currentValue ?? 0), 0);
						log.info(`Startup auto-redeem check: ${positions.length} position(s) worth $${totalValue.toFixed(2)}`);
					}
				} catch (err) {
					log.error("Startup redeem check failed:", err instanceof Error ? err.message : String(err));
				}
			}, 5000);
		}
	} catch (err) {
		log.error("Failed to auto-connect wallet:", err instanceof Error ? err.message : String(err));
	}

	return { redeemTimerHandle };
}
