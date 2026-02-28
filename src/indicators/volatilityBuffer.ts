/**
 * Rolling volatility calculator using a ring buffer of log-returns.
 * Produces results compatible with `computeRealizedVolatility()` while
 * supporting O(1) incremental updates after initial warm-up.
 *
 * The formula: sqrt(variance_1m * windowMinutes)
 * where variance_1m = sum(logReturn^2) / count
 *
 * Usage:
 *   const vol = new RollingVolatilityCalculator(60, 15);
 *   vol.initFromCloses(closes);    // bulk init
 *   vol.update(newClose);          // O(1) incremental update
 *   vol.value;                     // current 15-min annualised vol or null
 */
export class RollingVolatilityCalculator {
	private readonly maxReturns: number;
	private readonly windowMinutes: number;
	private readonly returns: number[];
	private writeIdx: number = 0;
	private count: number = 0;
	private sumSqReturns: number = 0;
	private lastClose: number | null = null;
	private currentValue: number | null = null;

	/**
	 * @param lookback - Number of 1-minute log-returns to keep (default 60)
	 * @param windowMinutes - Window size for scaling (default 15)
	 */
	constructor(lookback: number = 60, windowMinutes: number = 15) {
		this.maxReturns = lookback;
		this.windowMinutes = windowMinutes;
		this.returns = new Array<number>(lookback).fill(0);
	}

	/** Feed a single close price. Returns volatility or null if not enough data. */
	update(close: number): number | null {
		// Guard against non-positive values that would cause Math.log to return NaN/Infinity
		if (!Number.isFinite(close) || close <= 0) {
			return this.currentValue;
		}
		if (this.lastClose !== null && this.lastClose > 0) {
			const logRet = Math.log(close / this.lastClose);

			// Evict oldest return from running sum
			if (this.count >= this.maxReturns) {
				const oldRet = this.returns[this.writeIdx] ?? 0;
				this.sumSqReturns -= oldRet * oldRet;
			}

			// Write new return
			this.returns[this.writeIdx] = logRet;
			this.sumSqReturns += logRet * logRet;
			this.writeIdx = (this.writeIdx + 1) % this.maxReturns;
			if (this.count < this.maxReturns) this.count++;
		}
		this.lastClose = close;

		if (this.count < 2) {
			this.currentValue = null;
			return null;
		}

		const variance1m = this.sumSqReturns / this.count;
		const vol = Math.sqrt(variance1m * this.windowMinutes);
		this.currentValue = vol;
		return vol;
	}

	/** Current volatility value (null if not enough data). */
	get value(): number | null {
		return this.currentValue;
	}

	/** Whether the calculator has accumulated enough data to produce a value. */
	get ready(): boolean {
		return this.count >= 2;
	}

	/** Number of returns currently in the buffer. */
	get size(): number {
		return this.count;
	}

	/**
	 * Bulk-initialise from an array of close prices.
	 * Returns the final volatility value (or null if array is too short).
	 */
	initFromCloses(closes: readonly number[]): number | null {
		this.reset();
		let result: number | null = null;
		for (const close of closes) {
			result = this.update(close);
		}
		return result;
	}

	/** Reset all internal state. */
	reset(): void {
		this.returns.fill(0);
		this.writeIdx = 0;
		this.count = 0;
		this.sumSqReturns = 0;
		this.lastClose = null;
		this.currentValue = null;
	}
}
