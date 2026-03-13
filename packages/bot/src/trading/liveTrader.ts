import type { AppConfig } from "@orakel/shared/contracts";
import { cancelAll, createOrder, getBalance, getOrderStatus, getPositions } from "../cli/commands.ts";
import { createLogger } from "../core/logger.ts";
import type { Side } from "../core/types.ts";

const log = createLogger("live-trader");

export interface LiveTradeParams {
	tokenId: string;
	side: Side;
	price: number;
	size: number;
	windowSlug: string;
	edge: number;
}

export interface LiveTradeResult {
	success: boolean;
	orderId: string | null;
	error?: string;
}

export async function executeLiveTrade(params: LiveTradeParams, config: AppConfig): Promise<LiveTradeResult> {
	const limitPrice = Math.max(
		config.execution.minOrderPrice,
		Math.min(config.execution.maxOrderPrice, params.price - config.execution.limitDiscount),
	);

	const result = await createOrder({
		tokenId: params.tokenId,
		side: "buy",
		price: Number(limitPrice.toFixed(2)),
		size: params.size,
		orderType: config.execution.orderType as "GTC" | "GTD" | "FOK",
	});

	if (!result.ok) {
		log.warn("Live trade failed", { window: params.windowSlug, error: result.error });
		return { success: false, orderId: null, error: result.error };
	}

	const orderId = result.data?.orderID ?? null;
	log.info("Live trade placed", {
		window: params.windowSlug,
		side: params.side,
		price: limitPrice,
		size: params.size,
		orderId,
	});
	return { success: true, orderId };
}

export async function checkLiveReady(minBalanceUsdc: number): Promise<{ ok: boolean; error?: string }> {
	const balanceResult = await getBalance();
	if (!balanceResult.ok) {
		return { ok: false, error: `Failed to get balance: ${balanceResult.error}` };
	}

	const balance = Number(balanceResult.data?.collateral ?? 0);
	if (balance < minBalanceUsdc) {
		return { ok: false, error: `Insufficient balance: ${balance.toFixed(2)} USDC (need ${minBalanceUsdc})` };
	}

	const positionsResult = await getPositions();
	if (!positionsResult.ok) {
		return { ok: false, error: `Failed to get positions: ${positionsResult.error}` };
	}

	if ((positionsResult.data ?? []).length > 0) {
		return { ok: false, error: "Existing positions found. Close before starting live mode." };
	}

	log.info("Live mode pre-flight passed", { balance });
	return { ok: true };
}

export async function getLiveBalance(): Promise<{ ok: boolean; balance?: number; error?: string }> {
	const result = await getBalance();
	if (!result.ok) {
		return { ok: false, error: result.error };
	}
	return { ok: true, balance: Number(result.data?.collateral ?? 0) };
}

export async function hasLivePosition(
	upTokenId: string,
	downTokenId: string,
): Promise<{ ok: boolean; hasPosition?: boolean; error?: string }> {
	const result = await getPositions();
	if (!result.ok) {
		return { ok: false, error: result.error };
	}
	const positions = result.data ?? [];
	const found = positions.some((p) => p.asset === upTokenId || p.asset === downTokenId);
	return { ok: true, hasPosition: found };
}

export async function checkOrderFilled(orderId: string): Promise<boolean> {
	const result = await getOrderStatus(orderId);
	if (!result.ok || !result.data) return false;
	const status = result.data.status.toUpperCase();
	return status === "FILLED" || status === "MATCHED";
}

export async function cancelAllOrders(): Promise<{ ok: boolean; error?: string }> {
	const result = await cancelAll();
	if (!result.ok) {
		log.warn("Failed to cancel all orders", { error: result.error });
		return { ok: false, error: result.error };
	}
	log.info("All orders cancelled");
	return { ok: true };
}
