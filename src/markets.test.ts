import { describe, expect, it } from "vitest";
import { getActiveMarkets, getMarketById, MARKETS } from "./markets.ts";

describe("MARKETS constant", () => {
	it("should contain all expected markets", () => {
		const ids = MARKETS.map((m) => m.id);
		expect(ids).toContain("BTC");
		expect(ids).toContain("ETH");
		expect(ids).toContain("SOL");
		expect(ids).toContain("XRP");
	});

	it("should have exactly 4 markets", () => {
		expect(MARKETS).toHaveLength(4);
	});

	it("should have correct structure for BTC market", () => {
		const btc = MARKETS[0];
		expect(btc).toBeDefined();
		if (!btc) return;
		expect(btc.id).toBe("BTC");
		expect(btc.label).toBe("Bitcoin");
		expect(btc.binanceSymbol).toBe("BTCUSDT");
		expect(btc.polymarket).toBeDefined();
		expect(btc.polymarket.seriesId).toBe("10192");
		expect(btc.chainlink).toBeDefined();
		expect(btc.chainlink.aggregator).toBe("0xc907E116054Ad103354f2D350FD2514433D57F6f");
		expect(btc.pricePrecision).toBe(0);
	});

	it("should have correct structure for ETH market", () => {
		const eth = MARKETS[1];
		expect(eth).toBeDefined();
		if (!eth) return;
		expect(eth.id).toBe("ETH");
		expect(eth.label).toBe("Ethereum");
		expect(eth.binanceSymbol).toBe("ETHUSDT");
		expect(eth.pricePrecision).toBe(1);
	});

	it("should have correct structure for SOL market", () => {
		const sol = MARKETS[2];
		expect(sol).toBeDefined();
		if (!sol) return;
		expect(sol.id).toBe("SOL");
		expect(sol.label).toBe("Solana");
		expect(sol.binanceSymbol).toBe("SOLUSDT");
		expect(sol.pricePrecision).toBe(2);
	});

	it("should have correct structure for XRP market", () => {
		const xrp = MARKETS[3];
		expect(xrp).toBeDefined();
		if (!xrp) return;
		expect(xrp.id).toBe("XRP");
		expect(xrp.label).toBe("XRP");
		expect(xrp.binanceSymbol).toBe("XRPUSDT");
		expect(xrp.pricePrecision).toBe(4);
	});

	it("should have all required polymarket fields", () => {
		for (const market of MARKETS) {
			expect(market.polymarket.seriesId).toBeDefined();
			expect(market.polymarket.seriesSlug).toBeDefined();
			expect(market.polymarket.slugPrefix).toBeDefined();
		}
	});

	it("should have all required chainlink fields", () => {
		for (const market of MARKETS) {
			expect(market.chainlink.aggregator).toBeDefined();
			expect(market.chainlink.decimals).toBeDefined();
			expect(market.chainlink.wsSymbol).toBeDefined();
		}
	});
});

describe("getMarketById", () => {
	it("should return BTC market when id is 'BTC'", () => {
		const market = getMarketById("BTC");
		expect(market).not.toBeNull();
		expect(market?.id).toBe("BTC");
		expect(market?.label).toBe("Bitcoin");
	});

	it("should return ETH market when id is 'ETH'", () => {
		const market = getMarketById("ETH");
		expect(market).not.toBeNull();
		expect(market?.id).toBe("ETH");
		expect(market?.label).toBe("Ethereum");
	});

	it("should return SOL market when id is 'SOL'", () => {
		const market = getMarketById("SOL");
		expect(market).not.toBeNull();
		expect(market?.id).toBe("SOL");
	});

	it("should return XRP market when id is 'XRP'", () => {
		const market = getMarketById("XRP");
		expect(market).not.toBeNull();
		expect(market?.id).toBe("XRP");
	});

	it("should return null for invalid market id", () => {
		const market = getMarketById("INVALID");
		expect(market).toBeNull();
	});

	it("should return null for empty string", () => {
		const market = getMarketById("");
		expect(market).toBeNull();
	});

	it("should be case-sensitive", () => {
		const market = getMarketById("btc");
		expect(market).toBeNull();
	});

	it("should be case-sensitive for lowercase eth", () => {
		const market = getMarketById("eth");
		expect(market).toBeNull();
	});

	it("should return correct market object with all properties", () => {
		const market = getMarketById("BTC");
		expect(market).toHaveProperty("id");
		expect(market).toHaveProperty("label");
		expect(market).toHaveProperty("binanceSymbol");
		expect(market).toHaveProperty("polymarket");
		expect(market).toHaveProperty("chainlink");
		expect(market).toHaveProperty("pricePrecision");
	});
});

describe("getActiveMarkets", () => {
	// env.ACTIVE_MARKETS defaults to [] in test environment, so getActiveMarkets() returns all
	it("should return all markets when ACTIVE_MARKETS is empty", () => {
		const active = getActiveMarkets();
		expect(active).toHaveLength(4);
		expect(active.map((m) => m.id)).toEqual(["BTC", "ETH", "SOL", "XRP"]);
	});

	it("should return markets that are a subset of MARKETS", () => {
		const active = getActiveMarkets();
		expect(active.every((m) => MARKETS.includes(m))).toBe(true);
	});

	it("should return markets in original order", () => {
		const active = getActiveMarkets();
		const ids = active.map((m) => m.id);
		const expectedOrder = ["BTC", "ETH", "SOL", "XRP"];
		for (let i = 1; i < ids.length; i++) {
			const prevIdx = expectedOrder.indexOf(ids[i - 1] ?? "");
			const curIdx = expectedOrder.indexOf(ids[i] ?? "");
			expect(curIdx).toBeGreaterThan(prevIdx);
		}
	});

	it("should return non-empty result", () => {
		const active = getActiveMarkets();
		expect(active.length).toBeGreaterThan(0);
	});
});
