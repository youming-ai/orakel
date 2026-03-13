import { execCli } from "./executor.ts";
import type {
	CliBalanceResponse,
	CliOrderResponse,
	CliPositionEntry,
	CliResult,
	CliWalletAddressResponse,
} from "./types.ts";

export function createOrder(params: {
	tokenId: string;
	side: "buy";
	price: number;
	size: number;
	orderType: "GTC" | "GTD" | "FOK";
}): Promise<CliResult<CliOrderResponse>> {
	return execCli<CliOrderResponse>([
		"clob",
		"create-order",
		"--token",
		params.tokenId,
		"--side",
		params.side,
		"--price",
		String(params.price),
		"--size",
		String(params.size),
		"--order-type",
		params.orderType,
	]);
}

export function cancelOrder(orderId: string): Promise<CliResult<void>> {
	return execCli<void>(["clob", "cancel", "--order-id", orderId], { parseJson: false });
}

export function cancelAll(): Promise<CliResult<void>> {
	return execCli<void>(["clob", "cancel-all"], { parseJson: false });
}

export function getBalance(): Promise<CliResult<CliBalanceResponse>> {
	return execCli<CliBalanceResponse>(["clob", "balance", "--asset-type", "collateral"]);
}

export async function getPositions(): Promise<CliResult<CliPositionEntry[]>> {
	const wallet = await execCli<CliWalletAddressResponse>(["wallet", "address"]);
	if (!wallet.ok || !wallet.data?.address) {
		return {
			ok: false,
			error: wallet.error || "Failed to resolve wallet address",
			durationMs: wallet.durationMs,
		};
	}
	return execCli<CliPositionEntry[]>(["data", "positions", wallet.data.address]);
}

export function redeemPositions(): Promise<CliResult<unknown>> {
	return execCli<unknown>(["ctf", "redeem"], { timeoutMs: 30_000 });
}

export function checkCliAvailable(): Promise<boolean> {
	return execCli<unknown>(["--version"], { parseJson: false, timeoutMs: 5_000 })
		.then((r) => r.ok)
		.catch(() => false);
}

export function getOrderStatus(orderId: string): Promise<CliResult<CliOrderResponse>> {
	return execCli<CliOrderResponse>(["clob", "order", orderId]);
}
