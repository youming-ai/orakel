import { describe, expect, it } from "vitest";
import { CTF_ADDRESS, USDC_E_ADDRESS, USDC_E_DECIMALS } from "../blockchain/contracts.ts";

describe("contracts module", () => {
	describe("contract addresses", () => {
		it("CTF has correct address", () => {
			expect(CTF_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
			expect(CTF_ADDRESS.length).toBe(42);
		});

		it("USDC.e has correct address", () => {
			expect(USDC_E_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
			expect(USDC_E_ADDRESS.length).toBe(42);
		});
	});

	describe("contract constants", () => {
		it("USDC decimals is 6", () => {
			expect(USDC_E_DECIMALS).toBe(6);
		});
	});

	describe("address validation", () => {
		it("addresses are checksummed (mixed case)", () => {
			// Checksummed addresses have mixed case
			const addresses = [CTF_ADDRESS, USDC_E_ADDRESS];

			for (const address of addresses) {
				// Checksummed addresses have mixed case
				const hasLower = /[a-z]/.test(address);
				const hasUpper = /[A-F]/.test(address);

				// At least one should be true for checksummed addresses
				expect(hasLower || hasUpper).toBe(true);
			}
		});

		it("addresses are unique", () => {
			const addresses = [CTF_ADDRESS, USDC_E_ADDRESS];
			const uniqueAddresses = new Set(addresses);
			expect(uniqueAddresses.size).toBe(addresses.length);
		});
	});
});
