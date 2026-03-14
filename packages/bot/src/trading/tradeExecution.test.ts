import { describe, expect, it } from "vitest";
import { PersistenceError } from "./persistence.ts";

describe("trade execution atomicity", () => {
	it("should define PersistenceError class", () => {
		expect(PersistenceError).toBeDefined();
	});

	it("should have PersistenceError with cause property", () => {
		const cause = new Error("DB connection failed");
		const error = new PersistenceError("Trade persistence failed", cause);

		expect(error.name).toBe("PersistenceError");
		expect(error.message).toBe("Trade persistence failed");
		expect(error.cause).toBe(cause);
		expect(error instanceof Error).toBe(true);
	});

	it("should support error chaining", () => {
		const originalError = new Error("Network timeout");
		const persistError = new PersistenceError("Failed to persist trade", originalError);

		expect(persistError.cause).toBe(originalError);
		expect(persistError.message).toContain("persist");
	});
});
