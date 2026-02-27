import { describe, expect, it } from "vitest";
import type { GammaMarket } from "../types.ts";
import { priceToBeatFromPolymarketMarket } from "./fetch.ts";

// Helper to create minimal valid GammaMarket objects for testing
function makeMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
	return {
		slug: "test-market",
		endDate: "2026-02-28T14:00:00Z",
		outcomes: ["Up", "Down"],
		outcomePrices: [0.5, 0.5],
		clobTokenIds: ["token-up", "token-down"],
		...overrides,
	};
}

describe("priceToBeatFromPolymarketMarket", () => {
	it("should extract price from question with 'price to beat $68,000'", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat $68,000 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should extract price with decimals from question", () => {
		const market = makeMarket({
			question: "Will ETH price be above price to beat $3,456.78 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(3456.78);
	});

	it("should extract price without comma separator", () => {
		const market = makeMarket({
			question: "Will SOL price be above price to beat $150 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(150);
	});

	it("should extract price with multiple commas", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat $100,000.50 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(100000.5);
	});

	it("should be case-insensitive for 'price to beat'", () => {
		const market = makeMarket({
			question: "Will BTC price be above PRICE TO BEAT $68,000 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should handle mixed case 'Price To Beat'", () => {
		const market = makeMarket({
			question: "Will BTC price be above Price To Beat $68,000 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should return null when question has no price to beat", () => {
		const market = makeMarket({
			question: "Will BTC price go up?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBeNull();
	});

	it("should return null when question is undefined", () => {
		const market = makeMarket({});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBeNull();
	});

	it("should return null when question is empty string", () => {
		const market = makeMarket({
			question: "",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBeNull();
	});

	it("should use title as fallback when question is undefined", () => {
		const market = makeMarket({
			title: "Will BTC price be above price to beat $68,000?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should return null when question is empty string even with title fallback", () => {
		const market = makeMarket({
			question: "",
			title: "Will ETH price be above price to beat $3,000?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		// Empty string is falsy but not null/undefined, so ?? doesn't fall back to title
		expect(result).toBeNull();
	});

	it("should return null when both question and title are undefined", () => {
		const market = makeMarket({});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBeNull();
	});

	it("should return null when both question and title are empty", () => {
		const market = makeMarket({
			question: "",
			title: "",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBeNull();
	});

	it("should handle price with no dollar sign", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat 68,000 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should handle whitespace variations around 'price to beat'", () => {
		const market = makeMarket({
			question: "Will BTC price be above price  to  beat  $68,000 at 2:00 PM ET?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should extract first valid price when multiple prices present", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat $68,000 or $70,000?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should handle very small decimal prices", () => {
		const market = makeMarket({
			question: "Will XRP price be above price to beat $0.50?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(0.5);
	});

	it("should handle very large prices", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat $1,000,000?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(1000000);
	});

	it("should return null for invalid price format", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat $abc?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBeNull();
	});

	it("should handle price with leading zeros", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat $068,000?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should handle price starting with decimal point", () => {
		const market = makeMarket({
			question: "Will XRP price be above price to beat $.50?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBeNull();
	});

	it("should extract price with multiple decimal places", () => {
		const market = makeMarket({
			question: "Will ETH price be above price to beat $3,456.789?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(3456.789);
	});

	it("should handle null title gracefully", () => {
		const market = makeMarket({
			question: "Will BTC price be above price to beat $68,000?",
			title: null as unknown as string,
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});

	it("should handle null question gracefully", () => {
		const market = makeMarket({
			question: null as unknown as string,
			title: "Will BTC price be above price to beat $68,000?",
		});
		const result = priceToBeatFromPolymarketMarket(market);
		expect(result).toBe(68000);
	});
});
