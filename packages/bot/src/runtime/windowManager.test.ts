import { describe, expect, it } from "vitest";
import type { WindowTrackerState } from "./windowManager.ts";
import { advanceWindowState, createWindowState } from "./windowManager.ts";

describe("createWindowState", () => {
	it("should return object with correct slug, startMs, endMs, state=PENDING, marketInfo=null", () => {
		const slug = "btc-updown-5m-1234";
		const startMs = 1000;
		const endMs = 6000;

		const result = createWindowState(slug, startMs, endMs);

		expect(result.slug).toBe(slug);
		expect(result.startMs).toBe(startMs);
		expect(result.endMs).toBe(endMs);
		expect(result.state).toBe("PENDING");
		expect(result.marketInfo).toBeNull();
	});
});

describe("advanceWindowState", () => {
	describe("PENDING state transitions", () => {
		it("should transition PENDING → ACTIVE when nowMs >= startMs && nowMs < endMs", () => {
			const state = createWindowState("btc-updown-5m-1234", 1000, 6000);
			const nowMs = 3000; // Between start and end

			const result = advanceWindowState(state, nowMs, false);

			expect(result.state).toBe("ACTIVE");
		});

		it("should stay PENDING when nowMs < startMs", () => {
			const state = createWindowState("btc-updown-5m-1234", 1000, 6000);
			const nowMs = 500; // Before start

			const result = advanceWindowState(state, nowMs, false);

			expect(result.state).toBe("PENDING");
		});

		it("should transition PENDING → ACTIVE when nowMs equals startMs", () => {
			const state = createWindowState("btc-updown-5m-1234", 1000, 6000);
			const nowMs = 1000; // Exactly at start

			const result = advanceWindowState(state, nowMs, false);

			expect(result.state).toBe("ACTIVE");
		});
	});

	describe("ACTIVE state transitions", () => {
		it("should transition ACTIVE → CLOSING when nowMs >= endMs", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "ACTIVE",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};
			const nowMs = 6000; // At or past end

			const result = advanceWindowState(state, nowMs, false);

			expect(result.state).toBe("CLOSING");
		});

		it("should stay ACTIVE when nowMs < endMs", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "ACTIVE",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};
			const nowMs = 5000; // Before end

			const result = advanceWindowState(state, nowMs, false);

			expect(result.state).toBe("ACTIVE");
		});

		it("should stay ACTIVE when nowMs is just before endMs", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "ACTIVE",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};
			const nowMs = 5999; // Just before end

			const result = advanceWindowState(state, nowMs, false);

			expect(result.state).toBe("ACTIVE");
		});
	});

	describe("CLOSING state transitions", () => {
		it("should transition CLOSING → SETTLED when resolutionConfirmed=true", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "CLOSING",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};

			const result = advanceWindowState(state, 7000, true);

			expect(result.state).toBe("SETTLED");
		});

		it("should stay CLOSING when resolutionConfirmed=false", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "CLOSING",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};

			const result = advanceWindowState(state, 7000, false);

			expect(result.state).toBe("CLOSING");
		});
	});

	describe("SETTLED state transitions", () => {
		it("should stay SETTLED", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "SETTLED",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};

			const result = advanceWindowState(state, 8000, false);

			expect(result.state).toBe("SETTLED");
		});

		it("should stay SETTLED even with resolutionConfirmed=true", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "SETTLED",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};

			const result = advanceWindowState(state, 8000, true);

			expect(result.state).toBe("SETTLED");
		});
	});

	describe("REDEEMED state transitions", () => {
		it("should stay REDEEMED", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "REDEEMED",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};

			const result = advanceWindowState(state, 9000, false);

			expect(result.state).toBe("REDEEMED");
		});

		it("should stay REDEEMED even with resolutionConfirmed=true", () => {
			const state: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "REDEEMED",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};

			const result = advanceWindowState(state, 9000, true);

			expect(result.state).toBe("REDEEMED");
		});
	});

	describe("Immutability", () => {
		it("should return new object (immutable update)", () => {
			const original: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "PENDING",
				startMs: 1000,
				endMs: 6000,
				marketInfo: null,
			};

			const result = advanceWindowState(original, 3000, false);

			expect(result).not.toBe(original);
			expect(original.state).toBe("PENDING");
			expect(result.state).toBe("ACTIVE");
		});

		it("should preserve other properties when advancing state", () => {
			const original: WindowTrackerState = {
				slug: "btc-updown-5m-1234",
				state: "PENDING",
				startMs: 1000,
				endMs: 6000,
				marketInfo: {
					slug: "btc-updown-5m-1234",
					conditionId: "cond-123",
					upTokenId: "up-123",
					downTokenId: "down-123",
					priceToBeat: 42000,
					startMs: 1000,
					endMs: 6000,
				},
			};

			const result = advanceWindowState(original, 3000, false);

			expect(result.slug).toBe(original.slug);
			expect(result.startMs).toBe(original.startMs);
			expect(result.endMs).toBe(original.endMs);
			expect(result.marketInfo).toBe(original.marketInfo);
		});
	});
});

describe("BUG-6: traded field (TDD-Red test)", () => {
	it("should NOT have a traded property on createWindowState result", () => {
		const result = createWindowState("btc-updown-5m-1234", 1000, 6000);
		expect(result).not.toHaveProperty("traded");
	});
});
