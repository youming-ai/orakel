import type { Wallet } from "ethers";
import { fetchRedeemablePositions, redeemByConditionId } from "../blockchain/redeemer.ts";
import { createLogger } from "../core/logger.ts";
import { kvQueries } from "../db/queries.ts";

const log = createLogger("live-settler");

const POLL_INTERVAL_MS = 15_000;
const REDEEMED_KEY = "redeemed_condition_ids";

export class LiveSettler {
	private wallet: Wallet | null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private redeemed = new Set<string>();

	constructor(wallet: Wallet | null) {
		this.wallet = wallet;
		void this.load();
	}

	private async load(): Promise<void> {
		try {
			const json = await kvQueries.get(REDEEMED_KEY);
			if (json) {
				const ids = JSON.parse(json) as string[];
				this.redeemed = new Set(ids);
				log.info(`Loaded ${ids.length} redeemed condition IDs`);
			}
		} catch (err) {
			log.warn("Failed to load redeemed IDs:", err);
		}
	}

	private async save(): Promise<void> {
		try {
			await kvQueries.set(REDEEMED_KEY, JSON.stringify([...this.redeemed]));
		} catch (err) {
			log.warn("Failed to save redeemed IDs:", err);
		}
	}

	async settle(): Promise<number> {
		if (this.running || !this.wallet) return 0;
		this.running = true;

		let count = 0;
		try {
			const positions = await fetchRedeemablePositions(this.wallet.address);

			for (const pos of positions) {
				const cid = pos.conditionId.toLowerCase();
				if (this.redeemed.has(cid)) continue;

				const result = await redeemByConditionId(this.wallet, pos.conditionId);
				if (result.success) {
					this.redeemed.add(cid);
					void this.save();
					count++;
					const value = pos.currentValue ? `$${pos.currentValue.toFixed(2)}` : "";
					log.info(`Redeemed: ${pos.title?.slice(0, 30)}... ${value} tx=${result.txHash?.slice(0, 10)}...`);
				} else if (result.error && !result.error.includes("not_resolved")) {
					log.warn(`Redeem failed: ${pos.conditionId.slice(0, 10)}... - ${result.error}`);
				}
			}
		} catch (err) {
			log.error("settle() error:", err instanceof Error ? err.message : String(err));
		} finally {
			this.running = false;
		}

		return count;
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.settle(), POLL_INTERVAL_MS);
		void this.settle();
		log.info(`LiveSettler started (poll every ${POLL_INTERVAL_MS}ms)`);
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
