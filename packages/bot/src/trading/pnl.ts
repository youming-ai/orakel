/**
 * Compute PnL for binary outcome trades with division-by-zero guard.
 * When price is at boundary (0 or 1), return size-based fallback to avoid division errors.
 */
export function computeBinaryPnl(size: number, price: number, won: boolean): number {
	if (price <= 0 || price >= 1) {
		return won ? size : -size;
	}
	return won ? size * ((1 - price) / price) : -size;
}
