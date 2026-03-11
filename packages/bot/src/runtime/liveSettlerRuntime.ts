import { isLiveRunning } from "../core/state.ts";
import type { AccountStatsManager } from "../trading/accountStats.ts";
import { LiveSettler } from "../trading/liveSettler.ts";
import { getWallet } from "../trading/trader.ts";

interface LiveSettlerControllerParams {
	liveAccount: AccountStatsManager;
}

export interface LiveSettlerController {
	ensure(): void;
	getInstance(): LiveSettler | null;
	clearInstance(): void;
}

export function createLiveSettlerController({ liveAccount }: LiveSettlerControllerParams): LiveSettlerController {
	let liveSettlerInstance: LiveSettler | null = null;

	return {
		ensure(): void {
			if (liveSettlerInstance?.isRunning()) return;

			// 只有在 live 模式运行中或有 won trades 时才启动
			const hasWonTrades = liveAccount.getWonTrades().length > 0;
			if (!isLiveRunning() && !hasWonTrades) return;

			liveSettlerInstance = new LiveSettler(getWallet());
			liveSettlerInstance.start();
		},
		getInstance(): LiveSettler | null {
			return liveSettlerInstance;
		},
		clearInstance(): void {
			liveSettlerInstance?.stop();
			liveSettlerInstance = null;
		},
	};
}
