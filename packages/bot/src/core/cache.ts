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
