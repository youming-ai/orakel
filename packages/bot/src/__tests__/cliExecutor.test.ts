import { describe, expect, it } from "vitest";
import { classifyCliError, parseCliOutput } from "../cli/executor.ts";

describe("parseCliOutput", () => {
	it("parses valid JSON output", () => {
		const result = parseCliOutput<{ value: number }>("{\"value\": 42}");
		expect(result).toEqual({ value: 42 });
	});

	it("returns null for empty output", () => {
		expect(parseCliOutput("")).toBeNull();
	});

	it("returns null for non-JSON output", () => {
		expect(parseCliOutput("Error: something went wrong")).toBeNull();
	});
});

describe("classifyCliError", () => {
	it("classifies timeout as transient", () => {
		expect(classifyCliError("timed out")).toBe("transient");
	});

	it("classifies network error as transient", () => {
		expect(classifyCliError("connection refused")).toBe("transient");
	});

	it("classifies auth failure as fatal", () => {
		expect(classifyCliError("authentication failed")).toBe("fatal");
	});

	it("classifies insufficient balance as permanent", () => {
		expect(classifyCliError("insufficient balance")).toBe("permanent");
	});

	it("classifies unknown error as transient", () => {
		expect(classifyCliError("something unexpected")).toBe("transient");
	});
});
