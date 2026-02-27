import { clamp } from "../utils.ts";

/**
 * Incremental RSI calculator using a ring buffer of gains/losses.
 * Produces SMA-compatible results identical to `computeRsi()` while
 * supporting O(1) incremental updates after initial warm-up.
 *
 * Usage:
 *   const rsi = new IncrementalRSI(14);
 *   rsi.initFromCloses(closes);         // bulk init from candle data
 *   rsi.update(newClose);               // O(1) incremental update
 *   rsi.value;                          // current RSI or null
 */
export class IncrementalRSI {
	private readonly period: number;
	private readonly gains: number[];
	private readonly losses: number[];
	private writeIdx: number = 0;
	private totalGains: number = 0;
	private totalLosses: number = 0;
	private count: number = 0;
	private lastClose: number | null = null;
	private currentValue: number | null = null;

	constructor(period: number) {
		this.period = period;
		this.gains = new Array<number>(period).fill(0);
		this.losses = new Array<number>(period).fill(0);
	}

	/** Feed a single close price. Returns RSI or null if not enough data. */
	update(close: number): number | null {
		if (this.lastClose !== null) {
			const diff = close - this.lastClose;
			const gain = diff > 0 ? diff : 0;
			const loss = diff < 0 ? -diff : 0;

			// Evict oldest entry from running sums
			this.totalGains -= this.gains[this.writeIdx] ?? 0;
			this.totalLosses -= this.losses[this.writeIdx] ?? 0;

			// Write new entry
			this.gains[this.writeIdx] = gain;
			this.losses[this.writeIdx] = loss;
			this.totalGains += gain;
			this.totalLosses += loss;

			this.writeIdx = (this.writeIdx + 1) % this.period;
			if (this.count < this.period) this.count++;
		}
		this.lastClose = close;

		if (this.count < this.period) {
			this.currentValue = null;
			return null;
		}

		const avgGain = this.totalGains / this.period;
		const avgLoss = this.totalLosses / this.period;
		if (avgLoss === 0) {
			this.currentValue = 100;
			return 100;
		}
		const rs = avgGain / avgLoss;
		const rsi = clamp(100 - 100 / (1 + rs), 0, 100);
		this.currentValue = rsi;
		return rsi;
	}

	/** Current RSI value (null if not enough data). */
	get value(): number | null {
		return this.currentValue;
	}

	/** Whether the calculator has accumulated enough data to produce a value. */
	get ready(): boolean {
		return this.count >= this.period;
	}

	/**
	 * Bulk-initialise from an array of close prices.
	 * Returns the final RSI value (or null if array is too short).
	 * This is O(n) but only needs to run once per market lifetime;
	 * subsequent ticks use `update()` at O(1).
	 */
	initFromCloses(closes: readonly number[]): number | null {
		this.reset();
		let result: number | null = null;
		for (const close of closes) {
			result = this.update(close);
		}
		return result;
	}

	/**
	 * Compute RSI at multiple trailing offsets in a single pass.
	 * Returns an array of RSI values at offsets [n, n-1, ..., 0] from the end.
	 * Useful for computing RSI slope without separate `computeRsi` calls.
	 *
	 * @param closes - Full close price array
	 * @param trailingCount - Number of trailing RSI values to capture (e.g. 3)
	 * @returns Array of trailing RSI values (oldest first), length ≤ trailingCount
	 */
	initFromClosesWithTrailing(closes: readonly number[], trailingCount: number): number[] {
		this.reset();
		const trailing: number[] = [];
		const captureStart = closes.length - trailingCount;

		for (let i = 0; i < closes.length; i++) {
			const rsi = this.update(closes[i] ?? 0);
			if (i >= captureStart && rsi !== null) {
				trailing.push(rsi);
			}
		}
		return trailing;
	}

	/** Reset all internal state. */
	reset(): void {
		this.gains.fill(0);
		this.losses.fill(0);
		this.writeIdx = 0;
		this.totalGains = 0;
		this.totalLosses = 0;
		this.count = 0;
		this.lastClose = null;
		this.currentValue = null;
	}
}
