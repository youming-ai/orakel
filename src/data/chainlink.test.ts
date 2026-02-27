import { afterEach, describe, expect, it } from "vitest";
import { CONFIG } from "../config.ts";
import { getOrderedRpcs, getRpcCandidates } from "./chainlink.ts";

const DEFAULT_RPCS = ["https://polygon-rpc.com", "https://rpc.ankr.com/polygon", "https://polygon.llamarpc.com"];

const originalRpcUrls = [...CONFIG.chainlink.polygonRpcUrls];
const originalRpcUrl = CONFIG.chainlink.polygonRpcUrl;

afterEach(() => {
	CONFIG.chainlink.polygonRpcUrls = [...originalRpcUrls];
	CONFIG.chainlink.polygonRpcUrl = originalRpcUrl;
});

describe("getRpcCandidates", () => {
	it("returns a deduplicated, trimmed string array from config and defaults", () => {
		CONFIG.chainlink.polygonRpcUrls = [
			" https://custom-rpc-1.example ",
			"https://polygon-rpc.com",
			"",
			"https://custom-rpc-1.example",
		];
		CONFIG.chainlink.polygonRpcUrl = " https://custom-rpc-2.example ";

		const candidates = getRpcCandidates();

		expect(Array.isArray(candidates)).toBe(true);
		expect(candidates.every((rpc) => typeof rpc === "string")).toBe(true);
		expect(candidates).toContain("https://custom-rpc-1.example");
		expect(candidates).toContain("https://custom-rpc-2.example");
		expect(candidates).toContain("https://polygon-rpc.com");
		expect(candidates).toContain("https://rpc.ankr.com/polygon");
		expect(candidates).toContain("https://polygon.llamarpc.com");
		expect(new Set(candidates).size).toBe(candidates.length);
	});

	it("falls back to default RPCs when env config is empty", () => {
		CONFIG.chainlink.polygonRpcUrls = [];
		CONFIG.chainlink.polygonRpcUrl = "";

		expect(getRpcCandidates()).toEqual(DEFAULT_RPCS);
	});
});

describe("getOrderedRpcs", () => {
	it("returns string RPC URLs ordered from candidates", () => {
		CONFIG.chainlink.polygonRpcUrls = ["https://custom-rpc-1.example", "https://custom-rpc-2.example"];
		CONFIG.chainlink.polygonRpcUrl = "https://custom-rpc-3.example";

		const ordered = getOrderedRpcs();
		const candidates = getRpcCandidates();

		expect(Array.isArray(ordered)).toBe(true);
		expect(ordered.every((rpc) => typeof rpc === "string" && rpc.length > 0)).toBe(true);
		expect(new Set(ordered)).toEqual(new Set(candidates));
	});
});
