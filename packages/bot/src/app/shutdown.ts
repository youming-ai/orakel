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

const CANCEL_TIMEOUT_MS = 5_000;

async function cancelActiveOrders(orderManager: ShutdownParams["orderManager"]): Promise<void> {
	const activeOrders = orderManager.getActiveOrders();
	if (activeOrders.length === 0) return;

	log.info(`Cancelling ${activeOrders.length} active order(s) before shutdown...`);
	const cancelPromises = activeOrders.map((o) =>
		orderManager.cancelOrder(o.orderId).catch((err) => {
			log.warn(`Failed to cancel order ${o.orderId.slice(0, 12)}:`, err instanceof Error ? err.message : String(err));
			return false;
		}),
	);
	await Promise.race([
		Promise.allSettled(cancelPromises),
		new Promise((resolve) => setTimeout(resolve, CANCEL_TIMEOUT_MS)),
	]);
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
	const shutdown = async () => {
		log.info("Shutdown signal received, stopping bot...");
		await cancelActiveOrders(orderManager);

		const liveSettler = getLiveSettler();
		if (liveSettler) {
			liveSettler.stop();
			clearLiveSettler();
		}
		orderManager.stopPolling();
		stopHeartbeat();
		setPaperRunning(false);
		setLiveRunning(false);
		streams.spot.close();
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

		await closeDb();
		setTimeout(() => process.exit(0), 2000);
	};

	process.on("SIGTERM", () => void shutdown());
	process.on("SIGINT", () => void shutdown());
}
