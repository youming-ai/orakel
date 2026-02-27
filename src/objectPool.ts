/**
 * Generic object pool — reduces GC pressure by reusing pre-allocated objects.
 *
 * Usage:
 *   const pool = new ObjectPool(
 *     () => ({ a: 0, b: "" }),
 *     (obj) => { obj.a = 0; obj.b = ""; },
 *     50,
 *     200,
 *   );
 *   const obj = pool.acquire();
 *   // ... use obj ...
 *   pool.release(obj);
 */
export class ObjectPool<T> {
	private readonly pool: T[] = [];
	private readonly createFn: () => T;
	private readonly resetFn: (obj: T) => void;
	private readonly maxSize: number;

	constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize: number = 50, maxSize: number = 200) {
		this.createFn = createFn;
		this.resetFn = resetFn;
		this.maxSize = maxSize;

		for (let i = 0; i < initialSize; i++) {
			this.pool.push(createFn());
		}
	}

	/** Get an object from the pool, or create a new one if empty. */
	acquire(): T {
		const obj = this.pool.pop();
		return obj !== undefined ? obj : this.createFn();
	}

	/** Return an object to the pool after resetting it. Drops if pool is full. */
	release(obj: T): void {
		if (this.pool.length < this.maxSize) {
			this.resetFn(obj);
			this.pool.push(obj);
		}
	}

	/** Number of available (idle) objects in the pool. */
	get available(): number {
		return this.pool.length;
	}

	/** Drain the pool, releasing all pre-allocated objects. */
	clear(): void {
		this.pool.length = 0;
	}
}
