import { createLogger } from "../core/logger.ts";
import type { Side } from "../core/types.ts";
import type { AccountManager } from "./account.ts";

const log = createLogger("paper-trader");

export interface PaperTradeParams {
	windowSlug: string;
	side: Side;
	price: number;
	size: number;
	edge: number;
	modelProb: number;
	marketProb: number;
	priceToBeat: number;
	entryBtcPrice: number;
	phase: string;
}

export interface PaperTradeResult {
	success: boolean;
	tradeIndex: number;
}

export function executePaperTrade(params: PaperTradeParams, account: AccountManager): PaperTradeResult {
	const tradeIndex = account.recordTrade({
		side: params.side,
		size: params.size,
		price: params.price,
	});
	log.info("Paper trade executed", {
		window: params.windowSlug,
		side: params.side,
		price: params.price,
		size: params.size,
		edge: params.edge.toFixed(4),
	});
	return { success: true, tradeIndex };
}
