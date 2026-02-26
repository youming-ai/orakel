import { describe, expect, it } from "vitest";
import {
	CTF_ADDRESS,
	ctfIface,
	TRANSFER_BATCH_TOPIC,
	TRANSFER_SINGLE_TOPIC,
	TRANSFER_TOPIC,
	USDC_E_ADDRESS,
	USDC_E_DECIMALS,
	usdcIface,
} from "./contracts.ts";

const canonicalAddressLength = 42;
const topicHexLength = 66;

describe("contracts module", () => {
	it("exports CTF address with 0x prefix and length 42", () => {
		expect(CTF_ADDRESS.startsWith("0x")).toBe(true);
		expect(CTF_ADDRESS).toHaveLength(canonicalAddressLength);
	});

	it("exports USDC.e address with 0x prefix and length 42", () => {
		expect(USDC_E_ADDRESS.startsWith("0x")).toBe(true);
		expect(USDC_E_ADDRESS).toHaveLength(canonicalAddressLength);
	});

	it("exports the exact CTF address", () => {
		expect(CTF_ADDRESS).toBe("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045");
	});

	it("exports the exact USDC.e address", () => {
		expect(USDC_E_ADDRESS).toBe("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174");
	});

	it("exports USDC.e decimals equal to 6", () => {
		expect(USDC_E_DECIMALS).toBe(6);
	});

	it("exports transfer topic hashes with 0x prefix and 66 chars", () => {
		expect(TRANSFER_TOPIC.startsWith("0x")).toBe(true);
		expect(TRANSFER_TOPIC).toHaveLength(topicHexLength);
	});

	it("exports transfer single topic with 0x prefix and 66 chars", () => {
		expect(TRANSFER_SINGLE_TOPIC.startsWith("0x")).toBe(true);
		expect(TRANSFER_SINGLE_TOPIC).toHaveLength(topicHexLength);
	});

	it("exports transfer batch topic with 0x prefix and 66 chars", () => {
		expect(TRANSFER_BATCH_TOPIC.startsWith("0x")).toBe(true);
		expect(TRANSFER_BATCH_TOPIC).toHaveLength(topicHexLength);
	});

	it("ensures transfer topic differs from transfer single topic", () => {
		expect(TRANSFER_TOPIC).not.toBe(TRANSFER_SINGLE_TOPIC);
	});

	it("ctfIface exposes encodeFunctionData", () => {
		expect(typeof ctfIface.encodeFunctionData).toBe("function");
	});

	it("ctfIface can encode balanceOf without throwing", () => {
		expect(() =>
			ctfIface.encodeFunctionData("balanceOf", ["0x0000000000000000000000000000000000000001", 1]),
		).not.toThrow();
	});

	it("usdcIface exposes encodeFunctionData", () => {
		expect(typeof usdcIface.encodeFunctionData).toBe("function");
	});

	it("usdcIface can encode balanceOf without throwing", () => {
		expect(() =>
			usdcIface.encodeFunctionData("balanceOf", ["0x0000000000000000000000000000000000000001"]),
		).not.toThrow();
	});
});
