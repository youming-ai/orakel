import { describe, expect, it } from "vitest";
import {
	filterBtcUpDown15mMarkets,
	flattenEventMarkets,
	pickLatestLiveMarket,
	summarizeOrderBook,
} from "./polymarket.ts";

const BASE_NOW_MS = Date.parse("2026-02-26T00:00:00.000Z");

function minutesFromBase(minutes: number): string {
	return new Date(BASE_NOW_MS + minutes * 60_000).toISOString();
}

function makeMarket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		slug: "btc-updown-15m-default",
		endDate: minutesFromBase(15),
		...overrides,
	};
}

describe("flattenEventMarkets", () => {
	it("should return [] for empty array", () => {
		expect(flattenEventMarkets([])).toEqual([]);
	});

	it("should return [] for non-array input", () => {
		const nonArrayInput = { markets: [{ slug: "x" }] } as unknown as unknown[];
		expect(flattenEventMarkets(nonArrayInput)).toEqual([]);
	});

	it("should return [] when events have no markets property", () => {
		const events = [{ slug: "event-a" }, { id: 2 }];
		expect(flattenEventMarkets(events)).toEqual([]);
	});

	it("should return [] when all markets arrays are empty", () => {
		const events = [{ markets: [] }, { markets: [] }];
		expect(flattenEventMarkets(events)).toEqual([]);
	});

	it("should flatten a single event with multiple markets", () => {
		const first = { slug: "btc-updown-15m-a" };
		const second = { slug: "btc-updown-15m-b" };
		const events = [{ markets: [first, second] }];
		expect(flattenEventMarkets(events)).toEqual([first, second]);
	});

	it("should flatten multiple events with multiple markets preserving order", () => {
		const m1 = { slug: "m1" };
		const m2 = { slug: "m2" };
		const m3 = { slug: "m3" };
		const m4 = { slug: "m4" };
		const events = [{ markets: [m1, m2] }, { markets: [m3] }, { markets: [m4] }];
		expect(flattenEventMarkets(events)).toEqual([m1, m2, m3, m4]);
	});

	it("should skip non-object event entries gracefully", () => {
		const events = [null, "event", 123, true, []] as unknown[];
		expect(flattenEventMarkets(events)).toEqual([]);
	});

	it("should flatten only valid event markets from mixed valid and invalid entries", () => {
		const keepA = { slug: "keep-a" };
		const keepB = { slug: "keep-b" };
		const events = [
			{ markets: [keepA] },
			null,
			{ markets: "not-array" },
			{ other: [1, 2, 3] },
			{ markets: [keepB] },
		] as unknown[];
		expect(flattenEventMarkets(events)).toEqual([keepA, keepB]);
	});
});

