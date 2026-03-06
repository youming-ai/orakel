import { isLiveRunning } from "../core/state.ts";
import type { OrderManager } from "../trading/orderManager.ts";
import { getClient, getOpenGtdOrderCount, startHeartbeat } from "../trading/trader.ts";

interface EnsureOrderPollingParams {
	orderManager: OrderManager;
}

export function ensureOrderPolling({ orderManager }: EnsureOrderPollingParams): void {
	const clobClient = getClient();
	if (clobClient) {
		orderManager.setClient(clobClient);
		orderManager.startPolling();
		if (getOpenGtdOrderCount() > 0) {
			startHeartbeat();
		}
		return;
	}

	orderManager.setClient(null);
	if (!isLiveRunning()) {
		orderManager.stopPolling();
	}
}
