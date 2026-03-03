import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./cache.ts";

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
