import { describe, expect, it } from "vitest";
import { advanceWindowState, createWindowState, type WindowTrackerState } from "../runtime/windowManager.ts";

describe("createWindowState", () => {
	it("creates initial PENDING state", () => {
		const state = createWindowState("btc-updown-5m-100", 0, 100_000);
		expect(state.slug).toBe("btc-updown-5m-100");
		expect(state.state).toBe("PENDING");
	});
});

describe("advanceWindowState", () => {
	it("transitions PENDING -> ACTIVE when within window", () => {
		const state = createWindowState("test", 1000, 6000);
		const next = advanceWindowState(state, 2000, false);
		expect(next.state).toBe("ACTIVE");
	});

	it("transitions ACTIVE -> CLOSING when past window end", () => {
		const state: WindowTrackerState = {
			slug: "test",
			state: "ACTIVE",
			startMs: 1000,
			endMs: 6000,
			marketInfo: null,
			traded: false,
		};
		const next = advanceWindowState(state, 7000, false);
		expect(next.state).toBe("CLOSING");
	});

	it("transitions CLOSING -> SETTLED when resolution confirmed", () => {
		const state: WindowTrackerState = {
			slug: "test",
			state: "CLOSING",
			startMs: 1000,
			endMs: 6000,
			marketInfo: null,
			traded: false,
		};
		const next = advanceWindowState(state, 8000, true);
		expect(next.state).toBe("SETTLED");
	});
});
