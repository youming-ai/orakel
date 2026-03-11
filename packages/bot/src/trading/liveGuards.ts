export interface LiveStartReadinessInput {
	walletLoaded: boolean;
	clientReady: boolean;
	stopLossActive: boolean;
}

export function getLiveStartReadinessError(input: LiveStartReadinessInput): string | null {
	if (input.stopLossActive) {
		return "Live trading is stopped by risk controls. Clear stop flag before starting.";
	}
	if (!input.walletLoaded) {
		return "Wallet not connected. Connect wallet before starting live trading.";
	}
	if (!input.clientReady) {
		return "Trading client not ready. Reconnect wallet before starting live trading.";
	}
	return null;
}
