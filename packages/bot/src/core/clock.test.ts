import { describe, expect, it } from "vitest";
import { computePhase, computeSlug, computeTimeLeftSeconds, computeWindowBounds } from "./clock.ts";

describe("clock", () => {
	describe("computeWindowBounds", () => {
		it("should compute window bounds with correct duration", () => {
			const nowSec = 1700000000;
			const windowSeconds = 300;

			const { startSec, endSec } = computeWindowBounds(nowSec, windowSeconds);

			expect(endSec - startSec).toBe(windowSeconds);
		});

		it("should return valid window boundaries", () => {
			const nowSec = 1700000000;
			const windowSeconds = 300;

			const { startSec, endSec } = computeWindowBounds(nowSec, windowSeconds);

			expect(startSec).toBeLessThan(endSec);
			expect(endSec - startSec).toBe(windowSeconds);
		});
	});

	describe("computeSlug", () => {
		it("should generate correct slug", () => {
			const endSec = 1700000300;
			const prefix = "BTC-USD";

			const slug = computeSlug(endSec, prefix);

			expect(slug).toContain(prefix);
			expect(slug).toContain(endSec.toString());
		});

		it("should be deterministic for same inputs", () => {
			const endSec = 1700000300;
			const prefix = "BTC-USD";

			const slug1 = computeSlug(endSec, prefix);
			const slug2 = computeSlug(endSec, prefix);

			expect(slug1).toBe(slug2);
		});

		it("should handle prefix with trailing dash", () => {
			const endSec = 1700000300;
			const prefix = "BTC-USD-";

			const slug = computeSlug(endSec, prefix);

			expect(slug).toBe("BTC-USD-1700000300");
		});
	});

	describe("computeTimeLeftSeconds", () => {
		it("should compute correct time left", () => {
			const nowMs = 1700000000000;
			const endMs = nowMs + 300000;

			const timeLeft = computeTimeLeftSeconds(nowMs, endMs);

			expect(timeLeft).toBe(300);
		});

		it("should return 0 when window ended", () => {
			const nowMs = 1700000300000;
			const endMs = 1700000000000;

			const timeLeft = computeTimeLeftSeconds(nowMs, endMs);

			expect(timeLeft).toBe(0);
		});
	});

	describe("computePhase", () => {
		it("should return EARLY when time left is greater than phaseEarlySeconds", () => {
			const timeLeft = 121;
			const phaseEarlySeconds = 120;
			const phaseLateSeconds = 30;

			const phase = computePhase(timeLeft, phaseEarlySeconds, phaseLateSeconds);

			expect(phase).toBe("EARLY");
		});

		it("should return MID when time left equals phaseEarlySeconds", () => {
			const timeLeft = 120;
			const phaseEarlySeconds = 120;
			const phaseLateSeconds = 30;

			const phase = computePhase(timeLeft, phaseEarlySeconds, phaseLateSeconds);

			expect(phase).toBe("MID");
		});

		it("should return MID when time left is between thresholds", () => {
			const timeLeft = 60;
			const phaseEarlySeconds = 120;
			const phaseLateSeconds = 30;

			const phase = computePhase(timeLeft, phaseEarlySeconds, phaseLateSeconds);

			expect(phase).toBe("MID");
		});

		it("should return LATE when time left equals phaseLateSeconds", () => {
			const timeLeft = 30;
			const phaseEarlySeconds = 120;
			const phaseLateSeconds = 30;

			const phase = computePhase(timeLeft, phaseEarlySeconds, phaseLateSeconds);

			expect(phase).toBe("LATE");
		});

		it("should return LATE when time left is less than phaseLateSeconds", () => {
			const timeLeft = 20;
			const phaseEarlySeconds = 120;
			const phaseLateSeconds = 30;

			const phase = computePhase(timeLeft, phaseEarlySeconds, phaseLateSeconds);

			expect(phase).toBe("LATE");
		});
	});
});
