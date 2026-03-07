import { beforeEach, describe, expect, it, vi } from "vitest";

const initAccountStats = vi.fn<() => Promise<void>>();
const startApiServer = vi.fn();
const startConfigWatcher = vi.fn();

vi.mock("../api.ts", () => ({
	startApiServer,
}));

vi.mock("../core/config.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../core/config.ts")>();
	return {
		...actual,
		startConfigWatcher,
	};
});

vi.mock("../core/env.ts", () => ({
	env: {
		PRIVATE_KEY: "",
		AUTO_REDEEM_ENABLED: false,
		AUTO_REDEEM_INTERVAL_MS: 60_000,
	},
}));

vi.mock("../trading/accountStats.ts", () => ({
	initAccountStats,
}));

describe("bootstrapApp", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should await account stats initialization before resolving", async () => {
		let resolveInit: (() => void) | null = null;
		initAccountStats.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveInit = resolve;
				}),
		);

		const { bootstrapApp } = await import("../app/bootstrap.ts");
		const bootstrapPromise = bootstrapApp({
			isLiveSettlerRunning: () => false,
		});

		let resolved = false;
		void bootstrapPromise.then(() => {
			resolved = true;
		});

		await Promise.resolve();

		expect(startApiServer).toHaveBeenCalledOnce();
		expect(startConfigWatcher).toHaveBeenCalledOnce();
		expect(initAccountStats).toHaveBeenCalledOnce();
		expect(resolved).toBe(false);

		resolveInit?.();
		await expect(bootstrapPromise).resolves.toEqual({
			redeemTimerHandle: null,
		});
	});
});
