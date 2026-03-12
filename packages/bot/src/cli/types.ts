export interface CliResult<T> {
	ok: boolean;
	data?: T;
	error?: string;
	durationMs: number;
}

export interface CliOrderResponse {
	orderID: string;
	status: string;
}

export interface CliBalanceResponse {
	collateral: string;
}

export interface CliPositionEntry {
	asset: string;
	size: string;
	avgPrice: string;
	curPrice: string;
}
