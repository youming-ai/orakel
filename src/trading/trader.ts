export { executeTrade } from "./executionService.ts";
export {
	getOpenGtdOrderCount,
	isHeartbeatReconnecting,
	registerOpenGtdOrder,
	startHeartbeat,
	stopHeartbeat,
	unregisterOpenGtdOrder,
} from "./heartbeatService.ts";
export {
	connectWallet,
	disconnectWallet,
	getClient,
	getClientStatus,
	getWallet,
	getWalletAddress,
	initTrader,
} from "./walletService.ts";
