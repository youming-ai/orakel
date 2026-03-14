import { describe, expect, it } from "vitest";
import {
	applyPendingStarts,
	applyPendingStops,
	getStateSnapshot,
	isLiveRunning,
	isPaperRunning,
	requestLiveStart,
	requestLiveStop,
	requestPaperStart,
	requestPaperStop,
} from "../state.ts";

describe("state management", () => {
	it("should start with both modes stopped", () => {
		expect(isPaperRunning()).toBe(false);
		expect(isLiveRunning()).toBe(false);
	});

	it("should apply paper start request", async () => {
		await requestPaperStart();
		const changed = await applyPendingStarts();

		expect(changed).toBe(true);
		expect(isPaperRunning()).toBe(true);
	});

	it("should apply live start request while paper is running", async () => {
		await requestLiveStart();
		const changed = await applyPendingStarts();

		expect(changed).toBe(true);
		expect(isLiveRunning()).toBe(true);
		expect(isPaperRunning()).toBe(true);
	});

	it("should stop paper while live continues", async () => {
		await requestPaperStop();
		const changed = await applyPendingStops();

		expect(changed).toBe(true);
		expect(isPaperRunning()).toBe(false);
		expect(isLiveRunning()).toBe(true);
	});

	it("should stop live", async () => {
		await requestLiveStop();
		const changed = await applyPendingStops();

		expect(changed).toBe(true);
		expect(isLiveRunning()).toBe(false);
	});

	it("should return snapshot with version", () => {
		const snapshot = getStateSnapshot();

		expect(snapshot).toHaveProperty("paperRunning");
		expect(snapshot).toHaveProperty("liveRunning");
		expect(snapshot).toHaveProperty("version");
		expect(typeof snapshot.version).toBe("number");
		expect(snapshot.version).toBeGreaterThan(0);
	});

	it("should increment version on state changes", async () => {
		const snapshot1 = getStateSnapshot();
		const version1 = snapshot1.version;

		await requestPaperStart();
		const snapshot2 = getStateSnapshot();
		const version2 = snapshot2.version;

		expect(version2).toBeGreaterThan(version1);
	});

	it("should handle concurrent state requests", async () => {
		const promises = [requestPaperStart(), requestLiveStart(), requestPaperStop()];

		await Promise.all(promises);

		const snapshot = getStateSnapshot();
		expect(snapshot).toHaveProperty("version");
		expect(snapshot.version).toBeGreaterThan(0);
	});
});