describe("pickLatestLiveMarket", () => {
	it("should return null for empty array", () => {
		expect(pickLatestLiveMarket([], BASE_NOW_MS)).toBeNull();
	});

	it("should return null for non-array input", () => {
		const nonArrayInput = { endDate: minutesFromBase(10) } as unknown as unknown[];
		expect(pickLatestLiveMarket(nonArrayInput, BASE_NOW_MS)).toBeNull();
	});

	it("should skip markets without endDate", () => {
		const markets = [
			{ slug: "no-end" },
			{ slug: "bad-end", endDate: "not-a-date" },
			{ slug: "also-no-end", endDate: null },
		];
		expect(pickLatestLiveMarket(markets, BASE_NOW_MS)).toBeNull();
	});

	it("should return a single live market when started and not ended", () => {
		const liveMarket = makeMarket({
			slug: "live",
			startTime: minutesFromBase(-5),
			endDate: minutesFromBase(10),
		});
		expect(pickLatestLiveMarket([liveMarket], BASE_NOW_MS)).toBe(liveMarket);
	});

	it("should return the earliest-ending market among multiple live markets", () => {
		const laterLive = makeMarket({ slug: "later-live", startTime: minutesFromBase(-10), endDate: minutesFromBase(12) });
		const earliestLive = makeMarket({
			slug: "earliest-live",
			startTime: minutesFromBase(-10),
			endDate: minutesFromBase(3),
		});
		const anotherLive = makeMarket({
			slug: "another-live",
			startTime: minutesFromBase(-1),
			endDate: minutesFromBase(8),
		});
		expect(pickLatestLiveMarket([laterLive, earliestLive, anotherLive], BASE_NOW_MS)).toBe(earliestLive);
	});

	it("should not select a market that has not started as live", () => {
		const notStarted = makeMarket({ slug: "not-started", startTime: minutesFromBase(5), endDate: minutesFromBase(6) });
		const live = makeMarket({ slug: "live", startTime: minutesFromBase(-10), endDate: minutesFromBase(15) });
		expect(pickLatestLiveMarket([notStarted, live], BASE_NOW_MS)).toBe(live);
	});

	it("should return null when all markets are already ended", () => {
		const pastA = makeMarket({ slug: "past-a", endDate: minutesFromBase(-20) });
		const pastB = makeMarket({ slug: "past-b", endDate: minutesFromBase(-1) });
		expect(pickLatestLiveMarket([pastA, pastB], BASE_NOW_MS)).toBeNull();
	});

	it("should treat market starting exactly at nowMs as started", () => {
		const startsNow = makeMarket({ slug: "starts-now", startTime: minutesFromBase(0), endDate: minutesFromBase(10) });
		expect(pickLatestLiveMarket([startsNow], BASE_NOW_MS)).toBe(startsNow);
	});

	it("should treat market ending exactly at nowMs as ended", () => {
		const endedNow = makeMarket({ slug: "ended-now", startTime: minutesFromBase(-5), endDate: minutesFromBase(0) });
		expect(pickLatestLiveMarket([endedNow], BASE_NOW_MS)).toBeNull();
	});

	it("should return earliest upcoming market when no live markets exist", () => {
		const upcomingLater = makeMarket({
			slug: "upcoming-later",
			startTime: minutesFromBase(20),
			endDate: minutesFromBase(35),
		});
		const upcomingSooner = makeMarket({
			slug: "upcoming-sooner",
			startTime: minutesFromBase(5),
			endDate: minutesFromBase(10),
		});
		expect(pickLatestLiveMarket([upcomingLater, upcomingSooner], BASE_NOW_MS)).toBe(upcomingSooner);
	});

	it("should return live market over upcoming market in mixed timeline", () => {
		const past = makeMarket({ slug: "past", endDate: minutesFromBase(-30) });
		const upcomingSoon = makeMarket({
			slug: "upcoming-soon",
			startTime: minutesFromBase(2),
			endDate: minutesFromBase(4),
		});
		const live = makeMarket({ slug: "live", startTime: minutesFromBase(-3), endDate: minutesFromBase(8) });
		expect(pickLatestLiveMarket([past, upcomingSoon, live], BASE_NOW_MS)).toBe(live);
	});

	it("should respect custom nowMs parameter", () => {
		const market = makeMarket({ slug: "custom-now", startTime: minutesFromBase(5), endDate: minutesFromBase(25) });
		expect(pickLatestLiveMarket([market], BASE_NOW_MS)).toBe(market);
		expect(pickLatestLiveMarket([market], BASE_NOW_MS + 30 * 60_000)).toBeNull();
	});
});

