/**
 * Generic TTL cache — single value per instance, time-based expiry.
 * Used to reduce redundant REST calls on the hot path (1s polling loop).
 */
export function createTtlCache<T>(ttlMs: number) {
	let value: T | undefined;
	let expiresAt = 0;

	return {
		get(): T | undefined {
			return Date.now() < expiresAt ? value : undefined;
		},
		set(v: T): void {
			value = v;
			expiresAt = Date.now() + ttlMs;
		},
		invalidate(): void {
			value = undefined;
			expiresAt = 0;
		},
		/** Check if cache has a valid (non-expired) entry */
		has(): boolean {
			return Date.now() < expiresAt;
		},
	};
}

/**
 * Key-value LRU cache with optional per-entry TTL.
 * Evicts least-recently-used entries when capacity is reached.
 *
 * Usage:
 *   const cache = new LRUCache<string, Data>(100, 60_000);
 *   cache.set("key", data);            // uses default TTL
 *   cache.set("key", data, 5_000);     // custom TTL
 *   const hit = cache.get("key");       // promotes to MRU
 */
export class LRUCache<K, V> {
	private readonly cache = new Map<K, { value: V; expiresAt: number }>();
	private readonly maxSize: number;
	private readonly defaultTtlMs: number;

	/**
	 * @param maxSize - Maximum number of entries before LRU eviction
	 * @param defaultTtlMs - Default time-to-live in ms (0 = no expiry)
	 */
	constructor(maxSize: number = 100, defaultTtlMs: number = 0) {
		this.maxSize = maxSize;
		this.defaultTtlMs = defaultTtlMs;
	}

	/** Get a value by key. Returns undefined if missing or expired. Promotes to MRU. */
	get(key: K): V | undefined {
		const entry = this.cache.get(key);
		if (entry === undefined) return undefined;

		// Check TTL expiry
		if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
			this.cache.delete(key);
			return undefined;
		}

		// Promote to MRU by re-inserting (Map maintains insertion order)
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry.value;
	}

	/** Set a value. Evicts LRU entry if at capacity. */
	set(key: K, value: V, ttlMs?: number): void {
		// Remove existing entry to update position
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}

		// Evict LRU (first entry in Map) if at capacity
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}

		const ttl = ttlMs ?? this.defaultTtlMs;
		const expiresAt = ttl > 0 ? Date.now() + ttl : 0;
		this.cache.set(key, { value, expiresAt });
	}

	/** Check if key exists and is not expired. */
	has(key: K): boolean {
		const entry = this.cache.get(key);
		if (entry === undefined) return false;
		if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
			this.cache.delete(key);
			return false;
		}
		return true;
	}

	/** Delete a specific key. */
	delete(key: K): boolean {
		return this.cache.delete(key);
	}

	/** Remove all entries. */
	clear(): void {
		this.cache.clear();
	}

	/** Number of entries (including potentially expired ones). */
	get size(): number {
		return this.cache.size;
	}

	/** Remove all expired entries. */
	prune(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (entry.expiresAt > 0 && now >= entry.expiresAt) {
				this.cache.delete(key);
			}
		}
	}
}
