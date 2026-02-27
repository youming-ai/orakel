import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache, LRUCache } from "./cache.ts";

describe("createTtlCache", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns undefined when empty", () => {
		const cache = createTtlCache<string>(1000);
		expect(cache.get()).toBeUndefined();
		expect(cache.has()).toBe(false);
	});

	it("returns value before TTL expires", () => {
		const cache = createTtlCache<number>(1000);
		cache.set(42);
		expect(cache.get()).toBe(42);
		expect(cache.has()).toBe(true);
	});

	it("returns undefined after TTL expires", () => {
		const cache = createTtlCache<number>(1000);
		cache.set(42);
		vi.advanceTimersByTime(1001);
		expect(cache.get()).toBeUndefined();
		expect(cache.has()).toBe(false);
	});

	it("refreshes TTL on re-set", () => {
		const cache = createTtlCache<number>(1000);
		cache.set(1);
		vi.advanceTimersByTime(800);
		cache.set(2);
		vi.advanceTimersByTime(800);
		expect(cache.get()).toBe(2);
	});

	it("invalidate clears value immediately", () => {
		const cache = createTtlCache<string>(5000);
		cache.set("hello");
		cache.invalidate();
		expect(cache.get()).toBeUndefined();
		expect(cache.has()).toBe(false);
	});
});

describe("LRUCache", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("basic operations", () => {
		it("returns undefined for missing key", () => {
			const cache = new LRUCache<string, number>(10);
			expect(cache.get("missing")).toBeUndefined();
		});

		it("stores and retrieves values", () => {
			const cache = new LRUCache<string, number>(10);
			cache.set("a", 1);
			cache.set("b", 2);
			expect(cache.get("a")).toBe(1);
			expect(cache.get("b")).toBe(2);
		});

		it("overwrites existing key", () => {
			const cache = new LRUCache<string, number>(10);
			cache.set("a", 1);
			cache.set("a", 2);
			expect(cache.get("a")).toBe(2);
			expect(cache.size).toBe(1);
		});

		it("has() returns correct value", () => {
			const cache = new LRUCache<string, number>(10);
			expect(cache.has("a")).toBe(false);
			cache.set("a", 1);
			expect(cache.has("a")).toBe(true);
		});

		it("delete() removes key", () => {
			const cache = new LRUCache<string, number>(10);
			cache.set("a", 1);
			expect(cache.delete("a")).toBe(true);
			expect(cache.get("a")).toBeUndefined();
			expect(cache.delete("a")).toBe(false);
		});

		it("clear() removes all entries", () => {
			const cache = new LRUCache<string, number>(10);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.clear();
			expect(cache.size).toBe(0);
			expect(cache.get("a")).toBeUndefined();
		});
	});

	describe("LRU eviction", () => {
		it("evicts least recently used when at capacity", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.set("c", 3);
			cache.set("d", 4); // should evict "a"
			expect(cache.get("a")).toBeUndefined();
			expect(cache.get("b")).toBe(2);
			expect(cache.get("d")).toBe(4);
		});

		it("get() promotes entry to MRU", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.set("c", 3);
			cache.get("a"); // promote "a" to MRU
			cache.set("d", 4); // should evict "b" (now LRU)
			expect(cache.get("a")).toBe(1);
			expect(cache.get("b")).toBeUndefined();
		});

		it("set() promotes existing key to MRU", () => {
			const cache = new LRUCache<string, number>(3);
			cache.set("a", 1);
			cache.set("b", 2);
			cache.set("c", 3);
			cache.set("a", 10); // update and promote "a"
			cache.set("d", 4); // should evict "b"
			expect(cache.get("a")).toBe(10);
			expect(cache.get("b")).toBeUndefined();
		});
	});

	describe("TTL expiry", () => {
		it("expires entries after default TTL", () => {
			const cache = new LRUCache<string, number>(10, 1000);
			cache.set("a", 1);
			expect(cache.get("a")).toBe(1);
			vi.advanceTimersByTime(1001);
			expect(cache.get("a")).toBeUndefined();
		});

		it("respects per-entry TTL override", () => {
			const cache = new LRUCache<string, number>(10, 5000);
			cache.set("short", 1, 500);
			cache.set("long", 2); // default 5000ms
			vi.advanceTimersByTime(600);
			expect(cache.get("short")).toBeUndefined();
			expect(cache.get("long")).toBe(2);
		});

		it("has() returns false for expired entry", () => {
			const cache = new LRUCache<string, number>(10, 1000);
			cache.set("a", 1);
			vi.advanceTimersByTime(1001);
			expect(cache.has("a")).toBe(false);
		});

		it("no expiry when TTL is 0", () => {
			const cache = new LRUCache<string, number>(10, 0);
			cache.set("a", 1);
			vi.advanceTimersByTime(999_999);
			expect(cache.get("a")).toBe(1);
		});

		it("prune() removes expired entries", () => {
			const cache = new LRUCache<string, number>(10, 1000);
			cache.set("a", 1);
			cache.set("b", 2);
			vi.advanceTimersByTime(500);
			cache.set("c", 3);
			vi.advanceTimersByTime(600);
			cache.prune();
			expect(cache.size).toBe(1); // only "c" remains
			expect(cache.get("c")).toBe(3);
		});
	});
});
