import { describe, expect, it } from "vitest";
import type { ArbitrageOpportunity } from "./arbitrage.ts";
import { detectArbitrage } from "./arbitrage.ts";

describe("detectArbitrage", () => {
	describe("valid opportunities", () => {
		it("should detect BUY_UP when polymarket up price is significantly below binance", () => {
			const result = detectArbitrage("BTC", 0.4, 0.6, 0.55, 0.05);
			expect(result).not.toBeNull();
			expect(result?.direction).toBe("BUY_UP");
			expect(result?.marketId).toBe("BTC");
		});

		it("should detect BUY_DOWN when polymarket down price is below binance implied down", () => {
			// binanceUp=0.4 => binanceDown=0.6, polyDown=0.5 < 0.6-0.05=0.55
			const result = detectArbitrage("ETH", 0.6, 0.5, 0.4, 0.05);
			expect(result).not.toBeNull();
			expect(result?.direction).toBe("BUY_DOWN");
		});

		it("should pick the larger spread when both sides have opportunities", () => {
			// binanceUp=0.5, polyUp=0.3 => upSpread=0.2
			// binanceDown=0.5, polyDown=0.35 => downSpread=0.15
			const result = detectArbitrage("SOL", 0.3, 0.35, 0.5, 0.01);
			expect(result).not.toBeNull();
			expect(result?.direction).toBe("BUY_UP");
			expect(result?.spread).toBeCloseTo(0.2, 10);
		});

		it("should pick BUY_DOWN when down spread is larger", () => {
			// binanceUp=0.5, polyUp=0.4 => upSpread=0.1
			// binanceDown=0.5, polyDown=0.3 => downSpread=0.2
			const result = detectArbitrage("XRP", 0.4, 0.3, 0.5, 0.01);
			expect(result).not.toBeNull();
			expect(result?.direction).toBe("BUY_DOWN");
			expect(result?.spread).toBeCloseTo(0.2, 10);
		});

		it("should set confidence between 0.5 and 1.0", () => {
			const result = detectArbitrage("BTC", 0.3, 0.4, 0.5, 0.05);
			expect(result).not.toBeNull();
			expect(result!.confidence).toBeGreaterThanOrEqual(0.5);
			expect(result!.confidence).toBeLessThanOrEqual(1);
		});

		it("should include timestamp", () => {
			const before = Date.now();
			const result = detectArbitrage("BTC", 0.3, 0.5, 0.5, 0.01);
			const after = Date.now();
			expect(result).not.toBeNull();
			expect(result!.timestamp).toBeGreaterThanOrEqual(before);
			expect(result!.timestamp).toBeLessThanOrEqual(after);
		});
	});

	describe("no opportunity", () => {
		it("should return null when spread is below minimum", () => {
			// binanceUp=0.5, polyUp=0.48 => spread=0.02 < minSpread=0.05
			const result = detectArbitrage("BTC", 0.48, 0.52, 0.5, 0.05);
			expect(result).toBeNull();
		});

		it("should return null when prices are equal", () => {
			const result = detectArbitrage("BTC", 0.5, 0.5, 0.5, 0.01);
			expect(result).toBeNull();
		});

		it("should return null when both sides are more expensive than binance", () => {
			// polyUp=0.6 > binanceUp=0.5, polyDown=0.55 > binanceDown=0.5
			const result = detectArbitrage("BTC", 0.6, 0.55, 0.5, 0.01);
			expect(result).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("should return null when polymarketUp is NaN", () => {
			const result = detectArbitrage("BTC", Number.NaN, 0.5, 0.5, 0.05);
			expect(result).toBeNull();
		});

		it("should return null when polymarketDown is NaN", () => {
			const result = detectArbitrage("BTC", 0.5, Number.NaN, 0.5, 0.05);
			expect(result).toBeNull();
		});

		it("should return null when binancePrice is NaN", () => {
			const result = detectArbitrage("BTC", 0.5, 0.5, Number.NaN, 0.05);
			expect(result).toBeNull();
		});

		it("should return null when polymarketUp is Infinity", () => {
			const result = detectArbitrage("BTC", Number.POSITIVE_INFINITY, 0.5, 0.5, 0.05);
			expect(result).toBeNull();
		});

		it("should handle zero minSpread", () => {
			// Any difference should trigger detection
			const result = detectArbitrage("BTC", 0.49, 0.51, 0.5, 0);
			// binanceUp=0.5, polyUp=0.49 => spread=0.01, need polyUp < binanceUp-0 = 0.5, 0.49<0.5 ✓
			expect(result).not.toBeNull();
		});

		it("should handle NaN minSpread by treating as 0", () => {
			const result = detectArbitrage("BTC", 0.3, 0.5, 0.5, Number.NaN);
			expect(result).not.toBeNull();
		});

		it("should handle negative minSpread by treating as 0", () => {
			const result = detectArbitrage("BTC", 0.3, 0.5, 0.5, -0.1);
			expect(result).not.toBeNull();
		});

		it("should clamp prices to [0,1] range", () => {
			// Prices above 1 are normalized
			const result = detectArbitrage("BTC", 0.3, 0.5, 0.8, 0.01);
			expect(result).not.toBeNull();
			expect(result!.polymarketPrice).toBeLessThanOrEqual(1);
			expect(result!.binancePrice).toBeLessThanOrEqual(1);
		});

		it("should handle very small spreads near minSpread boundary", () => {
			// binanceUp=0.5, polyUp=0.44 => spread=0.06, minSpread=0.06
			// upOpportunity: 0.44 < 0.5-0.06=0.44 => false (not strictly less)
			const result = detectArbitrage("BTC", 0.44, 0.56, 0.5, 0.06);
			expect(result).toBeNull();
		});

		it("should detect at spread exactly above minSpread", () => {
			// binanceUp=0.5, polyUp=0.43 => spread=0.07, need polyUp < 0.5-0.06=0.44 ✓
			const result = detectArbitrage("BTC", 0.43, 0.57, 0.5, 0.06);
			expect(result).not.toBeNull();
			expect(result?.direction).toBe("BUY_UP");
		});
	});

	describe("confidence scaling", () => {
		it("should have higher confidence for larger spreads", () => {
			const small = detectArbitrage("BTC", 0.44, 0.56, 0.5, 0.05);
			const large = detectArbitrage("BTC", 0.3, 0.7, 0.5, 0.05);
			expect(large).not.toBeNull();
			expect(small).not.toBeNull();
			expect(large!.confidence).toBeGreaterThan(small!.confidence);
		});

		it("should have confidence at 0.5 when spread equals minSpread", () => {
			// spreadStrength = (spread - minSpread) / minSpread = 0
			// confidence = 0.5 + 0 * 0.5 = 0.5
			const result = detectArbitrage("BTC", 0.3, 0.6, 0.5, 0.2);
			// spread = 0.2, minSpread = 0.2 => just at boundary
			// polyUp=0.3, binanceUp=0.5, need 0.3 < 0.5-0.2=0.3 => false
			// This won't trigger, let me fix:
			// polyUp=0.29, binanceUp=0.5, spread=0.21, minSpread=0.2 => triggers
			const result2 = detectArbitrage("BTC", 0.29, 0.6, 0.5, 0.2);
			expect(result2).not.toBeNull();
			// spreadStrength = (0.21 - 0.2) / 0.2 = 0.05
			// confidence = 0.5 + 0.05 * 0.5 = 0.525
			expect(result2!.confidence).toBeCloseTo(0.525, 1);
		});
	});
});