describe("filterBtcUpDown15mMarkets", () => {
	it("should return [] for empty array", () => {
		expect(filterBtcUpDown15mMarkets([])).toEqual([]);
	});

	it("should return [] for non-array input", () => {
		const nonArrayInput = { slug: "btc-updown-15m-test" } as unknown as unknown[];
		expect(filterBtcUpDown15mMarkets(nonArrayInput, { slugPrefix: "btc-updown-15m" })).toEqual([]);
	});

	it("should match by slugPrefix only", () => {
		const match = { slug: "btc-updown-15m-abc" };
		const nonMatch = { slug: "eth-updown-15m-abc" };
		expect(filterBtcUpDown15mMarkets([match, nonMatch], { slugPrefix: "btc-updown-15m" })).toEqual([match]);
	});

	it("should match by seriesSlug from nested events.series slug", () => {
		const match = {
			slug: "other-market",
			events: [{ series: [{ slug: "crypto-btc-up-down" }] }],
		};
		const nonMatch = {
			slug: "other-market-2",
			events: [{ series: [{ slug: "crypto-eth-up-down" }] }],
		};
		expect(filterBtcUpDown15mMarkets([match, nonMatch], { seriesSlug: "crypto-btc-up-down" })).toEqual([match]);
	});

	it("should match by seriesSlug from event.seriesSlug and market.seriesSlug", () => {
		const eventSeriesMatch = { slug: "a", events: [{ seriesSlug: "btc-15m-series" }] };
		const marketSeriesMatch = { slug: "b", seriesSlug: "btc-15m-series" };
		const nonMatch = { slug: "c", seriesSlug: "other-series" };
		expect(
			filterBtcUpDown15mMarkets([eventSeriesMatch, marketSeriesMatch, nonMatch], { seriesSlug: "btc-15m-series" }),
		).toEqual([eventSeriesMatch, marketSeriesMatch]);
	});

	it("should match when either slugPrefix or seriesSlug matches", () => {
		const prefixOnly = { slug: "btc-updown-15m-x", seriesSlug: "wrong-series" };
		const seriesOnly = { slug: "not-btc-updown", seriesSlug: "btc-series" };
		const both = { slug: "btc-updown-15m-y", seriesSlug: "btc-series" };
		const none = { slug: "eth-updown-15m-z", seriesSlug: "eth-series" };
		expect(
			filterBtcUpDown15mMarkets([prefixOnly, seriesOnly, both, none], {
				slugPrefix: "btc-updown-15m",
				seriesSlug: "btc-series",
			}),
		).toEqual([prefixOnly, seriesOnly, both]);
	});

	it("should return [] when there are no matches", () => {
		const markets = [{ slug: "eth-updown-15m-a" }, { slug: "sol-updown-15m-b" }];
		expect(filterBtcUpDown15mMarkets(markets, { slugPrefix: "btc-updown-15m", seriesSlug: "btc-series" })).toEqual([]);
	});

	it("should perform case-insensitive matching for prefix and series", () => {
		const byPrefix = { slug: "BTC-UpDown-15M-AAA" };
		const bySeries = { slug: "x", seriesSlug: "BtC-SeRiEs" };
		expect(
			filterBtcUpDown15mMarkets([byPrefix, bySeries], { slugPrefix: "btc-updown-15m", seriesSlug: "btc-series" }),
		).toEqual([byPrefix, bySeries]);
	});

	it("should return [] when both slugPrefix and seriesSlug options are missing", () => {
		const markets = [{ slug: "btc-updown-15m-a", seriesSlug: "btc-series" }];
		expect(filterBtcUpDown15mMarkets(markets)).toEqual([]);
	});

	it("should not match market without slug unless seriesSlug matches", () => {
		const noSlug = { id: "x" };
		const noSlugButSeriesMatch = { id: "y", seriesSlug: "btc-series" };
		expect(filterBtcUpDown15mMarkets([noSlug, noSlugButSeriesMatch], { slugPrefix: "btc-updown-15m" })).toEqual([]);
		expect(filterBtcUpDown15mMarkets([noSlug, noSlugButSeriesMatch], { seriesSlug: "btc-series" })).toEqual([
			noSlugButSeriesMatch,
		]);
	});

	it("should filter mixed matching and non-matching markets", () => {
		const matchPrefix = { slug: "btc-updown-15m-1" };
		const matchSeriesNested = {
			slug: "other",
			events: [{ series: [{ slug: "btc-series" }] }],
		};
		const noMatch = { slug: "xrp-updown-15m-1", seriesSlug: "xrp-series" };
		expect(
			filterBtcUpDown15mMarkets([matchPrefix, matchSeriesNested, noMatch], {
				slugPrefix: "btc-updown-15m",
				seriesSlug: "btc-series",
			}),
		).toEqual([matchPrefix, matchSeriesNested]);
	});
});

