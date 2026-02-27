import type { Phase } from "../types.ts";
import { estimatePolymarketFee } from "../utils.ts";

export type OrderStrategy = "FOK" | "GTD_POST_ONLY";

const FOK_CONFIDENCE_THRESHOLD = 0.7;
const MAKER_REBATE_RATE = 0.2;
const TAKER_REBATE_RATE = 0;

export interface OrderStrategyResult {
	strategy: OrderStrategy;
	reason: string;
	expectedFeeRate: number;
	makerRebate: number;
}

export interface PriceOptimization {
	buyPrice: number;
	priceImprovement: number;
	reason: string;
}

function getReferencePrice(marketUp: number, marketDown: number): number {
	return Math.max(marketUp, marketDown);
}

function getStrategyReason(strategy: OrderStrategy): string {
	if (strategy === "FOK") {
		return "late_phase_high_confidence_immediate_fill";
	}

	return "non_urgent_capture_maker_rebate";
}

function optimizeFokBuyPrice(marketPrice: number, side: "UP" | "DOWN"): PriceOptimization {
	return {
		buyPrice: marketPrice,
		priceImprovement: 0,
		reason: `${side.toLowerCase()}_fok_immediate_fill_at_market`,
	};
}

function optimizeGtdBuyPrice(marketPrice: number, side: "UP" | "DOWN", limitDiscount: number): PriceOptimization {
	const buyPrice = marketPrice * (1 - limitDiscount);
	return {
		buyPrice,
		priceImprovement: marketPrice - buyPrice,
		reason: `${side.toLowerCase()}_gtd_post_only_limit_discount_applied`,
	};
}

export function selectOrderStrategy(
	phase: Phase,
	confidence: number,
	marketUp: number,
	marketDown: number,
): OrderStrategyResult {
	const useFok = phase === "LATE" && confidence >= FOK_CONFIDENCE_THRESHOLD;
	const strategy: OrderStrategy = useFok ? "FOK" : "GTD_POST_ONLY";
	const makerRebate = useFok ? TAKER_REBATE_RATE : MAKER_REBATE_RATE;
	const referencePrice = getReferencePrice(marketUp, marketDown);

	return {
		strategy,
		reason: getStrategyReason(strategy),
		expectedFeeRate: estimatePolymarketFee(referencePrice, makerRebate),
		makerRebate,
	};
}

export function optimizeBuyPrice(
	marketPrice: number,
	side: "UP" | "DOWN",
	limitDiscount: number,
	strategy: OrderStrategy,
): PriceOptimization {
	if (strategy === "FOK") {
		return optimizeFokBuyPrice(marketPrice, side);
	}

	return optimizeGtdBuyPrice(marketPrice, side, limitDiscount);
}
