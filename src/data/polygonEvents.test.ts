import { describe, expect, it } from "vitest";
import {
	CTF_ADDRESS,
	TRANSFER_BATCH_TOPIC,
	TRANSFER_SINGLE_TOPIC,
	TRANSFER_TOPIC,
	USDC_E_ADDRESS,
} from "../contracts.ts";
import {
	getWssCandidates,
	parseCtfTransferSingle,
	parseOnChainEvent,
	parseRpcLog,
	parseUsdcTransfer,
	toHexNumber,
} from "./polygonEvents.ts";

describe("getWssCandidates", () => {
	it("should return array of WSS URLs", () => {
		const candidates = getWssCandidates();
		expect(Array.isArray(candidates)).toBe(true);
	});

	it("should return unique URLs", () => {
		const candidates = getWssCandidates();
		const unique = new Set(candidates);
		expect(unique.size).toBe(candidates.length);
	});

	it("should trim whitespace from URLs", () => {
		const candidates = getWssCandidates();
		for (const url of candidates) {
			expect(url).toBe(url.trim());
		}
	});

	it("should filter out empty strings", () => {
		const candidates = getWssCandidates();
		for (const url of candidates) {
			expect(url.length).toBeGreaterThan(0);
		}
	});
});

describe("toHexNumber", () => {
	it("should convert valid hex strings to numbers", () => {
		expect(toHexNumber("0x0")).toBe(0);
		expect(toHexNumber("0x1")).toBe(1);
		expect(toHexNumber("0xa")).toBe(10);
		expect(toHexNumber("0xff")).toBe(255);
	});

	it("should convert large hex numbers", () => {
		expect(toHexNumber("0x62f3f95a000")).toBe(6800000000000);
	});

	it("should return null for non-string values", () => {
		expect(toHexNumber(123)).toBeNull();
		expect(toHexNumber(null)).toBeNull();
		expect(toHexNumber(undefined)).toBeNull();
		expect(toHexNumber({})).toBeNull();
		expect(toHexNumber([])).toBeNull();
	});

	it("should return null for invalid hex strings", () => {
		expect(toHexNumber("not-hex")).toBeNull();
		expect(toHexNumber("0xGG")).toBeNull();
		expect(toHexNumber("0xZZ")).toBeNull();
	});

	it("should return null for hex without 0x prefix", () => {
		expect(toHexNumber("ff")).toBeNull();
		expect(toHexNumber("deadbeef")).toBeNull();
	});

	it("should handle uppercase hex", () => {
		expect(toHexNumber("0xA")).toBe(10);
		expect(toHexNumber("0xFF")).toBe(255);
		expect(toHexNumber("0xDEADBEEF")).toBe(3735928559);
	});
});

describe("parseRpcLog", () => {
	it("should return null for non-eth_subscription messages", () => {
		expect(parseRpcLog({ method: "eth_call" })).toBeNull();
		expect(parseRpcLog({ method: "eth_blockNumber" })).toBeNull();
	});

	it("should return null if params is missing or invalid", () => {
		expect(parseRpcLog({ method: "eth_subscription" })).toBeNull();
		expect(parseRpcLog({ method: "eth_subscription", params: null })).toBeNull();
		expect(parseRpcLog({ method: "eth_subscription", params: [] })).toBeNull();
		expect(parseRpcLog({ method: "eth_subscription", params: "invalid" })).toBeNull();
	});

	it("should return null if params.result is missing or invalid", () => {
		expect(parseRpcLog({ method: "eth_subscription", params: {} })).toBeNull();
		expect(parseRpcLog({ method: "eth_subscription", params: { result: null } })).toBeNull();
		expect(parseRpcLog({ method: "eth_subscription", params: { result: [] } })).toBeNull();
	});

	it("should return null if required fields are missing", () => {
		expect(
			parseRpcLog({
				method: "eth_subscription",
				params: { result: { topics: ["0x123"], data: "0x456" } },
			}),
		).toBeNull();
		expect(
			parseRpcLog({
				method: "eth_subscription",
				params: { result: { address: "0x123", data: "0x456" } },
			}),
		).toBeNull();
		expect(
			parseRpcLog({
				method: "eth_subscription",
				params: { result: { address: "0x123", topics: ["0x456"] } },
			}),
		).toBeNull();
	});

	it("should return null if address is not a string", () => {
		expect(
			parseRpcLog({
				method: "eth_subscription",
				params: { result: { address: 123, topics: ["0x123"], data: "0x456" } },
			}),
		).toBeNull();
	});

	it("should return null if topics is not an array", () => {
		expect(
			parseRpcLog({
				method: "eth_subscription",
				params: { result: { address: "0x123", topics: "not-array", data: "0x456" } },
			}),
		).toBeNull();
	});

	it("should return null if data is not a string", () => {
		expect(
			parseRpcLog({
				method: "eth_subscription",
				params: { result: { address: "0x123", topics: ["0x456"], data: 789 } },
			}),
		).toBeNull();
	});

	it("should parse valid RPC log message", () => {
		const msg = {
			method: "eth_subscription",
			params: {
				result: {
					address: USDC_E_ADDRESS,
					topics: [TRANSFER_TOPIC],
					data: "0x0000000000000000000000000000000000000000000000000000000000000001",
					transactionHash: "0xabc123",
					blockNumber: "0x1234",
					logIndex: "0x5",
				},
			},
		};
		const result = parseRpcLog(msg);
		expect(result).not.toBeNull();
		expect(result?.address).toBe(USDC_E_ADDRESS);
		expect(result?.topics).toEqual([TRANSFER_TOPIC]);
		expect(result?.data).toBe("0x0000000000000000000000000000000000000000000000000000000000000001");
	});
});

