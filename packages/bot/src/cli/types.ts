export interface CliResult<T> {
	ok: boolean;
	data?: T;
	error?: string;
	durationMs: number;
}

export interface CliOrderResponse {
	orderID?: string;
	orderId?: string;
	id?: string;
	status: string;
}

export interface CliBalanceResponse {
	balance?: string;
	collateral?: string;
}

export interface CliWalletAddressResponse {
	address: string;
}

export interface CliPositionEntry {
	slug?: string;
	condition_id?: string;
	outcome?: string;
	size: string;
	avg_price?: string;
	cur_price?: string;
	current_value?: string;
	redeemable?: boolean;
}