describe("summarizeOrderBook", () => {
	it("should return null/zero summary for null book", () => {
		expect(summarizeOrderBook(null)).toEqual({
			bestBid: null,
			bestAsk: null,
			spread: null,
			bidLiquidity: 0,
			askLiquidity: 0,
		});
	});

	it("should return null/zero summary when book has no bids and asks", () => {
		expect(summarizeOrderBook({})).toEqual({
			bestBid: null,
			bestAsk: null,
			spread: null,
			bidLiquidity: 0,
			askLiquidity: 0,
		});
	});

	it("should compute best prices, spread, and liquidity for single bid and ask", () => {
		const result = summarizeOrderBook({
			bids: [{ price: "0.65", size: "100" }],
			asks: [{ price: "0.67", size: "50" }],
		});
		expect(result).toEqual({
			bestBid: 0.65,
			bestAsk: 0.67,
			spread: 0.020000000000000018,
			bidLiquidity: 100,
			askLiquidity: 50,
		});
	});

	it("should use maximum bid price as bestBid from multiple bids", () => {
		const result = summarizeOrderBook({
			bids: [
				{ price: "0.61", size: "5" },
				{ price: "0.63", size: "7" },
				{ price: "0.62", size: "9" },
			],
			asks: [],
		});
		expect(result.bestBid).toBe(0.63);
	});

	it("should use minimum ask price as bestAsk from multiple asks", () => {
		const result = summarizeOrderBook({
			bids: [],
			asks: [
				{ price: "0.71", size: "5" },
				{ price: "0.69", size: "7" },
				{ price: "0.70", size: "9" },
			],
		});
		expect(result.bestAsk).toBe(0.69);
	});

	it("should compute spread as bestAsk - bestBid", () => {
		const result = summarizeOrderBook({
			bids: [
				{ price: "0.64", size: "10" },
				{ price: "0.62", size: "10" },
			],
			asks: [
				{ price: "0.70", size: "10" },
				{ price: "0.68", size: "10" },
			],
		});
		expect(result.bestBid).toBe(0.64);
		expect(result.bestAsk).toBe(0.68);
		expect(result.spread).toBeCloseTo(0.04, 12);
	});

	it("should limit liquidity sum by depthLevels", () => {
		const result = summarizeOrderBook(
			{
				bids: [{ size: "10" }, { size: "20" }, { size: "30" }, { size: "40" }],
				asks: [{ size: "1" }, { size: "2" }, { size: "3" }, { size: "4" }],
			},
			2,
		);
		expect(result.bidLiquidity).toBe(30);
		expect(result.askLiquidity).toBe(3);
	});

	it("should use default depthLevels=5 for liquidity", () => {
		const result = summarizeOrderBook({
			bids: [{ size: "1" }, { size: "2" }, { size: "3" }, { size: "4" }, { size: "5" }, { size: "6" }],
			asks: [{ size: "2" }, { size: "2" }, { size: "2" }, { size: "2" }, { size: "2" }, { size: "2" }],
		});
		expect(result.bidLiquidity).toBe(15);
		expect(result.askLiquidity).toBe(10);
	});

	it("should skip non-numeric prices when calculating best bid and ask", () => {
		const result = summarizeOrderBook({
			bids: [
				{ price: "bad", size: "10" },
				{ price: "0.52", size: "10" },
			],
			asks: [
				{ price: "oops", size: "10" },
				{ price: "0.59", size: "10" },
			],
		});
		expect(result.bestBid).toBe(0.52);
		expect(result.bestAsk).toBe(0.59);
		expect(result.spread).toBeCloseTo(0.07, 12);
	});

	it("should handle non-object entries in bids and asks gracefully", () => {
		const result = summarizeOrderBook({
			bids: [null, 123, "x", { price: "0.44", size: "9" }],
			asks: [false, [], { price: "0.49", size: "11" }],
		});
		expect(result.bestBid).toBe(0.44);
		expect(result.bestAsk).toBe(0.49);
		expect(result.bidLiquidity).toBe(9);
		expect(result.askLiquidity).toBe(11);
	});

	it("should handle large order books and still cap liquidity by depthLevels", () => {
		const result = summarizeOrderBook({
			bids: [
				{ price: "0.30", size: "1" },
				{ price: "0.31", size: "2" },
				{ price: "0.32", size: "3" },
				{ price: "0.33", size: "4" },
				{ price: "0.34", size: "5" },
				{ price: "0.35", size: "6" },
			],
			asks: [
				{ price: "0.70", size: "1" },
				{ price: "0.69", size: "2" },
				{ price: "0.68", size: "3" },
				{ price: "0.67", size: "4" },
				{ price: "0.66", size: "5" },
				{ price: "0.65", size: "6" },
			],
		});
		expect(result.bestBid).toBe(0.35);
		expect(result.bestAsk).toBe(0.65);
		expect(result.bidLiquidity).toBe(15);
		expect(result.askLiquidity).toBe(15);
	});

	it("should treat zero-size entries as zero contribution to liquidity", () => {
		const result = summarizeOrderBook({
			bids: [
				{ price: "0.50", size: "0" },
				{ price: "0.49", size: "10" },
			],
			asks: [
				{ price: "0.55", size: 0 },
				{ price: "0.56", size: "20" },
			],
		});
		expect(result.bidLiquidity).toBe(10);
		expect(result.askLiquidity).toBe(20);
	});
});
