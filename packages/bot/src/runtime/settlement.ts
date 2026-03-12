import { createLogger } from "../core/logger.ts";
import type { AccountManager } from "../trading/account.ts";

const log = createLogger("settlement");

export interface SettlementParams {
	windowSlug: string;
	priceToBeat: number;
	settleBtcPrice: number;
	tradeIndex: number;
	side: "UP" | "DOWN";
}

export function settleWindow(params: SettlementParams, account: AccountManager): { won: boolean } {
	const priceUp = params.settleBtcPrice >= params.priceToBeat;
	const won = (params.side === "UP" && priceUp) || (params.side === "DOWN" && !priceUp);
	account.settleTrade(params.tradeIndex, won);
	log.info("Window settled", {
		window: params.windowSlug,
		side: params.side,
		won,
		settleBtcPrice: params.settleBtcPrice,
		priceToBeat: params.priceToBeat,
	});
	return { won };
}