describe("parseUsdcTransfer", () => {
	it("should return null if topics array is too short", () => {
		expect(parseUsdcTransfer({ topics: [] })).toBeNull();
		expect(parseUsdcTransfer({ topics: [TRANSFER_TOPIC] })).toBeNull();
	});

	it("should return null if first topic does not match TRANSFER_TOPIC", () => {
		expect(
			parseUsdcTransfer({
				topics: [TRANSFER_SINGLE_TOPIC, "0x123", "0x456"],
				data: "0x789",
				transactionHash: "0xabc",
				blockNumber: "0x1",
				logIndex: "0x1",
			}),
		).toBeNull();
	});

	it("should return null if required fields are missing", () => {
		expect(
			parseUsdcTransfer({
				topics: [TRANSFER_TOPIC, "0x123", "0x456"],
				data: "0x789",
				blockNumber: "0x1",
				logIndex: "0x1",
			}),
		).toBeNull();
		expect(
			parseUsdcTransfer({
				topics: [TRANSFER_TOPIC, "0x123", "0x456"],
				transactionHash: "0xabc",
				blockNumber: "0x1",
				logIndex: "0x1",
			}),
		).toBeNull();
	});

	it("should return null if blockNumber or logIndex cannot be parsed", () => {
		expect(
			parseUsdcTransfer({
				topics: [TRANSFER_TOPIC, "0x123", "0x456"],
				data: "0x789",
				transactionHash: "0xabc",
				blockNumber: "invalid",
				logIndex: "0x1",
			}),
		).toBeNull();
		expect(
			parseUsdcTransfer({
				topics: [TRANSFER_TOPIC, "0x123", "0x456"],
				data: "0x789",
				transactionHash: "0xabc",
				blockNumber: "0x1",
				logIndex: "invalid",
			}),
		).toBeNull();
	});

	it("should return null if decoding fails", () => {
		const result = parseUsdcTransfer({
			topics: [TRANSFER_TOPIC, "0x123", "0x456"],
			data: "0xinvalid",
			transactionHash: "0xabc",
			blockNumber: "0x1",
			logIndex: "0x1",
		});
		expect(result).toBeNull();
	});

	it("should parse valid USDC transfer log", () => {
		const logEntry = {
			topics: [
				TRANSFER_TOPIC,
				"0x0000000000000000000000001111111111111111111111111111111111111111",
				"0x0000000000000000000000002222222222222222222222222222222222222222",
			],
			data: "0x0000000000000000000000000000000000000000000000000000000000000064",
			transactionHash: "0xabc123def456",
			blockNumber: "0x1234",
			logIndex: "0x5",
		};
		const result = parseUsdcTransfer(logEntry);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("usdc_transfer");
		expect(result?.txHash).toBe("0xabc123def456");
		expect(result?.blockNumber).toBe(4660);
		expect(result?.logIndex).toBe(5);
		expect(result?.from).toBe("0x1111111111111111111111111111111111111111");
		expect(result?.to).toBe("0x2222222222222222222222222222222222222222");
		expect(result?.tokenId).toBeNull();
	});
});

