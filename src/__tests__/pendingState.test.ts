import { beforeEach, describe, expect, it } from "vitest";
import {
	applyPendingStarts,
	applyPendingStops,
	clearLivePending,
	clearPaperPending,
	getLivePendingSince,
	getPaperPendingSince,
	isLivePendingStart,
	isLivePendingStop,
	isLiveRunning,
	isPaperPendingStart,
	isPaperPendingStop,
	isPaperRunning,
	setLivePendingStart,
	setLivePendingStop,
	setLiveRunning,
	setPaperPendingStart,
	setPaperPendingStop,
	setPaperRunning,
} from "../core/state.ts";

describe("pending runtime state", () => {
	beforeEach(() => {
		clearPaperPending();
		clearLivePending();
		setPaperRunning(false);
		setLiveRunning(false);
	});

	it("should activate pending starts on the next runtime tick", () => {
		setPaperPendingStart(true);
		setLivePendingStart(true);

		expect(isPaperRunning()).toBe(false);
		expect(isLiveRunning()).toBe(false);
		expect(isPaperPendingStart()).toBe(true);
		expect(isLivePendingStart()).toBe(true);
		expect(getPaperPendingSince()).not.toBeNull();
		expect(getLivePendingSince()).not.toBeNull();

		expect(applyPendingStarts()).toBe(true);
		expect(isPaperRunning()).toBe(true);
		expect(isLiveRunning()).toBe(true);
		expect(isPaperPendingStart()).toBe(false);
		expect(isLivePendingStart()).toBe(false);
		expect(getPaperPendingSince()).toBeNull();
		expect(getLivePendingSince()).toBeNull();
	});

	it("should apply pending stops after settlement", () => {
		setPaperRunning(true);
		setLiveRunning(true);
		setPaperPendingStop(true);
		setLivePendingStop(true);

		expect(isPaperPendingStop()).toBe(true);
		expect(isLivePendingStop()).toBe(true);
		expect(getPaperPendingSince()).not.toBeNull();
		expect(getLivePendingSince()).not.toBeNull();

		expect(applyPendingStops()).toBe(true);
		expect(isPaperRunning()).toBe(false);
		expect(isLiveRunning()).toBe(false);
		expect(isPaperPendingStop()).toBe(false);
		expect(isLivePendingStop()).toBe(false);
		expect(getPaperPendingSince()).toBeNull();
		expect(getLivePendingSince()).toBeNull();
	});
});
