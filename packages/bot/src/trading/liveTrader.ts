import type { AppConfig } from "@orakel/shared/contracts";
import { createOrder } from "../cli/commands.ts";
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