describe("parseCtfTransferSingle", () => {
	it("should return null if topics array is too short", () => {
		expect(parseCtfTransferSingle({ topics: [] })).toBeNull();
		expect(parseCtfTransferSingle({ topics: [TRANSFER_SINGLE_TOPIC, "0x1", "0x2"] })).toBeNull();
	});

	it("should return null if first topic does not match TRANSFER_SINGLE_TOPIC", () => {
		expect(
			parseCtfTransferSingle({
				topics: [TRANSFER_TOPIC, "0x123", "0x456", "0x789"],
				data: "0xabc",
				transactionHash: "0xdef",
				blockNumber: "0x1",
				logIndex: "0x1",
			}),
		).toBeNull();
	});

	it("should return null if required fields are missing", () => {
		expect(
			parseCtfTransferSingle({
				topics: [TRANSFER_SINGLE_TOPIC, "0x123", "0x456", "0x789"],
				data: "0xabc",
				blockNumber: "0x1",
				logIndex: "0x1",
			}),
		).toBeNull();
	});

	it("should return null if blockNumber or logIndex cannot be parsed", () => {
		expect(
			parseCtfTransferSingle({
				topics: [TRANSFER_SINGLE_TOPIC, "0x123", "0x456", "0x789"],
				data: "0xabc",
				transactionHash: "0xdef",
				blockNumber: "invalid",
				logIndex: "0x1",
			}),
		).toBeNull();
	});

	it("should return null if decoding fails", () => {
		const result = parseCtfTransferSingle({
			topics: [TRANSFER_SINGLE_TOPIC, "0x123", "0x456", "0x789"],
			data: "0xinvalid",
			transactionHash: "0xdef",
			blockNumber: "0x1",
			logIndex: "0x1",
		});
		expect(result).toBeNull();
	});

	it("should parse valid CTF TransferSingle log", () => {
		const logEntry = {
			topics: [
				TRANSFER_SINGLE_TOPIC,
				"0x0000000000000000000000003333333333333333333333333333333333333333",
				"0x0000000000000000000000004444444444444444444444444444444444444444",
				"0x0000000000000000000000005555555555555555555555555555555555555555",
			],
			data: "0x000000000000000000000000000000000000000000000000000000000000007b0000000000000000000000000000000000000000000000000000000000000001",
			transactionHash: "0xdef789abc123",
			blockNumber: "0x5678",
			logIndex: "0xa",
		};
		const result = parseCtfTransferSingle(logEntry);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("ctf_transfer_single");
		expect(result?.txHash).toBe("0xdef789abc123");
		expect(result?.blockNumber).toBe(22136);
		expect(result?.logIndex).toBe(10);
		expect(result?.from).toBe("0x4444444444444444444444444444444444444444");
		expect(result?.to).toBe("0x5555555555555555555555555555555555555555");
	});
});

describe("parseOnChainEvent", () => {
	it("should dispatch to parseUsdcTransfer for USDC Transfer events", () => {
		const logEntry = {
			address: USDC_E_ADDRESS,
			topics: [
				TRANSFER_TOPIC,
				"0x0000000000000000000000001111111111111111111111111111111111111111",
				"0x0000000000000000000000002222222222222222222222222222222222222222",
			],
			data: "0x0000000000000000000000000000000000000000000000000000000000000064",
			transactionHash: "0xabc123",
			blockNumber: "0x1",
			logIndex: "0x1",
		};
		const result = parseOnChainEvent(logEntry);
		expect(result?.type).toBe("usdc_transfer");
	});

	it("should dispatch to parseCtfTransferSingle for CTF TransferSingle events", () => {
		const logEntry = {
			address: CTF_ADDRESS,
			topics: [
				TRANSFER_SINGLE_TOPIC,
				"0x0000000000000000000000003333333333333333333333333333333333333333",
				"0x0000000000000000000000004444444444444444444444444444444444444444",
				"0x0000000000000000000000005555555555555555555555555555555555555555",
			],
			data: "0x000000000000000000000000000000000000000000000000000000000000007b0000000000000000000000000000000000000000000000000000000000000001",
			transactionHash: "0xdef789",
			blockNumber: "0x1",
			logIndex: "0x1",
		};
		const result = parseOnChainEvent(logEntry);
		expect(result?.type).toBe("ctf_transfer_single");
	});

	it("should return null for CTF TransferBatch events", () => {
		const logEntry = {
			address: CTF_ADDRESS,
			topics: [TRANSFER_BATCH_TOPIC, "0x123", "0x456", "0x789"],
			data: "0xabc",
			transactionHash: "0xdef",
			blockNumber: "0x1",
			logIndex: "0x1",
		};
		const result = parseOnChainEvent(logEntry);
		expect(result).toBeNull();
	});

	it("should return null for unknown event types", () => {
		const logEntry = {
			address: "0x9999999999999999999999999999999999999999",
			topics: ["0x0000000000000000000000000000000000000000000000000000000000000000"],
			data: "0xabc",
			transactionHash: "0xdef",
			blockNumber: "0x1",
			logIndex: "0x1",
		};
		const result = parseOnChainEvent(logEntry);
		expect(result).toBeNull();
	});

	it("should handle case-insensitive address matching", () => {
		const logEntry = {
			address: USDC_E_ADDRESS.toUpperCase(),
			topics: [
				TRANSFER_TOPIC,
				"0x0000000000000000000000001111111111111111111111111111111111111111",
				"0x0000000000000000000000002222222222222222222222222222222222222222",
			],
			data: "0x0000000000000000000000000000000000000000000000000000000000000064",
			transactionHash: "0xabc123",
			blockNumber: "0x1",
			logIndex: "0x1",
		};
		const result = parseOnChainEvent(logEntry);
		expect(result?.type).toBe("usdc_transfer");
	});
});
