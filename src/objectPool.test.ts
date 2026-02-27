import { describe, expect, it } from "vitest";
import { ObjectPool } from "./objectPool.ts";

describe("ObjectPool", () => {
	function makePool(initial = 3, max = 10) {
		return new ObjectPool<{ x: number; y: string }>(
			() => ({ x: 0, y: "" }),
			(obj) => {
				obj.x = 0;
				obj.y = "";
			},
			initial,
			max,
		);
	}

	it("should pre-allocate initial objects", () => {
		const pool = makePool(5, 10);
		expect(pool.available).toBe(5);
	});

	it("should acquire from pool (no new allocation)", () => {
		const pool = makePool(3, 10);
		const obj = pool.acquire();
		expect(obj).toEqual({ x: 0, y: "" });
		expect(pool.available).toBe(2);
	});

	it("should create new object when pool is empty", () => {
		const pool = makePool(0, 10);
		expect(pool.available).toBe(0);
		const obj = pool.acquire();
		expect(obj).toEqual({ x: 0, y: "" });
	});

	it("should release object back to pool after reset", () => {
		const pool = makePool(1, 10);
		const obj = pool.acquire();
		expect(pool.available).toBe(0);

		obj.x = 42;
		obj.y = "dirty";
		pool.release(obj);

		expect(pool.available).toBe(1);
		// Object should have been reset
		const reused = pool.acquire();
		expect(reused.x).toBe(0);
		expect(reused.y).toBe("");
	});

	it("should drop objects when pool is full", () => {
		const pool = makePool(0, 2);
		const obj1 = pool.acquire();
		const obj2 = pool.acquire();
		const obj3 = pool.acquire();

		pool.release(obj1);
		pool.release(obj2);
		expect(pool.available).toBe(2);

		// This should be dropped (pool at max)
		pool.release(obj3);
		expect(pool.available).toBe(2);
	});

	it("should clear the pool", () => {
		const pool = makePool(5, 10);
		expect(pool.available).toBe(5);
		pool.clear();
		expect(pool.available).toBe(0);
	});

	it("should handle acquire/release cycle", () => {
		const pool = makePool(2, 5);

		// Acquire all
		const a = pool.acquire();
		const b = pool.acquire();
		expect(pool.available).toBe(0);

		// Modify and release
		a.x = 1;
		b.x = 2;
		pool.release(a);
		pool.release(b);
		expect(pool.available).toBe(2);

		// Re-acquire (should be reset)
		const c = pool.acquire();
		const d = pool.acquire();
		expect(c.x).toBe(0);
		expect(d.x).toBe(0);
	});
});
