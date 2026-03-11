import { describe, expect, it } from "vitest";

describe("redeemByConditionId", () => {
	it("should be exported from redeemer module", async () => {
		const mod = await import("../blockchain/redeemer.ts");
		expect(typeof mod.redeemByConditionId).toBe("function");
	});

	it("should return error for empty conditionId", async () => {
		const { redeemByConditionId } = await import("../blockchain/redeemer.ts");
		const result = await redeemByConditionId(null, "");
		expect(result.success).toBe(false);
		expect(result.error).toBe("no_wallet");
	});

	it("should return error when wallet is null", async () => {
		const { redeemByConditionId } = await import("../blockchain/redeemer.ts");
		const result = await redeemByConditionId(null, "0x1234");
		expect(result.success).toBe(false);
		expect(result.error).toBe("no_wallet");
	});
});
