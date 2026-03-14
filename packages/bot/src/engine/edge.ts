import type { Side } from "../core/types.ts";

interface EdgeResult {
	edgeUp: number;
	edgeDown: number;
	bestSide: Side;
	bestEdge: number;
}

export function computeEdge(modelProbUp: number, marketProbUp: number): EdgeResult {
	const edgeUp = modelProbUp - marketProbUp;
	const edgeDown = marketProbUp - modelProbUp; // (1 - modelProbUp) - (1 - marketProbUp)
	const bestSide: Side = edgeUp >= edgeDown ? "UP" : "DOWN";
	const bestEdge = Math.max(edgeUp, edgeDown);
	return { edgeUp, edgeDown, bestSide, bestEdge };
}
