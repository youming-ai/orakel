import { describe, expect, it } from "vitest";
import { getLiveStartReadinessError } from "../trading/liveGuards.ts";

describe("getLiveStartReadinessError", () => {
	it("should block start when stop-loss is active", () => {
		const error = getLiveStartReadinessError({
			walletLoaded: true,
			clientReady: true,
			stopLossActive: true,
		});
		expect(error).toContain("stopped by risk controls");
	});

	it("should block start when wallet is not loaded", () => {
		const error = getLiveStartReadinessError({
			walletLoaded: false,
			clientReady: false,
			stopLossActive: false,
		});
		expect(error).toContain("Wallet not connected");
	});

	it("should block start when client is not ready", () => {
		const error = getLiveStartReadinessError({
			walletLoaded: true,
			clientReady: false,
			stopLossActive: false,
		});
		expect(error).toContain("client not ready");
	});

	it("should allow start when all readiness checks pass", () => {
		const error = getLiveStartReadinessError({
			walletLoaded: true,
			clientReady: true,
			stopLossActive: false,
		});
		expect(error).toBeNull();
	});
});
