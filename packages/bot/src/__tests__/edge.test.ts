import { describe, expect, it } from "vitest";
import { computeEdge } from "../engine/edge.ts";

describe("computeEdge", () => {
	it("computes edge when model favors UP", () => {
		const result = computeEdge(0.7, 0.55);
		expect(result.edgeUp).toBeCloseTo(0.15, 6);
		expect(result.edgeDown).toBeCloseTo(-0.15, 6);
		expect(result.bestSide).toBe("UP");
		expect(result.bestEdge).toBeCloseTo(0.15, 6);
	});

	it("computes edge when model favors DOWN", () => {
		const result = computeEdge(0.3, 0.55);
		expect(result.edgeUp).toBeCloseTo(-0.25, 6);
		expect(result.edgeDown).toBeCloseTo(0.25, 6);
		expect(result.bestSide).toBe("DOWN");
		expect(result.bestEdge).toBeCloseTo(0.25, 6);
	});

	it("returns zero edge when model matches market", () => {
		const result = computeEdge(0.5, 0.5);
		expect(result.edgeUp).toBeCloseTo(0, 6);
		expect(result.edgeDown).toBeCloseTo(0, 6);
		expect(result.bestEdge).toBeCloseTo(0, 6);
	});

	it("handles extreme model probabilities", () => {
		const result = computeEdge(0.99, 0.5);
		expect(result.edgeUp).toBeCloseTo(0.49, 6);
		expect(result.bestSide).toBe("UP");
	});
});
