import { createLogger } from "../core/logger.ts";
import { setLiveRunning, setPaperRunning } from "../core/state.ts";
import type { ClobWsHandle } from "../data/polymarketClobWs.ts";
import { closeDb } from "../db/client.ts";
import type { OnchainRuntime } from "../runtime/onchainRuntime.ts";
import type { LiveSettler } from "../trading/liveSettler.ts";
import type { OrderManager } from "../trading/orderManager.ts";
import { stopHeartbeat } from "../trading/trader.ts";
import type { StreamHandles } from "../trading/tradeTypes.ts";

const log = createLogger("shutdown");

interface ShutdownParams {
	getLiveSettler: () => LiveSettler | null;
	clearLiveSettler: () => void;
	orderManager: OrderManager;
	streams: StreamHandles;
	clobWs: ClobWsHandle;
	onchainRuntime: OnchainRuntime;
	getRedeemTimerHandle: () => ReturnType<typeof setInterval> | null;
	clearRedeemTimerHandle: () => void;
}

export function registerShutdownHandlers({
	getLiveSettler,
	clearLiveSettler,
	orderManager,
	streams,
	clobWs,
	onchainRuntime,
	getRedeemTimerHandle,
	clearRedeemTimerHandle,
}: ShutdownParams): void {
	const shutdown = () => {
		log.info("Shutdown signal received, stopping bot...");
		const liveSettler = getLiveSettler();
		if (liveSettler) {
			liveSettler.stop();
			clearLiveSettler();
		}
		orderManager.stopPolling();
		stopHeartbeat();
		setPaperRunning(false);
		setLiveRunning(false);
		streams.binance.close();
		streams.polymarket.close();
		clobWs.close();
		for (const [, handle] of streams.chainlink) {
			handle.close();
		}
		onchainRuntime.closePipelines();

		const redeemTimerHandle = getRedeemTimerHandle();
		if (redeemTimerHandle) {
			clearInterval(redeemTimerHandle);
			clearRedeemTimerHandle();
			log.info("Auto-redeem timer stopped");
		}

		void closeDb().then(() => {
			setTimeout(() => process.exit(0), 2000);
		});
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}
