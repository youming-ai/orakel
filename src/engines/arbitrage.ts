import { clamp } from "../utils.ts";

export interface ArbitrageOpportunity {
	marketId: string;
	polymarketPrice: number;
	binancePrice: number;
	spread: number;
	direction: "BUY_UP" | "BUY_DOWN" | "SKIP";
	confidence: number;
	timestamp: number;
}

function normalizeProbability(value: number): number | null {
	if (!Number.isFinite(value)) {
		return null;
	}

	return clamp(value, 0, 1);
}

function buildOpportunity(params: {
	marketId: string;
	polymarketPrice: number;
	binancePrice: number;
	spread: number;
	direction: "BUY_UP" | "BUY_DOWN";
	minSpread: number;
}): ArbitrageOpportunity {
	const { marketId, polymarketPrice, binancePrice, spread, direction, minSpread } = params;
	const safeMinSpread = Math.max(minSpread, 0.0001);
	const spreadStrength = clamp((spread - minSpread) / safeMinSpread, 0, 1);
	const confidence = clamp(0.5 + spreadStrength * 0.5, 0, 1);

	return {
		marketId,
		polymarketPrice,
		binancePrice,
		spread,
		direction,
		confidence,
		timestamp: Date.now(),
	};
}

export function detectArbitrage(
	marketId: string,
	polymarketUp: number,
	polymarketDown: number,
	binancePrice: number,
	minSpread: number,
): ArbitrageOpportunity | null {
	const upPrice = normalizeProbability(polymarketUp);
	const downPrice = normalizeProbability(polymarketDown);
	const binanceUp = normalizeProbability(binancePrice);
	const minSpreadValue = Number.isFinite(minSpread) ? Math.max(minSpread, 0) : 0;

	if (upPrice === null || downPrice === null || binanceUp === null) {
		return null;
	}

	const binanceDown = 1 - binanceUp;
	const upSpread = Math.abs(binanceUp - upPrice);
	const downSpread = Math.abs(binanceDown - downPrice);

	const upOpportunity = upPrice < binanceUp - minSpreadValue;
	const downOpportunity = downPrice < binanceDown - minSpreadValue;

	if (!upOpportunity && !downOpportunity) {
		return null;
	}

	if (upOpportunity && downOpportunity) {
		if (upSpread >= downSpread) {
			return buildOpportunity({
				marketId,
				polymarketPrice: upPrice,
				binancePrice: binanceUp,
				spread: upSpread,
				direction: "BUY_UP",
				minSpread: minSpreadValue,
			});
		}

		return buildOpportunity({
			marketId,
			polymarketPrice: downPrice,
			binancePrice: binanceDown,
			spread: downSpread,
			direction: "BUY_DOWN",
			minSpread: minSpreadValue,
		});
	}

	if (upOpportunity) {
		return buildOpportunity({
			marketId,
			polymarketPrice: upPrice,
			binancePrice: binanceUp,
			spread: upSpread,
			direction: "BUY_UP",
			minSpread: minSpreadValue,
		});
	}

	return buildOpportunity({
		marketId,
		polymarketPrice: downPrice,
		binancePrice: binanceDown,
		spread: downSpread,
		direction: "BUY_DOWN",
		minSpread: minSpreadValue,
	});
}
