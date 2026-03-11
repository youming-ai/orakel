import { describe, expect, it } from "vitest";
import { toOnchainEventInsert } from "../runtime/onchainRuntimeHandlers.ts";

describe("toOnchainEventInsert", () => {
	it("maps on-chain event fields to repository payload", () => {
		const event = {
			type: "ctf_transfer_single" as const,
			txHash: "0xabc",
			blockNumber: 123,
			logIndex: 4,
			from: "0xfrom",
			to: "0xto",
			tokenId: "token-1",
			value: "100",
			timestamp: 1700000000000,
		};

		expect(toOnchainEventInsert(event)).toEqual({
			txHash: "0xabc",
			logIndex: 4,
			blockNumber: 123,
			eventType: "ctf_transfer_single",
			fromAddr: "0xfrom",
			toAddr: "0xto",
			tokenId: "token-1",
			value: "100",
			rawData: JSON.stringify(event),
		});
	});
});
